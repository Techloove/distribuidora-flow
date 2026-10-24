import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { enforceRateLimit, requestAccessToken, requireServerAuth } from "./server-auth";
import { fetchWithTimeout } from "./fetch-timeout";
import { testarAcessoForecast } from "./server-forecast";

const entrada = z.object({ accessToken: z.string().optional(), loja: z.string().uuid() });
const salvarEntrada = entrada.extend({
  cnpj: z.string().regex(/^[A-Z0-9]{12}[0-9]{2}$/),
  token: z.string().max(2048),
  ambiente: z.enum(["homologacao", "producao"]),
});
type Estado = {
  cnpj_loja: string;
  cnpj_configurado: string | null;
  token_configurado: boolean;
  ambiente_declarado: "homologacao" | "producao" | null;
  vinculo_atual: boolean;
  emissao_disponivel: false;
  updated_at: string | null;
};
function supabaseEnv() {
  const url = process.env["EXT_SUPABASE_URL"]?.replace(/\/$/, "");
  const anon = process.env["EXT_SUPABASE_ANON_KEY"];
  if (!url || !anon) throw new Error("Configuração do Supabase indisponível no servidor.");
  return { url, anon };
}
async function rpc<T>(
  accessToken: string,
  nome: string,
  valores: Record<string, unknown>,
): Promise<T> {
  const { url, anon } = supabaseEnv();
  const r = await fetchWithTimeout(`${url}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(valores),
  });
  if (!r.ok) {
    // Não propagar detalhes SQL: erros de constraints podem conter a credencial.
    throw new Error(
      "Operação Forecast não permitida. Confira permissões, CNPJ, provedor e aplicação da fase262.",
    );
  }
  return (await r.json()) as T;
}
async function autorizar(data: z.infer<typeof entrada>, admin = false) {
  const token = data.accessToken || requestAccessToken() || "";
  await requireServerAuth(token, admin ? ["admin"] : ["admin", "gestor"]);
  await enforceRateLimit(token, "forecast_config", 20, 60);
  const estado = await rpc<Estado>(token, "estado_conexao_forecast_262", { _loja: data.loja });
  return { token, estado };
}
export const forecastConexaoGet = createServerFn({ method: "POST" })
  .validator((data: unknown) => entrada.parse(data))
  .handler(async ({ data }) => (await autorizar(data)).estado);

export const forecastConexaoSave = createServerFn({ method: "POST" })
  .validator((data: unknown) => salvarEntrada.parse(data))
  .handler(async ({ data }) => {
    const { token } = await autorizar(data, true);
    if (data.token && !/^[\x21-\x39\x3b-\x7e]+$/.test(data.token))
      throw new Error("Token inválido. Informe apenas o token, sem prefixo Basic.");
    await rpc(token, "salvar_conexao_forecast_262", {
      _loja: data.loja,
      _cnpj: data.cnpj,
      _token: data.token,
      _ambiente: data.ambiente,
    });
    return { salvo: true };
  });

export const forecastConexaoTest = createServerFn({ method: "POST" })
  .validator((data: unknown) => entrada.parse(data))
  .handler(async ({ data }) => {
    const { token, estado } = await autorizar(data, true);
    if (!estado.token_configurado || !estado.vinculo_atual)
      throw new Error("Configure a Forecast para o CNPJ atual da loja antes de testar.");
    const { url } = supabaseEnv();
    const service = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
    if (!service) throw new Error("Configure a chave segura do Supabase no servidor.");
    const r = await fetchWithTimeout(
      `${url}/rest/v1/forecast_credenciais_262?select=token,cnpj,updated_at&centro_id=eq.${data.loja}&limit=1`,
      { headers: { apikey: service, Authorization: `Bearer ${service}` }, redirect: "error" },
    );
    if (!r.ok) throw new Error("Não foi possível carregar a credencial Forecast protegida.");
    const rows = (await r.json()) as { token: string; cnpj: string; updated_at: string }[];
    const cred = rows[0];
    if (!cred?.token || cred.cnpj !== estado.cnpj_loja || cred.updated_at !== estado.updated_at)
      throw new Error("Configuração fiscal alterada. Recarregue antes de testar.");
    const resultado = await testarAcessoForecast(cred.token, cred.cnpj);
    const atual = await rpc<Estado>(token, "estado_conexao_forecast_262", { _loja: data.loja });
    if (
      !atual.vinculo_atual ||
      atual.updated_at !== estado.updated_at ||
      atual.cnpj_loja !== estado.cnpj_loja
    )
      throw new Error(
        "Configuração fiscal alterada durante a consulta. Recarregue e teste novamente.",
      );
    return resultado;
  });
