import { createServerFn } from "@tanstack/react-start";
import { requestAccessToken, requireServerAuth } from "./server-auth";

const SICREDI_ROLES = ["admin", "gestor", "financeiro"] as const;

async function requireSicrediAccess() {
  return requireServerAuth(requestAccessToken(), SICREDI_ROLES);
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

type EmitirInput = {
  seuNumero: string;
  valor: number;
  vencimento: string;
  pagador: {
    tipoPessoa: string;
    documento: string;
    nome: string;
    endereco: string;
    cidade: string;
    uf: string;
    cep: string;
    telefone?: string;
    email?: string;
  };
  informativo?: string;
  diasProtesto?: number;
  juros?: number;
  multa?: number;
};

/** Registra o boleto no Sicredi e devolve nosso numero / linha digitavel / PIX. */
export const sicrediEmitirBoleto = createServerFn({ method: "POST" })
  .inputValidator((data: EmitirInput) => data)
  .handler(async ({ data }) => {
    const c = await conf();
    const tk = await token(c);
    const juros = data.juros !== undefined ? data.juros : c.juros;
    const multa = data.multa !== undefined ? data.multa : c.multa;
    const diasProtesto = data.diasProtesto !== undefined ? data.diasProtesto : c.diasProtesto;
    const informativo = data.informativo || c.informativo;
    const payload = {
      tipoCobranca: c.tipoCobranca,
      codigoBeneficiario: c.beneficiario,
      especieDocumento: c.especieDocumento,
      seuNumero: data.seuNumero,
      dataVencimento: data.vencimento,
      valor: Number(data.valor.toFixed(2)),
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
        tipoPessoa: data.pagador.tipoPessoa,
        documento: data.pagador.documento.replace(/\D/g, ""),
        nome: data.pagador.nome.slice(0, 40),
        endereco: data.pagador.endereco.slice(0, 40),
        cidade: data.pagador.cidade.slice(0, 20),
        uf: data.pagador.uf.slice(0, 2).toUpperCase(),
        cep: data.pagador.cep.replace(/\D/g, ""),
        ...(data.pagador.telefone ? { telefone: data.pagador.telefone.replace(/\D/g, "") } : {}),
        ...(data.pagador.email ? { email: data.pagador.email } : {}),
      },
    };
    const res = await fetch(`${c.base}/cobranca/boleto/v1/boletos`, {
      method: "POST",
      headers: headers(c, tk),
      body: JSON.stringify(payload),
    });
    const txt = await res.text();
    if (!res.ok) {
      throw new Error(`Sicredi recusou o boleto (${res.status}): ${txt.slice(0, 400)}`);
    }
    const json = JSON.parse(txt || "{}") as Record<string, unknown>;
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
    };
  });

/** Consulta a situacao atual do boleto no Sicredi. */
export const sicrediConsultarBoleto = createServerFn({ method: "POST" })
  .inputValidator((data: { nossoNumero: string }) => data)
  .handler(async ({ data }) => {
    const c = await conf();
    const tk = await token(c);
    const url = `${c.base}/cobranca/boleto/v1/boletos?codigoBeneficiario=${encodeURIComponent(
      c.beneficiario,
    )}&nossoNumero=${encodeURIComponent(data.nossoNumero)}`;
    const res = await fetch(url, { headers: headers(c, tk) });
    const txt = await res.text();
    if (!res.ok) throw new Error(`Consulta Sicredi falhou (${res.status}): ${txt.slice(0, 300)}`);
    const json = JSON.parse(txt || "{}") as Record<string, unknown>;
    const situacao = String(
      (json["situacao"] as string) ?? (json["situacaoBoleto"] as string) ?? "",
    ).toLowerCase();
    return {
      situacao,
      liquidado: situacao.includes("liquidad"),
      baixado: situacao.includes("baixad") || situacao.includes("cancelad"),
      retorno: txt.slice(0, 4000),
    };
  });

/** Solicita a baixa (cancelamento) do boleto. */
export const sicrediBaixarBoleto = createServerFn({ method: "POST" })
  .inputValidator((data: { nossoNumero: string }) => data)
  .handler(async ({ data }) => {
    const c = await conf();
    const tk = await token(c);
    const res = await fetch(
      `${c.base}/cobranca/boleto/v1/boletos/${encodeURIComponent(data.nossoNumero)}/baixa`,
      { method: "PATCH", headers: headers(c, tk), body: JSON.stringify({}) },
    );
    const txt = await res.text();
    if (!res.ok) throw new Error(`Baixa no Sicredi falhou (${res.status}): ${txt.slice(0, 300)}`);
    return { ok: true, retorno: txt.slice(0, 500) };
  });

/** Segunda via em PDF (base64) do boleto registrado. */
export const sicrediPdfBoleto = createServerFn({ method: "POST" })
  .inputValidator((data: { nossoNumero: string }) => data)
  .handler(async ({ data }) => {
    const c = await conf();
    const tk = await token(c);
    const res = await fetch(
      `${c.base}/cobranca/boleto/v1/boletos/pdf?linhaDigitavel=&nossoNumero=${encodeURIComponent(
        data.nossoNumero,
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
