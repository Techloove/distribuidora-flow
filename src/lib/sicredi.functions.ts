import { createServerFn } from "@tanstack/react-start";
import { enforceRateLimit, requestAccessToken, requireServerAuth } from "./server-auth";

const SICREDI_ROLES = ["admin", "gestor", "financeiro"] as const;

async function requireSicrediAccess(action: string, limit: number) {
  const accessToken = requestAccessToken();
  const user = await requireServerAuth(accessToken, SICREDI_ROLES);
  await enforceRateLimit(accessToken, action, limit, 60);
  if (!accessToken) throw new Error("Sessão não informada. Entre novamente.");
  return { user, accessToken };
}

async function userRest<T>(accessToken: string, path: string): Promise<T[]> {
  const url = process.env["EXT_SUPABASE_URL"];
  const anonKey = process.env["EXT_SUPABASE_ANON_KEY"];
  if (!url || !anonKey) throw new Error("Configuração do Supabase não disponível no servidor.");
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Não foi possível validar o título no ERP.");
  return (await res.json()) as T[];
}

async function userRpc<T>(
  accessToken: string,
  fn: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const url = process.env["EXT_SUPABASE_URL"];
  const anonKey = process.env["EXT_SUPABASE_ANON_KEY"];
  if (!url || !anonKey) throw new Error("Configuração do Supabase não disponível no servidor.");
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Falha ao registrar liquidação no ERP: ${body.slice(0, 300)}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function serviceRpc<T>(fn: string, payload: Record<string, unknown>): Promise<T> {
  const url = process.env["EXT_SUPABASE_URL"];
  const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("Service role do Supabase não disponível no servidor.");
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Falha ao persistir operação Sicredi no ERP: ${body.slice(0, 300)}`);
  return (body ? JSON.parse(body) : null) as T;
}

function jsonPayload(text: string): unknown {
  try {
    return JSON.parse(text || "{}") as unknown;
  } catch {
    return { raw: text.slice(0, 4000) };
  }
}

async function carregarTituloBoleto(accessToken: string, contaId: string): Promise<DbRow> {
  const id = String(contaId ?? "").trim();
  if (!id) throw new Error("Título não informado.");
  const rows = await userRest<DbRow>(
    accessToken,
    `vw_boletos_pendentes?select=*&conta_receber_id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const row = rows[0];
  if (!row) throw new Error("Título indisponível, sem acesso ou já possui boleto ativo.");
  return row;
}

async function carregarBoleto(accessToken: string, boletoId: string): Promise<DbRow> {
  const id = String(boletoId ?? "").trim();
  if (!id) throw new Error("Boleto não informado.");
  const rows = await userRest<DbRow>(
    accessToken,
    `boletos?select=id,nosso_numero,status,centro_id,valor,conta_receber_id&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const row = rows[0];
  if (!row) throw new Error("Boleto não encontrado ou sem acesso.");
  if (!String(row["nosso_numero"] ?? "").trim()) throw new Error("Boleto sem nosso número.");
  return row;
}

/**
 * Integracao com a API de Cobranca do Sicredi (portal de parceiros).
 * As credenciais e os parametros do boleto (juros, multa, desconto, protesto)
 * sao cadastrados na tela de Configuracoes (tabela public.sicredi_config).
 * Se a tabela estiver vazia, caem nas variaveis de ambiente:
 *   SICREDI_API_KEY, SICREDI_USERNAME, SICREDI_PASSWORD,
 *   SICREDI_COOPERATIVA, SICREDI_POSTO, SICREDI_CODIGO_BENEFICIARIO,
 *   SICREDI_AMBIENTE ("homologacao" | "producao")
 */

type Conf = {
  apiKey: string;
  username: string;
  password: string;
  cooperativa: string;
  posto: string;
  beneficiario: string;
  ambiente: string;
  base: string;
  tipoCobranca: string;
  especieDocumento: string;
  tipoJuro: string;
  juros: number;
  multa: number;
  diasMulta: number;
  tipoDesconto: string;
  valorDesconto1: number;
  diasDesconto1: number;
  tipoProtesto: string;
  diasProtesto: number;
  validadeAposVencimento: number;
  informativo: string;
  mensagem: string;
};

type DbRow = Record<string, unknown>;

/** Le a linha de configuracao no Supabase externo com a service role key. */
async function dbConfig(): Promise<DbRow | null> {
  const url = process.env["EXT_SUPABASE_URL"];
  const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/rest/v1/sicredi_config?select=*&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as DbRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

const txt = (v: unknown, fb = "") => (v === null || v === undefined ? fb : String(v));
const nmb = (v: unknown, fb = 0) => (v === null || v === undefined ? fb : Number(v) || fb);

async function conf(): Promise<Conf> {
  const row = await dbConfig();
  const ambiente = (
    txt(row?.["ambiente"]) ||
    process.env["SICREDI_AMBIENTE"] ||
    "homologacao"
  ).toLowerCase();
  const base =
    ambiente === "producao"
      ? "https://api-parceiro.sicredi.com.br"
      : "https://api-parceiro.sicredi.com.br/sb";
  const c: Conf = {
    apiKey: txt(row?.["api_key"]) || process.env["SICREDI_API_KEY"] || "",
    username: txt(row?.["username"]) || process.env["SICREDI_USERNAME"] || "",
    password: txt(row?.["password"]) || process.env["SICREDI_PASSWORD"] || "",
    cooperativa: txt(row?.["cooperativa"]) || process.env["SICREDI_COOPERATIVA"] || "",
    posto: txt(row?.["posto"]) || process.env["SICREDI_POSTO"] || "",
    beneficiario:
      txt(row?.["codigo_beneficiario"]) || process.env["SICREDI_CODIGO_BENEFICIARIO"] || "",
    ambiente,
    base,
    tipoCobranca: txt(row?.["tipo_cobranca"], "HIBRIDO") || "HIBRIDO",
    especieDocumento:
      txt(row?.["especie_documento"], "DUPLICATA_MERCANTIL_INDICACAO") ||
      "DUPLICATA_MERCANTIL_INDICACAO",
    tipoJuro: txt(row?.["tipo_juro"], "ISENTO") || "ISENTO",
    juros: nmb(row?.["juros"]),
    multa: nmb(row?.["multa"]),
    diasMulta: nmb(row?.["dias_multa"]),
    tipoDesconto: txt(row?.["tipo_desconto"], "NAO_TEM_DESCONTO") || "NAO_TEM_DESCONTO",
    valorDesconto1: nmb(row?.["valor_desconto1"]),
    diasDesconto1: nmb(row?.["dias_desconto1"]),
    tipoProtesto: txt(row?.["tipo_protesto"], "SEM_PROTESTO") || "SEM_PROTESTO",
    diasProtesto: nmb(row?.["dias_protesto"]),
    validadeAposVencimento: nmb(row?.["validade_apos_vencimento"]),
    informativo: txt(row?.["informativo"]),
    mensagem: txt(row?.["mensagem"]),
  };
  const faltando = Object.entries({
    "Chave de API": c.apiKey,
    Usuário: c.username,
    Senha: c.password,
    Cooperativa: c.cooperativa,
    Posto: c.posto,
    "Código do beneficiário": c.beneficiario,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (faltando.length > 0) {
    throw new Error(
      `Credenciais do Sicredi ausentes: ${faltando.join(", ")}. Cadastre em Configurações → Sicredi.`,
    );
  }
  return c;
}


async function token(c: Conf): Promise<string> {
  const body = new URLSearchParams({
    username: c.username,
    password: c.password,
    scope: "cobranca",
    grant_type: "password",
  });
  const res = await fetch(`${c.base}/auth/openapi/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-api-key": c.apiKey,
      context: "COBRANCA",
    },
    body,
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Falha na autenticacao Sicredi (${res.status}): ${txt.slice(0, 300)}`);
  const json = JSON.parse(txt) as { access_token?: string };
  if (!json.access_token) throw new Error("Sicredi nao retornou access_token");
  return json.access_token;
}

function headers(c: Conf, tk: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${tk}`,
    "x-api-key": c.apiKey,
    cooperativa: c.cooperativa,
    posto: c.posto,
  };
}

/** Status da configuracao — usado pela tela para avisar o usuario. */
export const sicrediStatus = createServerFn({ method: "GET" }).handler(async () => {
  await requireSicrediAccess("sicredi_status", 30);
  try {
    const c = await conf();
    return {
      configurado: true,
      ambiente: c.ambiente,
      cooperativa: c.cooperativa,
      posto: c.posto,
      beneficiario: c.beneficiario,
      erro: null as string | null,
    };
  } catch (e) {
    return {
      configurado: false,
      ambiente: (process.env["SICREDI_AMBIENTE"] ?? "homologacao").toLowerCase(),
      cooperativa: "",
      posto: "",
      beneficiario: "",
      erro: (e as Error).message,
    };
  }
});

type EmitirInput = { contaId: string };

/** Registra o boleto no Sicredi e devolve nosso numero / linha digitavel / PIX. */
export const sicrediEmitirBoleto = createServerFn({ method: "POST" })
  .inputValidator((data: EmitirInput) => data)
  .handler(async ({ data }) => {
    const { user, accessToken } = await requireSicrediAccess("sicredi_emitir_boleto", 10);
    const row = await carregarTituloBoleto(accessToken, data.contaId);
    const c = await conf();
    const tk = await token(c);
    const juros = c.juros;
    const multa = c.multa;
    const diasProtesto = c.diasProtesto;
    const seuNumero =
      `${String(row["pedido_numero"] ?? row["documento"] ?? "").replace(/\D/g, "") || "0"}${String(
        row["parcela"] ?? 1,
      )}`.slice(0, 10);
    const endereco = [row["logradouro"], row["numero"], row["complemento"], row["bairro"]]
      .filter(Boolean)
      .join(", ");
    const informativo =
      c.informativo ||
      `Pedido ${String(row["pedido_numero"] ?? "-")} parcela ${String(row["parcela"] ?? 1)}`;
    const payload = {
      tipoCobranca: c.tipoCobranca,
      codigoBeneficiario: c.beneficiario,
      especieDocumento: c.especieDocumento,
      seuNumero,
      dataVencimento: String(row["vencimento"] ?? ""),
      valor: Number(Number(row["saldo"] ?? 0).toFixed(2)),
      tipoDesconto: c.tipoDesconto,
      ...(c.tipoDesconto !== "NAO_TEM_DESCONTO" && c.valorDesconto1 > 0
        ? { valorDesconto1: c.valorDesconto1, diasDesconto1: c.diasDesconto1 }
        : {}),
      tipoJuro: juros > 0 ? (c.tipoJuro === "ISENTO" ? "PERCENTUAL" : c.tipoJuro) : "ISENTO",
      ...(juros > 0 ? { juros } : {}),
      ...(multa > 0 ? { multa, diasMulta: c.diasMulta } : {}),
      ...(c.tipoProtesto !== "SEM_PROTESTO" && diasProtesto > 0
        ? { tipoProtesto: c.tipoProtesto, diasProtesto }
        : {}),
      ...(c.validadeAposVencimento > 0
        ? { validadeAposVencimento: c.validadeAposVencimento }
        : {}),
      ...(informativo ? { informativos: [informativo.slice(0, 80)] } : {}),
      ...(c.mensagem ? { mensagens: [c.mensagem.slice(0, 80)] } : {}),

      pagador: {
        tipoPessoa: String(row["tipo_pessoa"] ?? "").toUpperCase().startsWith("F")
          ? "PESSOA_FISICA"
          : "PESSOA_JURIDICA",
        documento: String(row["cnpj_cpf"] ?? "").replace(/\D/g, ""),
        nome: String(row["razao_social"] ?? "").slice(0, 40),
        endereco: (endereco || "Nao informado").slice(0, 40),
        cidade: String(row["cidade"] ?? "").slice(0, 20),
        uf: String(row["uf"] ?? "").slice(0, 2).toUpperCase(),
        cep: String(row["cep"] ?? "").replace(/\D/g, ""),
        ...(row["telefone"]
          ? { telefone: String(row["telefone"]).replace(/\D/g, "") }
          : {}),
        ...(row["email"] ? { email: String(row["email"]) } : {}),
      },
    };
    const res = await fetch(`${c.base}/cobranca/boleto/v1/boletos`, {
      method: "POST",
      headers: headers(c, tk),
      body: JSON.stringify(payload),
    });
    const txt = await res.text();
    if (!res.ok) {
      try {
        await serviceRpc("registrar_erro_boleto_sicredi_servidor", {
          _actor_id: user.id,
          _conta_id: data.contaId,
          _seu_numero: seuNumero,
          _erro: `Sicredi recusou o boleto (${res.status}): ${txt.slice(0, 400)}`,
        });
      } catch {
        // O erro bancário continua sendo a causa principal; a falha de persistência será auditada no servidor.
      }
      throw new Error(`Sicredi recusou o boleto (${res.status}): ${txt.slice(0, 400)}`);
    }
    const json = JSON.parse(txt || "{}") as Record<string, unknown>;
    const retorno = jsonPayload(txt);
    await serviceRpc("registrar_boleto_sicredi_servidor", {
      _actor_id: user.id,
      _conta_id: data.contaId,
      _seu_numero: seuNumero,
      _nosso_numero: String(json["nossoNumero"] ?? ""),
      _linha_digitavel: String(json["linhaDigitavel"] ?? ""),
      _codigo_barras: String(json["codigoBarras"] ?? ""),
      _qrcode_pix: String(json["qrCode"] ?? json["txid"] ?? ""),
      _txid: String(json["txid"] ?? ""),
      _cooperativa: c.cooperativa,
      _posto: c.posto,
      _codigo_beneficiario: c.beneficiario,
      _ambiente: c.ambiente,
      _retorno: retorno,
    });
    return {
      nossoNumero: String(json["nossoNumero"] ?? ""),
      linhaDigitavel: String(json["linhaDigitavel"] ?? ""),
      codigoBarras: String(json["codigoBarras"] ?? ""),
      qrCode: String(json["qrCode"] ?? json["txid"] ?? ""),
      txid: String(json["txid"] ?? ""),
      cooperativa: c.cooperativa,
      posto: c.posto,
      beneficiario: c.beneficiario,
      ambiente: c.ambiente,
      retorno: txt.slice(0, 4000),
      seuNumero,
    };
  });

/** Consulta a situacao atual do boleto no Sicredi. */
export const sicrediConsultarBoleto = createServerFn({ method: "POST" })
  .inputValidator((data: { boletoId: string }) => data)
  .handler(async ({ data }) => {
    const { user, accessToken } = await requireSicrediAccess("sicredi_consultar_boleto", 30);
    const boleto = await carregarBoleto(accessToken, data.boletoId);
    const nossoNumero = String(boleto["nosso_numero"]);
    const c = await conf();
    const tk = await token(c);
    const url = `${c.base}/cobranca/boleto/v1/boletos?codigoBeneficiario=${encodeURIComponent(
      c.beneficiario,
    )}&nossoNumero=${encodeURIComponent(nossoNumero)}`;
    const res = await fetch(url, { headers: headers(c, tk) });
    const txt = await res.text();
    if (!res.ok) throw new Error(`Consulta Sicredi falhou (${res.status}): ${txt.slice(0, 300)}`);
    const json = JSON.parse(txt || "{}") as Record<string, unknown>;
    const situacao = String(
      (json["situacao"] as string) ?? (json["situacaoBoleto"] as string) ?? "",
    ).toLowerCase();
    const liquidado = situacao.includes("liquidad");
    const baixado = situacao.includes("baixad") || situacao.includes("cancelad");
    if (liquidado) {
      const valorLiquidacao = Number(boleto["valor"] ?? 0);
      if (!Number.isFinite(valorLiquidacao) || valorLiquidacao <= 0) {
        throw new Error("Boleto sem valor válido para registrar a liquidação no ERP.");
      }
      await userRpc(accessToken, "liquidar_boleto", {
        _boleto_id: data.boletoId,
        _valor: valorLiquidacao,
        _data: new Date().toISOString().slice(0, 10),
      });
    } else {
      await serviceRpc("sincronizar_boleto_sicredi_servidor", {
        _actor_id: user.id,
        _boleto_id: data.boletoId,
        _status: baixado ? "baixado" : "registrado",
        _retorno: jsonPayload(txt),
      });
    }
    return {
      situacao,
      liquidado,
      baixado,
      retorno: txt.slice(0, 4000),
    };
  });

/** Solicita a baixa (cancelamento) do boleto. */
export const sicrediBaixarBoleto = createServerFn({ method: "POST" })
  .inputValidator((data: { boletoId: string }) => data)
  .handler(async ({ data }) => {
    const { user, accessToken } = await requireSicrediAccess("sicredi_baixar_boleto", 10);
    const boleto = await carregarBoleto(accessToken, data.boletoId);
    const nossoNumero = String(boleto["nosso_numero"]);
    const c = await conf();
    const tk = await token(c);
    const res = await fetch(
      `${c.base}/cobranca/boleto/v1/boletos/${encodeURIComponent(nossoNumero)}/baixa`,
      { method: "PATCH", headers: headers(c, tk), body: JSON.stringify({}) },
    );
    const txt = await res.text();
    if (!res.ok) throw new Error(`Baixa no Sicredi falhou (${res.status}): ${txt.slice(0, 300)}`);
    await serviceRpc("sincronizar_boleto_sicredi_servidor", {
      _actor_id: user.id,
      _boleto_id: data.boletoId,
      _status: "baixado",
      _retorno: jsonPayload(txt),
    });
    return { ok: true, retorno: txt.slice(0, 500) };
  });

/** Segunda via em PDF (base64) do boleto registrado. */
export const sicrediPdfBoleto = createServerFn({ method: "POST" })
  .inputValidator((data: { boletoId: string }) => data)
  .handler(async ({ data }) => {
    const { accessToken } = await requireSicrediAccess("sicredi_pdf_boleto", 20);
    const boleto = await carregarBoleto(accessToken, data.boletoId);
    const nossoNumero = String(boleto["nosso_numero"]);
    const c = await conf();
    const tk = await token(c);
    const res = await fetch(
      `${c.base}/cobranca/boleto/v1/boletos/pdf?linhaDigitavel=&nossoNumero=${encodeURIComponent(
        nossoNumero,
      )}&codigoBeneficiario=${encodeURIComponent(c.beneficiario)}`,
      { headers: headers(c, tk) },
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`PDF do boleto indisponivel (${res.status}): ${txt.slice(0, 300)}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (const b of buf) bin += String.fromCharCode(b);
    return { base64: btoa(bin) };
  });
