import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { enforceRateLimit, requestAccessToken, requireServerAuth } from "./server-auth";
import { fetchWithTimeout } from "./fetch-timeout";
import { testarAcessoFaznotas } from "./server-faznotas";

const entrada = z.object({ accessToken: z.string().optional(), loja: z.string().uuid() });
const salvarEntrada = entrada.extend({ cnpj: z.string().max(24), token: z.string().max(2048) });
type Estado = {
  cnpj_loja: string;
  cnpj_configurado: string | null;
  token_configurado: boolean;
  cnpj_confere: boolean | null;
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
    const erro = (await r.json().catch(() => ({}))) as { code?: string; message?: string };
    if (erro.code === "P0001") throw new Error(erro.message || "Operação fiscal não permitida.");
    throw new Error("Não foi possível acessar a conexão fiscal. Confira a fase257 no Supabase.");
  }
  return (await r.json()) as T;
}
async function autorizar(data: z.infer<typeof entrada>, admin = false) {
  const token = data.accessToken || requestAccessToken() || "";
  await requireServerAuth(token, admin ? ["admin"] : ["admin", "gestor"]);
  await enforceRateLimit(token, "faznotas_config", 20, 60);
  const estado = await rpc<Estado>(token, "estado_conexao_faznotas_257", { _loja: data.loja });
  return { token, estado };
}
export const faznotasConexaoGet = createServerFn({ method: "POST" })
  .validator((data: unknown) => entrada.parse(data))
  .handler(async ({ data }) => {
    return (await autorizar(data)).estado;
  });
export const faznotasConexaoSave = createServerFn({ method: "POST" })
  .validator((data: unknown) => salvarEntrada.parse(data))
  .handler(async ({ data }) => {
    const { token } = await autorizar(data, true);
    await rpc(token, "salvar_conexao_faznotas_257", {
      _loja: data.loja,
      _cnpj: data.cnpj,
      _token: data.token,
    });
    return { salvo: true };
  });
export const faznotasConexaoTest = createServerFn({ method: "POST" })
  .validator((data: unknown) => entrada.parse(data))
  .handler(async ({ data }) => {
    const { estado } = await autorizar(data, true);
    if (!estado.token_configurado || !estado.cnpj_confere)
      throw new Error("Salve o token para o CNPJ atual da loja antes de testar.");
    const { url } = supabaseEnv();
    const service = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
    if (!service)
      throw new Error("A chave segura do Supabase precisa estar configurada no servidor.");
    const r = await fetchWithTimeout(
      `${url}/rest/v1/faznotas_credenciais_257?select=token,cnpj&centro_id=eq.${data.loja}&limit=1`,
      { headers: { apikey: service, Authorization: `Bearer ${service}` } },
    );
    if (!r.ok) throw new Error("Não foi possível carregar a credencial fiscal protegida.");
    const rows = (await r.json()) as { token: string; cnpj: string }[];
    const cred = rows[0];
    if (!cred?.token || cred.cnpj !== estado.cnpj_loja)
      throw new Error("Vínculo fiscal desatualizado. Confira o CNPJ da loja.");
    return testarAcessoFaznotas(cred.token);
  });
