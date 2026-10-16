import { createServerFn } from "@tanstack/react-start";
import { enforceRateLimit, requestAccessToken, requireServerAuth } from "./server-auth";
import { fetchWithTimeout } from "./fetch-timeout";
import { cents, documentoFiscal, gerarBrCode, parseRetorno, type CnabConfig } from "./sicredi-cnab";

type Input = { accessToken?: string; centro_id: string };
type ConfigRow = CnabConfig & { updated_at: string };
type Row = Record<string, unknown>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function authorize(data: Input, action: string, admin = false) {
  if (!admin && !UUID.test(data.centro_id)) throw new Error("Selecione um centro de custo.");
  const token = data.accessToken || requestAccessToken();
  const actor = await requireServerAuth(
    token,
    admin ? ["admin"] : ["admin", "gestor", "financeiro"],
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
      "Falha na rotina CNAB. Confira se as migrações fase204, fase205, fase207 e fase208 foram aplicadas.";
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
async function config(token: string) {
  const rows = await rest<ConfigRow[]>("sicredi_cnab_config?select=*&limit=2", token);
  if (rows.length > 1) throw new Error("Aplique a fase208 para unificar a configuração Sicredi.");
  if (!rows[0]) throw new Error("Configure o convênio CNAB 240 compartilhado antes de continuar.");
  return rows[0];
}
async function sha256(text: string) {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(result), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const cnabGerarRemessa = createServerFn({ method: "POST" })
  .validator((data: Input & { conta_ids: string[] }) => data)
  .handler(async ({ data }) => {
    await authorize(data, "cnab_remessa");
    throw new Error("Sicredi utiliza somente API. Configure a cobrança em Centros de custo.");
  });

async function analyze(data: Input & { content: string }, token: string) {
  const c = await config(token);
  const events = parseRetorno(data.content, c).map((e) => ({
    ...e,
    ...(e.pix?.url ? { qrcode_pix: gerarBrCode(e.pix.url) } : {}),
  }));
  const numbers = [...new Set(events.map((e) => e.nosso_numero))];
  const boletos = await rest<Row[]>(
    `boletos?select=*&canal=eq.cnab240&cooperativa=eq.${c.cooperativa}&posto=eq.${c.posto}&codigo_beneficiario=eq.${c.beneficiario}&nosso_numero=in.(${numbers.join(",")})&limit=500`,
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
        centro_id: b ? String(b["centro_id"]) : null,
        problema: !b
          ? "Nosso número não encontrado no convênio ou sem acesso ao centro"
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
    await authorize(data, "cnab_vencimento");
    throw new Error(
      "Sicredi utiliza somente API. Para boletos CNAB antigos, trate a alteração com o banco.",
    );
  });
