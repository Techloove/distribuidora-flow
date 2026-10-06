import { validarNovoVencimento } from "./sicredi-vencimento";
import { createServerFn } from "@tanstack/react-start";
import { enforceRateLimit, requestAccessToken, requireServerAuth } from "./server-auth";
import { fetchWithTimeout } from "./fetch-timeout";
import {
  cents,
  digits,
  gerarRemessa,
  gerarBrCode,
  gerarAlteracaoVencimento,
  nossoNumero,
  parseRetorno,
  validateConfig,
  type CnabConfig,
  type CnabTitulo,
} from "./sicredi-cnab";

type Input = { accessToken?: string; centro_id: string };
type ConfigRow = CnabConfig & { updated_at: string };
type Row = Record<string, unknown>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function authorize(data: Input, action: string, admin = false) {
  if (!UUID.test(data.centro_id)) throw new Error("Selecione um centro de custo.");
  const token = data.accessToken || requestAccessToken();
  const actor = await requireServerAuth(
    token,
    admin ? ["admin", "gestor"] : ["admin", "gestor", "financeiro"],
  );
  await enforceRateLimit(token, action, 20, 60);
  return { actor, token: token! };
}
async function rest<T>(path: string, token: string, service = false, body?: unknown): Promise<T> {
  const url = process.env["EXT_SUPABASE_URL"]?.replace(/\/$/, "");
  const key = process.env[service ? "EXT_SUPABASE_SERVICE_ROLE_KEY" : "EXT_SUPABASE_ANON_KEY"];
  if (!url || !key) throw new Error("Configuração segura do Supabase indisponível no servidor.");
  const response = await fetchWithTimeout(`${url}/rest/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${service ? key : token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const text = await response.text();
    let message =
      "Falha na rotina CNAB. Confira se as migrações fase204 e fase205 foram aplicadas.";
    try {
      const error = JSON.parse(text);
      if (error.code === "P0001") message = String(error.message);
    } catch {
      /* sem expor respostas externas */
    }
    throw new Error(message);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}
async function config(centro: string, token: string) {
  const rows = await rest<ConfigRow[]>(
    `sicredi_cnab_config?centro_id=eq.${centro}&select=*`,
    token,
  );
  if (!rows[0]) throw new Error("Configure o CNAB 240 deste centro antes de continuar.");
  return rows[0];
}
async function sha256(text: string) {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(result), (b) => b.toString(16).padStart(2, "0")).join("");
}
function today() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: part("hour") + part("minute") + part("second"),
  };
}

export const cnabSalvarConfig = createServerFn({ method: "POST" })
  .validator((data: Input & { config: CnabConfig }) => data)
  .handler(async ({ data }) => {
    const { actor, token } = await authorize(data, "cnab_config", true);
    const c = {
      ...data.config,
      centro_id: data.centro_id,
      documento: digits(data.config.documento),
    };
    validateConfig(c);
    await rest("rpc/cnab_salvar_config", token, true, { _actor: actor.id, _config: c });
    return { ok: true };
  });

export const cnabGerarRemessa = createServerFn({ method: "POST" })
  .validator((data: Input & { conta_ids: string[] }) => data)
  .handler(async ({ data }) => {
    const { actor, token } = await authorize(data, "cnab_remessa");
    const ids = data.conta_ids;
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 500 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !UUID.test(id))
    )
      throw new Error("Selecione de 1 a 500 títulos distintos.");
    const c = await config(data.centro_id, token);
    const rows = await rest<Row[]>(
      `contas_receber?select=*&centro_id=eq.${data.centro_id}&id=in.(${ids.join(",")})&order=id&limit=500`,
      token,
    );
    if (rows.length !== ids.length)
      throw new Error("Título não encontrado ou sem acesso ao centro.");
    const clientIds = [...new Set(rows.map((r) => String(r["cliente_id"])))];
    if (clientIds.some((id) => !UUID.test(id))) throw new Error("Título sem cliente válido.");
    const clients = await rest<Row[]>(
      `clientes?select=*&id=in.(${clientIds.join(",")})&limit=500`,
      token,
    );
    const stamp = today();
    if (c.proximo_nosso_numero + rows.length > 100000)
      throw new Error("Sequencial de nosso número esgotado. Consulte a cooperativa.");
    const titulos: CnabTitulo[] = rows.map((r, index) => {
      const cli = clients.find((v) => v["id"] === r["cliente_id"]);
      if (!cli) throw new Error("Cliente não encontrado ou sem acesso.");
      const amount =
        ["valor", "juros", "multa", "acrescimo"].reduce(
          (sum, k) => sum + cents(String(r[k] ?? 0)),
          0n,
        ) -
        cents(String(r["desconto"] ?? 0)) -
        cents(String(r["valor_pago"] ?? 0));
      if (amount <= 0n) throw new Error("Título sem saldo.");
      const s = (key: string) => String(cli[key] ?? "");
      return {
        conta_id: String(r["id"]),
        documento: "C" + crypto.randomUUID().replace(/-/g, "").slice(0, 9).toUpperCase(),
        nosso_numero: nossoNumero(
          c,
          Number(stamp.date.slice(0, 4)),
          c.proximo_nosso_numero + index,
        ),
        valor: `${amount / 100n}.${(amount % 100n).toString().padStart(2, "0")}`,
        vencimento: String(r["vencimento"]),
        emissao: stamp.date,
        nome: s("razao_social"),
        cpf_cnpj: s("cnpj_cpf"),
        endereco: [s("logradouro"), s("numero"), s("complemento")].filter(Boolean).join(" "),
        bairro: s("bairro"),
        cep: s("cep"),
        cidade: s("cidade"),
        uf: s("uf").toUpperCase(),
      };
    });
    const file = gerarRemessa(c, titulos, stamp.date, stamp.time);
    const id = await rest<string>("rpc/cnab_gravar_remessa", token, true, {
      _actor: actor.id,
      _centro: data.centro_id,
      _versao: c.updated_at,
      _sequencia: c.proxima_remessa,
      _nosso_inicio: c.proximo_nosso_numero,
      _nome: file.filename,
      _conteudo: file.content,
      _sha256: await sha256(file.content),
      _titulos: titulos,
    });
    return { id, ...file, homologado: c.homologado };
  });

async function analyze(data: Input & { content: string }, token: string) {
  const c = await config(data.centro_id, token);
  const events = parseRetorno(data.content, c).map((e) => ({
    ...e,
    ...(e.pix?.url ? { qrcode_pix: gerarBrCode(e.pix.url) } : {}),
  }));
  const numbers = [...new Set(events.map((e) => e.nosso_numero))];
  const boletos = await rest<Row[]>(
    `boletos?select=*&canal=eq.cnab240&centro_id=eq.${data.centro_id}&nosso_numero=in.(${numbers.join(",")})&limit=500`,
    token,
  );
  return {
    c,
    events,
    preview: events.map((e) => {
      const b = boletos.find((b) => b["nosso_numero"] === e.nosso_numero);
      return {
        ...e,
        boleto_id: b ? String(b["id"]) : null,
        status_atual: b ? String(b["status"]) : null,
        problema: !b
          ? "Nosso número não encontrado neste centro"
          : cents(String(b["valor"])) !== cents(e.valor_titulo)
            ? "Valor nominal divergente"
            : b["seu_numero"] !== e.documento
              ? "Documento divergente"
              : e.ocorrencia === "14" &&
                  b["vencimento_solicitacao_id"] &&
                  b["vencimento_solicitado"] !== e.vencimento
                ? "Vencimento confirmado pelo banco diverge da solicitação"
                : ["06", "17", "61"].includes(e.ocorrencia) &&
                    (!e.data_ocorrencia || cents(e.valor_recebido) <= 0n)
                  ? "Liquidação sem valor ou data"
                  : ["06", "17", "61"].includes(e.ocorrencia) &&
                      cents(e.valor_recebido) !==
                        cents(e.valor_titulo) +
                          cents(e.juros) -
                          cents(e.desconto) -
                          cents(e.abatimento)
                    ? "Liquidação parcial ou valores de encargos divergentes: concilie manualmente"
                    : ["06", "17", "61"].includes(e.ocorrencia) && cents(e.iof) !== 0n
                      ? "IOF exige conciliação manual"
                      : ["06", "17", "61"].includes(e.ocorrencia) &&
                          (cents(e.outras_despesas) !== 0n || cents(e.outros_creditos) !== 0n)
                        ? "Outras despesas/créditos exigem conciliação manual"
                        : ["06", "17", "61"].includes(e.ocorrencia) &&
                            cents(e.valor_liquido) > cents(e.valor_recebido)
                          ? "Valor líquido superior ao recebido"
                          : ["06", "17", "61"].includes(e.ocorrencia) &&
                              cents(e.valor_recebido) > cents(e.valor_liquido) &&
                              !c.categoria_tarifa_id
                            ? "Configure a categoria de tarifas bancárias"
                            : null,
      };
    }),
  };
}
export const cnabPreverRetorno = createServerFn({ method: "POST" })
  .validator((data: Input & { content: string }) => data)
  .handler(async ({ data }) => {
    const { token } = await authorize(data, "cnab_prever");
    const result = await analyze(data, token);
    return { eventos: result.preview, homologado: result.c.homologado };
  });
export const cnabImportarRetorno = createServerFn({ method: "POST" })
  .validator((data: Input & { content: string; filename: string; confirmado: boolean }) => data)
  .handler(async ({ data }) => {
    const { actor, token } = await authorize(data, "cnab_retorno");
    if (data.confirmado !== true)
      throw new Error("Confirme a origem do retorno antes de importar.");
    const result = await analyze(data, token);
    if (result.preview.some((e) => e.problema))
      throw new Error("Resolva as divergências da prévia antes de importar.");
    if (!result.c.homologado) throw new Error("Confirme a homologação na configuração CNAB.");
    const id = await rest<string>("rpc/cnab_gravar_retorno", token, true, {
      _actor: actor.id,
      _centro: data.centro_id,
      _nome: data.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100),
      _conteudo: data.content,
      _sha256: await sha256(data.content),
      _eventos: result.events,
    });
    return { id };
  });

export const cnabAlterarVencimento = createServerFn({ method: "POST" })
  .validator((data: Input & { boleto_id: string; vencimento: string }) => data)
  .handler(async ({ data }) => {
    const { actor, token } = await authorize(data, "cnab_vencimento");
    if (!UUID.test(data.boleto_id)) throw new Error("Boleto inválido.");
    validarNovoVencimento(data.vencimento);
    const c = await config(data.centro_id, token);
    const [b] = await rest<Row[]>(
      `boletos?select=*&id=eq.${data.boleto_id}&centro_id=eq.${data.centro_id}&canal=eq.cnab240`,
      token,
    );
    if (!b || b["status"] !== "registrado" || !UUID.test(String(b["cnab_remessa_id"])))
      throw new Error("Boleto não apto para alteração CNAB.");
    const [original] = await rest<Row[]>(
      `sicredi_cnab_arquivos?select=conteudo&id=eq.${b["cnab_remessa_id"]}&centro_id=eq.${data.centro_id}`,
      token,
    );
    if (!original) throw new Error("Remessa original não encontrada.");
    const stamp = today();
    const file = gerarAlteracaoVencimento(
      c,
      String(original["conteudo"]),
      String(b["nosso_numero"]),
      data.vencimento,
      stamp.date,
      stamp.time,
    );
    await rest("rpc/sicredi_solicitar_vencimento", token, true, {
      _actor: actor.id,
      _boleto: data.boleto_id,
      _vencimento: data.vencimento,
      _anterior: b["vencimento"],
      _arquivo: {
        versao: c.updated_at,
        sequencia: c.proxima_remessa,
        nome: file.filename,
        conteudo: file.content,
        sha256: await sha256(file.content),
      },
    });
    return file;
  });
