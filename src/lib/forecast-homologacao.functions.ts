import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireServerAuth, requestAccessToken, enforceRateLimit } from "./server-auth";
import { fetchWithTimeout } from "./fetch-timeout";
import { montarEmissaoHomologacao, opcoesHomologacaoSchema } from "./forecast-emissao";
import { executarHomologacao, type JobHomologacao } from "./server-forecast-emissao";

const entrada = z.object({ accessToken: z.string().optional(), nota: z.string().uuid() });
const lojaEntrada = z.object({ accessToken: z.string().optional(), loja: z.string().uuid() });
function env() {
  const url = process.env["EXT_SUPABASE_URL"]?.replace(/\/$/, ""),
    anon = process.env["EXT_SUPABASE_ANON_KEY"];
  if (!url || !anon) throw new Error("Configuração Supabase indisponível no servidor.");
  return { url, anon };
}
async function rpc<T>(
  token: string,
  nome: string,
  args: Record<string, unknown>,
  service = false,
): Promise<T> {
  const { url, anon } = env();
  const key = service ? process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"] : anon;
  if (!key) throw new Error("Configure a chave segura Supabase exclusivamente no servidor.");
  const r = await fetchWithTimeout(`${url}/rest/v1/rpc/${nome}`, {
    method: "POST",
    redirect: "error",
    headers: {
      apikey: key,
      Authorization: `Bearer ${service ? key : token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!r.ok)
    throw new Error(
      "Operação de homologação não permitida. Confira permissões, loja/CNPJ, configuração atual e aplicação da fase266. Se uma tentativa já começou, use Consultar, sem reenviar.",
    );
  return (await r.json().catch(() => {
    throw new Error(
      "Resposta interna indisponível. Recarregue o acompanhamento; não repita um envio já iniciado.",
    );
  })) as T;
}
async function autenticar(data: { accessToken?: string | undefined }, admin = false) {
  const token = data.accessToken || requestAccessToken() || "";
  const user = await requireServerAuth(
    token,
    admin ? ["admin"] : ["admin", "gestor", "financeiro"],
  );
  await enforceRateLimit(token, "forecast_homologacao", 20, 60);
  return { token, actor: user.id };
}
const statusSchema = z.object({
  existe: z.boolean(),
  ref: z.string().nullable(),
  estado: z.string().nullable(),
  envio_iniciado: z.boolean(),
  ambiente: z.literal("homologacao"),
  producao_liberada: z.literal(false),
  liberado_para_envio: z.boolean(),
  resultado: z
    .object({
      estado: z.string(),
      mensagem: z.string(),
      chave: z.string().optional(),
      protocolo: z.string().optional(),
      numero: z.string().optional(),
      serie: z.string().optional(),
    })
    .nullable(),
});
async function status(token: string, nota: string) {
  return statusSchema.parse(await rpc(token, "status_hml_forecast_266", { _nota: nota }));
}
export const forecastHmlLiberacaoGet = createServerFn({ method: "POST" })
  .validator((d: unknown) => lojaEntrada.parse(d))
  .handler(async ({ data }) => {
    const { token } = await autenticar(data);
    return z
      .object({ liberado: z.boolean(), producao_liberada: z.literal(false) })
      .parse(await rpc(token, "estado_homologacao_forecast_266", { _loja: data.loja }));
  });
export const forecastHmlLiberacaoSave = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    lojaEntrada.extend({ liberado: z.boolean(), confirmado: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { token } = await autenticar(data, true);
    if (data.liberado && !data.confirmado)
      throw new Error(
        "Confirme o ambiente, empresa, certificado, série e contrato com a Forecast antes de liberar os testes.",
      );
    await rpc(token, "liberar_homologacao_forecast_266", {
      _loja: data.loja,
      _liberado: data.liberado,
    });
    return { salvo: true };
  });
export const forecastHmlStatus = createServerFn({ method: "POST" })
  .validator((d: unknown) => entrada.parse(d))
  .handler(async ({ data }) => {
    const { token } = await autenticar(data);
    return status(token, data.nota);
  });
export const forecastHmlEnviar = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    entrada.extend({ opcoes: opcoesHomologacaoSchema, confirmado: z.literal(true) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { token, actor } = await autenticar(data);
    const atual = await status(token, data.nota);
    if (atual.envio_iniciado) return atual;
    const contexto = await rpc<{ contexto: unknown; versao: string }>(
      token,
      "contexto_envio_forecast_266",
      { _nota: data.nota },
    );
    const payload = montarEmissaoHomologacao(contexto.contexto, data.opcoes);
    await rpc(
      token,
      "reservar_hml_forecast_266",
      { _actor: actor, _nota: data.nota, _contexto_hash: contexto.versao, _payload: payload },
      true,
    );
    await executarHomologacao("enviar", {
      assumir: () =>
        rpc<JobHomologacao | null>(
          token,
          "assumir_hml_forecast_266",
          { _actor: actor, _nota: data.nota, _acao: "enviar", _payload: payload },
          true,
        ),
      registrar: (lease, resultado) =>
        rpc<void>(
          token,
          "registrar_hml_forecast_266",
          { _nota: data.nota, _lease: lease, _resultado: resultado },
          true,
        ),
    });
    return status(token, data.nota);
  });
export const forecastHmlConsultar = createServerFn({ method: "POST" })
  .validator((d: unknown) => entrada.parse(d))
  .handler(async ({ data }) => {
    const { token, actor } = await autenticar(data);
    await status(token, data.nota);
    await executarHomologacao("consultar", {
      assumir: () =>
        rpc<JobHomologacao | null>(
          token,
          "assumir_hml_forecast_266",
          { _actor: actor, _nota: data.nota, _acao: "consultar", _payload: null },
          true,
        ),
      registrar: (lease, resultado) =>
        rpc<void>(
          token,
          "registrar_hml_forecast_266",
          { _nota: data.nota, _lease: lease, _resultado: resultado },
          true,
        ),
    });
    return status(token, data.nota);
  });
