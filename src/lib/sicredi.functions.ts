import {
  SICREDI_SANDBOX,
  liquidacaoSicredi,
  linhaDigitavelSicredi,
  motivoRecusaSicredi,
} from "./sicredi-api";
import { tokenSicredi } from "./sicredi-token";
import { documentoFiscal } from "./sicredi-cnab";
import { validarNovoVencimento, vencimentoDoBanco } from "./sicredi-vencimento";
import { createServerFn } from "@tanstack/react-start";
import { fetchWithTimeout } from "./fetch-timeout";
import { enforceRateLimit, requestAccessToken, requireServerAuth } from "./server-auth";

const SICREDI_ROLES = ["admin", "gestor", "financeiro"] as const;

async function requireSicrediAccess(action: string, limit: number, explicitAccessToken?: string) {
  const accessToken = String(explicitAccessToken ?? "").trim() || requestAccessToken();
  const user = await requireServerAuth(accessToken, SICREDI_ROLES);
  await enforceRateLimit(accessToken, action, limit, 60);
  if (!accessToken) throw new Error("Sessão não informada. Entre novamente.");
  return { user, accessToken };
}

async function userRest<T>(accessToken: string, path: string): Promise<T[]> {
  const url = process.env["EXT_SUPABASE_URL"];
  const anonKey = process.env["EXT_SUPABASE_ANON_KEY"];
  if (!url || !anonKey) throw new Error("Configuração do Supabase não disponível no servidor.");
  const res = await fetchWithTimeout(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Não foi possível validar o título no ERP.");
  return (await res.json()) as T[];
}

async function serviceRpc<T>(fn: string, payload: Record<string, unknown>): Promise<T> {
  const url = process.env["EXT_SUPABASE_URL"];
  const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("Service role do Supabase não disponível no servidor.");
  const res = await fetchWithTimeout(`${url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) {
    let message = "Falha ao persistir operação Sicredi. Confira a migração fase224 no Supabase.";
    try {
      const error = JSON.parse(body);
      if (error.code === "P0001") message = String(error.message);
    } catch {
      /* Não expõe respostas com credenciais. */
    }
    throw new Error(message);
  }
  return (body ? JSON.parse(body) : null) as T;
}

function jsonPayload(text: string): unknown {
  try {
    return JSON.parse(text || "{}") as unknown;
  } catch {
    return { raw: text.slice(0, 4000) };
  }
}

function shiftIsoDate(value: unknown, days: number): string | null {
  const iso = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

async function carregarBoleto(
  accessToken: string,
  boletoId: string,
  exigeNossoNumero = true,
): Promise<DbRow> {
  const id = String(boletoId ?? "").trim();
  if (!id) throw new Error("Boleto não informado.");
  const rows = await userRest<DbRow>(
    accessToken,
    `boletos?select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const row = rows[0];
  if (!row) throw new Error("Boleto não encontrado ou sem acesso.");
  if (row["banco"] !== "sicredi") throw new Error("Este boleto pertence a outro banco.");
  if (row["canal"] === "cnab240")
    throw new Error("Boleto CNAB 240 deve ser acompanhado pelo retorno do banco.");
  if (exigeNossoNumero && !String(row["nosso_numero"] ?? "").trim())
    throw new Error(
      "Registro recuperado sem nosso número. A impressão está disponível; confirme o nosso número com o Sicredi para consultar ou alterar.",
    );
  return row;
}

/** Credenciais privadas Sicredi, vinculadas ao centro configurado em Centros de custo. */
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
  if (!url || !key) throw new Error("Configuração segura Supabase indisponível no servidor.");
  const res = await fetchWithTimeout(
    `${url.replace(/\/$/, "")}/rest/v1/sicredi_config?select=*&limit=2`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok)
    throw new Error(
      "Não foi possível carregar o convênio Sicredi. Nenhuma credencial alternativa foi utilizada.",
    );
  const rows = (await res.json()) as DbRow[];
  if (rows.length > 1) throw new Error("Convênio Sicredi deve possuir configuração única.");
  return rows[0] ?? null;
}

const txt = (v: unknown, fb = "") => (v === null || v === undefined ? fb : String(v));
const nmb = (v: unknown, fb = 0) => (v === null || v === undefined ? fb : Number(v) || fb);

async function conf(centroEmissao?: string): Promise<Conf> {
  if (centroEmissao !== undefined) {
    if (!/^[a-f0-9-]{36}$/i.test(centroEmissao)) throw new Error("Centro do título inválido.");
    const url = process.env["EXT_SUPABASE_URL"]?.replace(/\/$/, "");
    const key = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
    if (!url || !key) throw new Error("Configuração segura indisponível.");
    const response = await fetchWithTimeout(
      `${url}/rest/v1/cobranca_centros?select=banco,canal,ativo&centro_id=eq.${centroEmissao}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!response.ok) throw new Error("Confira a migração fase237 para cobrança por centro.");
    const rows = (await response.json()) as DbRow[];
    if (
      rows[0]?.["banco"] !== "sicredi" ||
      rows[0]?.["canal"] !== "api" ||
      rows[0]?.["ativo"] !== true
    )
      throw new Error(
        "Sicredi API não habilitado para o centro deste título. Configure em Centros de custo.",
      );
  }
  const row = await dbConfig();
  if (!row) throw new Error("Cadastre o convênio Sicredi em Centros de custo.");
  const ambiente = (txt(row?.["ambiente"]) || "homologacao").toLowerCase();
  const base =
    ambiente === "producao"
      ? "https://api-parceiro.sicredi.com.br"
      : "https://api-parceiro.sicredi.com.br/sb";
  const c: Conf = {
    apiKey:
      ambiente === "homologacao"
        ? txt(row?.["sandbox_api_key"]) || ""
        : txt(row?.["api_key"]) || "",
    username: ambiente === "homologacao" ? SICREDI_SANDBOX.username : txt(row?.["username"]) || "",
    password: ambiente === "homologacao" ? SICREDI_SANDBOX.password : txt(row?.["password"]) || "",
    cooperativa:
      ambiente === "homologacao" ? SICREDI_SANDBOX.cooperativa : txt(row?.["cooperativa"]) || "",
    posto: ambiente === "homologacao" ? SICREDI_SANDBOX.posto : txt(row?.["posto"]) || "",
    beneficiario:
      ambiente === "homologacao"
        ? SICREDI_SANDBOX.beneficiario
        : txt(row?.["codigo_beneficiario"]) || "",
    ambiente,
    base,
    tipoCobranca: txt(row?.["tipo_cobranca"], "NORMAL") || "NORMAL",
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
      `Credenciais do Sicredi ausentes: ${faltando.join(", ")}. Cadastre em Centros de custo → Cobrança.`,
    );
  }
  if (!["homologacao", "producao"].includes(c.ambiente))
    throw new Error("Ambiente Sicredi inválido.");
  if (c.ambiente === "producao" && c.username !== `${c.beneficiario}${c.cooperativa}`)
    throw new Error(
      "Usuário de produção deve ser o código do beneficiário (5 dígitos) seguido da cooperativa (4 dígitos).",
    );
  for (const [name, value] of [
    ["juros", c.juros],
    ["multa", c.multa],
    ["desconto", c.valorDesconto1],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || Math.round(value * 100) / 100 !== value)
      throw new Error(
        `Confira ${name}: Sicredi exige valor não negativo com até duas casas decimais.`,
      );
  }
  if (
    !Number.isInteger(c.diasProtesto) ||
    c.diasProtesto < 0 ||
    c.diasProtesto > 99 ||
    !Number.isInteger(c.validadeAposVencimento) ||
    c.validadeAposVencimento < 0 ||
    c.validadeAposVencimento > 9999
  )
    throw new Error("Prazos de cobrança fora dos limites do manual Sicredi.");
  return c;
}

async function token(c: Conf): Promise<string> {
  return tokenSicredi(c, serviceRpc);
}
function conferirConvenio(b: DbRow, c: Conf) {
  if (
    b["cooperativa"] !== c.cooperativa ||
    b["posto"] !== c.posto ||
    b["codigo_beneficiario"] !== c.beneficiario ||
    b["ambiente"] !== c.ambiente
  )
    throw new Error(
      "O convênio ou ambiente atual não corresponde ao boleto. Selecione o ambiente em que ele foi emitido.",
    );
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
export const sicrediStatus = createServerFn({ method: "POST" })
  .inputValidator((data: { accessToken?: string; centro_id?: string }) => data)
  .handler(async ({ data }) => {
    const { user } = await requireSicrediAccess("sicredi_status", 30, data.accessToken);
    try {
      if (!data.centro_id)
        throw new Error("Selecione um centro de custo para consultar a configuração de cobrança.");
      await serviceRpc("validar_cobranca_centro_237", { _actor: user.id, _centro: data.centro_id });
      const c = await conf(data.centro_id);
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

type EmitirInput = { contaId: string; accessToken?: string };

/** Registra o boleto no Sicredi e devolve nosso numero / linha digitavel / PIX. */
export const sicrediEmitirBoleto = createServerFn({ method: "POST" })
  .inputValidator((data: EmitirInput) => data)
  .handler(async ({ data }) => {
    const { user, accessToken } = await requireSicrediAccess(
      "sicredi_emitir_boleto",
      10,
      data.accessToken,
    );
    const row = await carregarTituloBoleto(accessToken, data.contaId);
    const documentoPagador = documentoFiscal(String(row["cnpj_cpf"] ?? ""));
    if (!String(row["razao_social"] ?? "").trim())
      throw new Error("Informe o nome do pagador antes de emitir.");
    const cep = String(row["cep"] ?? "").replace(/\D/g, "");
    if (String(row["uf"] ?? "").trim() && !/^[A-Za-z]{2}$/.test(String(row["uf"])))
      throw new Error("UF do pagador inválida.");
    if (String(row["cep"] ?? "").trim() && !/^\d{8}$/.test(cep))
      throw new Error("Informe o CEP do pagador com 8 dígitos antes de emitir.");
    if (!Number.isFinite(Number(row["saldo"])) || Number(row["saldo"]) <= 0)
      throw new Error("Título sem saldo válido.");
    const c = await conf(String(row["centro_id"] ?? ""));
    const tk = await token(c);
    // Reserva a emissão antes da chamada externa: serializa concorrência e
    // aloca um seuNumero novo quando houver reemissão após baixa/cancelamento.
    const reserva = await serviceRpc<DbRow>("preparar_boleto_sicredi_servidor", {
      _actor_id: user.id,
      _conta_id: data.contaId,
    });
    const seuNumero = String(reserva["seu_numero"] ?? "").trim();
    if (!seuNumero) throw new Error("Não foi possível reservar o identificador do boleto.");
    conferirConvenio(reserva, c);
    if (
      Number(row["saldo"]) !== Number(reserva["valor"]) ||
      row["vencimento"] !== reserva["vencimento"]
    )
      throw new Error("Título mudou durante a reserva. Atualize antes de emitir.");
    const recente = await conf(String(row["centro_id"] ?? ""));
    if (JSON.stringify(recente) !== JSON.stringify(c))
      throw new Error("Configuração mudou durante a emissão. Atualize antes de continuar.");
    let recuperado: Record<string, unknown> | null = null;
    if (
      (reserva["emissao_retentativa"] === true || Number(reserva["tentativas"] ?? 1) > 1) &&
      reserva["emissao_inconclusiva"] !== false
    ) {
      if (c.ambiente !== "producao")
        throw new Error(
          "Emissão de teste inconclusiva. A consulta de recuperação não está documentada no sandbox; confira o registro com o Sicredi antes de reenviar.",
        );
      const consulta = await fetchWithTimeout(
        `${c.base}/cobranca/boleto/v1/boletos/cadastrados?codigoBeneficiario=${encodeURIComponent(c.beneficiario)}&seuNumero=${encodeURIComponent(seuNumero)}`,
        { headers: headers(c, tk) },
      );
      if (consulta.status !== 404) {
        if (!consulta.ok)
          throw new Error(
            "Não foi possível conferir o registro anterior no Sicredi. Nenhum boleto foi reenviado.",
          );
        const matches = await consulta.json();
        if (!Array.isArray(matches) || matches.length !== 1)
          throw new Error(
            "Consulta anterior sem resultado inequívoco. Concilie antes de reenviar.",
          );
        const item = matches[0] as Record<string, unknown>;
        const pagador = item["pagador"] as Record<string, unknown> | undefined;
        if (
          item["seuNumero"] !== seuNumero ||
          Number(item["valorNominal"]) !== Number(reserva["valor"]) ||
          String(pagador?.["documento"] ?? "") !== documentoPagador
        )
          throw new Error(
            "Registro anterior diverge do título ou pagador. Nenhum boleto foi reenviado.",
          );
        linhaDigitavelSicredi(item["linhaDigitavel"]);
        if (!/^\d{44}$/.test(String(item["codigoBarras"] ?? "")))
          throw new Error("Sicredi retornou registro anterior sem código de barras válido.");
        recuperado = item;
      }
    }
    const juros = c.juros;
    const multa = c.multa;
    const diasProtesto = c.diasProtesto;
    const vencimento = String(row["vencimento"] ?? "");
    const dataDesconto1 =
      c.valorDesconto1 > 0 && c.diasDesconto1 >= 0
        ? shiftIsoDate(vencimento, -c.diasDesconto1)
        : null;
    const dataInicioMulta =
      c.tipoCobranca === "NORMAL" && multa > 0 && c.diasMulta > 0
        ? shiftIsoDate(vencimento, c.diasMulta)
        : null;
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
      dataVencimento: vencimento,
      valor: Number(Number(row["saldo"] ?? 0).toFixed(2)),
      ...(c.tipoDesconto !== "NAO_TEM_DESCONTO" && c.valorDesconto1 > 0 && dataDesconto1
        ? {
            tipoDesconto: c.tipoDesconto,
            valorDesconto1: c.valorDesconto1,
            dataDesconto1,
          }
        : {}),
      ...(juros > 0 && c.tipoJuro !== "ISENTO"
        ? {
            tipoJuros: c.tipoJuro,
            ...(c.tipoJuro === "PERCENTUAL" ? { tipoJurosPercentual: "MENSAL" } : {}),
            juros,
          }
        : {}),
      ...(multa > 0
        ? {
            tipoMulta: "PERCENTUAL",
            multa,
            ...(dataInicioMulta ? { dataInicioMulta } : {}),
          }
        : {}),
      ...(c.tipoProtesto === "PROTESTAR" && diasProtesto > 0
        ? { diasProtestoAuto: diasProtesto }
        : {}),
      ...(c.tipoProtesto === "NEGATIVAR" && diasProtesto > 0
        ? { diasNegativacaoAuto: diasProtesto }
        : {}),
      ...(c.tipoCobranca === "HIBRIDO" && c.validadeAposVencimento > 0
        ? { validadeAposVencimento: c.validadeAposVencimento }
        : {}),
      ...(informativo ? { informativos: [informativo.slice(0, 80)] } : {}),
      ...(c.mensagem ? { mensagens: [c.mensagem.slice(0, 80)] } : {}),

      pagador: {
        tipoPessoa: documentoPagador.length === 11 ? "PESSOA_FISICA" : "PESSOA_JURIDICA",
        documento: documentoPagador,
        // O endpoint de registro recusa nomes acima de40, inclusive no sandbox.
        // A redução vale somente para o payload bancário; o cadastro permanece completo.
        nome: String(row["razao_social"] ?? "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 40)
          .trimEnd(),
        ...(endereco ? { endereco: endereco.slice(0, 40) } : {}),
        ...(row["cidade"] ? { cidade: String(row["cidade"]).slice(0, 40) } : {}),
        ...(row["uf"] ? { uf: String(row["uf"]).toUpperCase() } : {}),
        ...(cep ? { cep } : {}),
        ...(row["telefone"]
          ? { telefone: String(row["telefone"]).replace(/\D/g, "").slice(0, 11) }
          : {}),
        ...(row["email"] ? { email: String(row["email"]).slice(0, 40) } : {}),
      },
    };
    let txt: string;
    let json: Record<string, unknown>;
    if (recuperado) {
      json = recuperado;
      txt = JSON.stringify(recuperado);
    } else {
      // Grava ANTES do POST; se o armazenamento falhar, não há envio externo.
      // Assim uma nova tentativa não ignora um possível aceite bancário.
      await serviceRpc("sicredi_marcar_emissao_224", {
        _actor: user.id,
        _boleto: reserva["id"],
        _estado: "inconclusivo",
      });
      let res: Response;
      try {
        res = await fetchWithTimeout(`${c.base}/cobranca/boleto/v1/boletos`, {
          method: "POST",
          headers: headers(c, tk),
          body: JSON.stringify(payload),
        });
      } catch {
        await serviceRpc("sicredi_marcar_emissao_224", {
          _actor: user.id,
          _boleto: reserva["id"],
          _estado: "inconclusivo",
        });
        throw new Error(
          "Resposta de emissão inconclusiva. O identificador foi preservado; a próxima tentativa consulta o banco antes de reenviar.",
        );
      }
      try {
        txt = await res.text();
      } catch {
        await serviceRpc("sicredi_marcar_emissao_224", {
          _actor: user.id,
          _boleto: reserva["id"],
          _estado: "inconclusivo",
        });
        throw new Error("Resposta de emissão interrompida. Confira o registro antes de reenviar.");
      }
      if (!res.ok) {
        const definitiva = [400, 401, 403, 422].includes(res.status);
        const motivo = definitiva
          ? motivoRecusaSicredi(txt, [c.apiKey, c.password, tk, accessToken])
          : null;
        const recusa = `Sicredi recusou o registro (${res.status}). ${motivo ? `Motivo: ${motivo}` : "O banco não retornou um motivo de validação reconhecido. Confira os dados do título e as regras do convênio."}`;
        if (definitiva)
          await serviceRpc("registrar_erro_boleto_sicredi_servidor", {
            _actor_id: user.id,
            _conta_id: data.contaId,
            _seu_numero: seuNumero,
            _erro: recusa,
          });
        await serviceRpc("sicredi_marcar_emissao_224", {
          _actor: user.id,
          _boleto: reserva["id"],
          _estado: definitiva ? "rejeitado" : "inconclusivo",
        });
        throw new Error(
          definitiva
            ? recusa
            : "Resposta bancária inconclusiva. Consulte o registro antes de reenviar.",
        );
      }
      try {
        json = JSON.parse(txt) as Record<string, unknown>;
        linhaDigitavelSicredi(json["linhaDigitavel"]);
        if (!/^\d{9}$/.test(String(json["nossoNumero"] ?? "")))
          throw new Error("Nosso número inválido");
      } catch {
        await serviceRpc("sicredi_marcar_emissao_224", {
          _actor: user.id,
          _boleto: reserva["id"],
          _estado: "inconclusivo",
        });
        throw new Error(
          "Sicredi respondeu sem os dados completos do registro. Confira antes de reenviar.",
        );
      }
    }
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
    await serviceRpc("sicredi_marcar_emissao_224", {
      _actor: user.id,
      _boleto: reserva["id"],
      _estado: "confirmado",
    });
    return {
      recuperado: !!recuperado,
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
  .inputValidator((data: { boletoId: string; accessToken?: string }) => data)
  .handler(async ({ data }) => {
    const { user, accessToken } = await requireSicrediAccess(
      "sicredi_consultar_boleto",
      30,
      data.accessToken,
    );
    const boleto = await carregarBoleto(accessToken, data.boletoId);
    const nossoNumero = String(boleto["nosso_numero"]);
    const c = await conf();
    conferirConvenio(boleto, c);
    const tk = await token(c);
    const consultaVersao = c.ambiente === "producao" ? "v2" : "v1";
    const url = `${c.base}/cobranca/boleto/${consultaVersao}/boletos?codigoBeneficiario=${encodeURIComponent(
      c.beneficiario,
    )}&nossoNumero=${encodeURIComponent(nossoNumero)}`;
    const consultaHeaders = {
      ...headers(c, tk),
      ...(consultaVersao === "v2" ? { "data-movimento": "true" } : {}),
    };
    const res = await fetchWithTimeout(url, { headers: consultaHeaders });
    const txt = await res.text();
    if (!res.ok) throw new Error(`Consulta Sicredi falhou (${res.status}): ${txt.slice(0, 300)}`);
    const json = JSON.parse(txt || "{}") as Record<string, unknown>;
    if (
      boleto["vencimento_solicitacao_id"] &&
      vencimentoDoBanco(json["dataVencimento"]) === boleto["vencimento_solicitado"]
    ) {
      await serviceRpc("sicredi_finalizar_vencimento", {
        _actor: user.id,
        _solicitacao: boleto["vencimento_solicitacao_id"],
        _estado: "confirmado",
        _vencimento_banco: boleto["vencimento_solicitado"],
      });
    }
    const situacao = String(
      (json["situacao"] as string) ?? (json["situacaoBoleto"] as string) ?? "",
    ).toLowerCase();
    if (!situacao.trim())
      throw new Error("Sicredi não informou uma situação válida. Nenhuma baixa foi registrada.");
    const liquidado = situacao.includes("liquidad");
    const baixado = situacao.includes("baixad") || situacao.includes("cancelad");
    if (liquidado) {
      if (c.ambiente === "homologacao")
        return {
          situacao: "liquidado no sandbox (simulação, sem movimentação financeira)",
          liquidado: false,
          baixado: false,
          retorno: txt.slice(0, 4000),
        };
      await serviceRpc("sicredi_liquidar_api_224", {
        _actor: user.id,
        _boleto: data.boletoId,
        _dados: liquidacaoSicredi(json),
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
  .inputValidator((data: { boletoId: string; accessToken?: string }) => data)
  .handler(async ({ data }) => {
    const { user, accessToken } = await requireSicrediAccess(
      "sicredi_baixar_boleto",
      10,
      data.accessToken,
    );
    const boleto = await carregarBoleto(accessToken, data.boletoId);
    const nossoNumero = String(boleto["nosso_numero"]);
    const c = await conf();
    conferirConvenio(boleto, c);
    const tk = await token(c);
    const res = await fetchWithTimeout(
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
  .inputValidator((data: { boletoId: string; accessToken?: string }) => data)
  .handler(async ({ data }) => {
    const { accessToken } = await requireSicrediAccess("sicredi_pdf_boleto", 20, data.accessToken);
    const boleto = await carregarBoleto(accessToken, data.boletoId, false);
    const linha = linhaDigitavelSicredi(boleto["linha_digitavel"]);
    const c = await conf();
    conferirConvenio(boleto, c);
    const tk = await token(c);
    const res = await fetchWithTimeout(
      `${c.base}/cobranca/boleto/v1/boletos/pdf?linhaDigitavel=${encodeURIComponent(linha)}`,
      { headers: headers(c, tk) },
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`PDF do boleto indisponivel (${res.status}): ${txt.slice(0, 300)}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (new TextDecoder().decode(buf.subarray(0, 5)) !== "%PDF-")
      throw new Error("Sicredi não retornou um arquivo PDF válido.");
    let bin = "";
    for (const b of buf) bin += String.fromCharCode(b);
    return { base64: btoa(bin) };
  });

/** Confirma o número de registro recuperado consultando a linha digitável no banco. */
export const sicrediConfirmarNossoNumero = createServerFn({ method: "POST" })
  .inputValidator((data: { boletoId: string; nossoNumero: string; accessToken?: string }) => data)
  .handler(async ({ data }) => {
    const { user, accessToken } = await requireSicrediAccess(
      "sicredi_confirmar_numero",
      10,
      data.accessToken,
    );
    if (!/^\d{9}$/.test(data.nossoNumero)) throw new Error("Informe o nosso número com 9 dígitos.");
    const b = await carregarBoleto(accessToken, data.boletoId, false);
    if (b["status"] !== "registrado" || b["nosso_numero"])
      throw new Error("Confirmação disponível somente para registro recuperado sem nosso número.");
    const line = linhaDigitavelSicredi(b["linha_digitavel"]),
      c = await conf();
    conferirConvenio(b, c);
    if (c.ambiente !== "producao")
      throw new Error("Confirme o registro recuperado no ambiente de produção.");
    const tk = await token(c);
    const response = await fetchWithTimeout(
      `${c.base}/cobranca/boleto/v2/boletos?codigoBeneficiario=${encodeURIComponent(c.beneficiario)}&nossoNumero=${encodeURIComponent(data.nossoNumero)}`,
      { headers: headers(c, tk) },
    );
    if (!response.ok) throw new Error("Não foi possível confirmar este nosso número no Sicredi.");
    const json = (await response.json()) as Record<string, unknown>;
    if (
      linhaDigitavelSicredi(json["linhaDigitavel"]) !== line ||
      (json["nossoNumero"] && json["nossoNumero"] !== data.nossoNumero)
    )
      throw new Error(
        "O nosso número informado pertence a outro boleto. Nenhuma identificação foi alterada.",
      );
    await serviceRpc("sicredi_vincular_numero_224", {
      _actor: user.id,
      _boleto: data.boletoId,
      _nosso: data.nossoNumero,
      _linha: line,
    });
    return { ok: true };
  });

/** PATCH data-vencimento; atualização local somente após conferência na consulta bancária. */
export const sicrediAlterarVencimento = createServerFn({ method: "POST" })
  .inputValidator((data: { boletoId: string; vencimento: string; accessToken?: string }) => data)
  .handler(async ({ data }) => {
    const { user, accessToken } = await requireSicrediAccess(
      "sicredi_vencimento",
      10,
      data.accessToken,
    );
    validarNovoVencimento(data.vencimento);
    const b = await carregarBoleto(accessToken, data.boletoId);
    if (b["status"] !== "registrado")
      throw new Error("Somente boletos registrados permitem alterar o vencimento.");
    const c = await conf();
    if (
      b["cooperativa"] !== c.cooperativa ||
      b["posto"] !== c.posto ||
      b["codigo_beneficiario"] !== c.beneficiario ||
      b["ambiente"] !== c.ambiente
    )
      throw new Error("O convênio atual não corresponde ao boleto emitido.");
    const tk = await token(c);
    const id = await serviceRpc<string>("sicredi_solicitar_vencimento", {
      _actor: user.id,
      _boleto: data.boletoId,
      _vencimento: data.vencimento,
      _anterior: b["vencimento"],
      _arquivo: null,
    });
    let response: Response;
    try {
      response = await fetchWithTimeout(
        `${c.base}/cobranca/boleto/v1/boletos/${encodeURIComponent(String(b["nosso_numero"]))}/data-vencimento`,
        {
          method: "PATCH",
          headers: headers(c, tk),
          body: JSON.stringify({ dataVencimento: data.vencimento }),
        },
      );
    } catch {
      await serviceRpc("sicredi_finalizar_vencimento", {
        _actor: user.id,
        _solicitacao: id,
        _estado: "incerto",
        _vencimento_banco: null,
      });
      return {
        pendente: true,
        mensagem:
          "Resposta do banco indisponível. Confira a alteração pela consulta; não reenvie a solicitação.",
      };
    }
    if (!response.ok) {
      const uncertain = response.status >= 500 || response.status === 408;
      await serviceRpc("sicredi_finalizar_vencimento", {
        _actor: user.id,
        _solicitacao: id,
        _estado: uncertain ? "incerto" : "rejeitado",
        _vencimento_banco: null,
      });
      if (uncertain)
        return {
          pendente: true,
          mensagem: "Resposta do banco inconclusiva. Confira a alteração pela consulta.",
        };
      throw new Error(`Sicredi rejeitou a alteração de vencimento (HTTP ${response.status}).`);
    }
    await serviceRpc("sicredi_finalizar_vencimento", {
      _actor: user.id,
      _solicitacao: id,
      _estado: "enviado",
      _vencimento_banco: null,
    });
    return {
      pendente: true,
      mensagem: "Alteração enviada ao Sicredi. Consulte o boleto para confirmar o novo vencimento.",
    };
  });
