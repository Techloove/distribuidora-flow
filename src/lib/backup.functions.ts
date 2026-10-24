import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireServerAuth, requestAccessToken, enforceRateLimit } from "./server-auth";
import { fetchWithTimeout } from "./fetch-timeout";
const entrada = z.object({ accessToken: z.string().optional() });
async function rpc(data: z.infer<typeof entrada>, nome: string) {
  const token = data.accessToken || requestAccessToken() || "";
  await requireServerAuth(token, ["admin"]);
  await enforceRateLimit(token, "backup_admin", 20, 60);
  const url = process.env["EXT_SUPABASE_URL"]?.replace(/\/$/, ""),
    key = process.env["EXT_SUPABASE_ANON_KEY"];
  if (!url || !key) throw new Error("Configuração do Supabase indisponível.");
  const r = await fetchWithTimeout(`${url}/rest/v1/rpc/${nome}`, {
    method: "POST",
    redirect: "error",
    headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok)
    throw new Error(
      "Backup indisponível. Confira a fase268, a permissão de administrador e o intervalo de cinco minutos entre solicitações.",
    );
  return r.json();
}
const item = z.object({
  id: z.string().uuid(),
  origem: z.enum(["manual", "agendado"]),
  estado: z.enum(["pendente", "executando", "sucesso", "falha"]),
  solicitado_em: z.string(),
  iniciado_em: z.string().nullable(),
  finalizado_em: z.string().nullable(),
  arquivo: z.string().nullable(),
  copia_externa_verificada: z.boolean(),
  mensagem: z.string().nullable(),
});
export const listarBackups = createServerFn({ method: "POST" })
  .validator((d: unknown) => entrada.parse(d))
  .handler(async ({ data }) => z.array(item).parse(await rpc(data, "listar_backups_268")));
export const solicitarBackup = createServerFn({ method: "POST" })
  .validator((d: unknown) => entrada.parse(d))
  .handler(async ({ data }) => ({
    id: z
      .string()
      .uuid()
      .parse(await rpc(data, "solicitar_backup_268")),
  }));
