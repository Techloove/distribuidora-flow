import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireServerAuth, requestAccessToken, enforceRateLimit } from "./server-auth";
import { fetchWithTimeout } from "./fetch-timeout";
const entrada = z.object({ accessToken: z.string().optional() });
async function rpc(
  data: z.infer<typeof entrada>,
  nome: string,
  args: Record<string, unknown> = {},
) {
  const token = data.accessToken || requestAccessToken() || "";
  await requireServerAuth(token, ["admin"]);
  await enforceRateLimit(token, "backup_admin", 20, 60);
  const url = process.env["EXT_SUPABASE_URL"]?.replace(/\/$/, ""),
    key = process.env["EXT_SUPABASE_ANON_KEY"];
  if (!url || !key) throw new Error("Configuração do Supabase indisponível.");
  const r = await fetchWithTimeout(`${url}/rest/v1/rpc/${nome}`, {
    method: "POST",
    redirect: "manual",
    headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (r.status >= 300 && r.status < 400)
    throw new Error("Redirecionamento inesperado no serviço de backup.");
  if (!r.ok)
    throw new Error(
      nome === "obter_download_backup_283"
        ? "Backup para download indisponível. Confira a fase283 e se o executor disponibilizou uma cópia concluída."
        : "Backup indisponível. Confira a fase268, a permissão de administrador e o intervalo de cinco minutos entre solicitações.",
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
  download_disponivel: z.boolean().optional().default(false),
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

const downloadEntrada = entrada.extend({ id: z.string().uuid() });
export const baixarBackup = createServerFn({ method: "POST" })
  .validator((d: unknown) => downloadEntrada.parse(d))
  .handler(async ({ data }) => {
    const arquivo = z
      .object({
        objeto: z.string(),
        nome: z.string().regex(/^backup-[0-9TZ.-]+\.tar$/),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        bytes: z.number().int().positive(),
      })
      .parse(await rpc(data, "obter_download_backup_283", { _id: data.id }));
    if (arquivo.objeto !== `${data.id}/${arquivo.nome}`)
      throw new Error("Identidade do pacote de backup inválida.");
    // Usa a sessão do administrador; a política do bucket confere o backup concluído.
    const base = new URL(process.env["EXT_SUPABASE_URL"]!);
    const caminho = arquivo.objeto.split("/").map(encodeURIComponent).join("/");
    const response = await fetchWithTimeout(
      new URL(`/storage/v1/object/sign/erp-backups/${caminho}`, base),
      {
        method: "POST",
        redirect: "manual",
        headers: {
          apikey: process.env["EXT_SUPABASE_ANON_KEY"]!,
          Authorization: `Bearer ${data.accessToken || requestAccessToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn: 120, download: arquivo.nome }),
      },
    );
    if (!response.ok)
      throw new Error("Download indisponível. Confira a instalação do backup e o arquivo privado.");
    const { signedURL } = z.object({ signedURL: z.string() }).parse(await response.json());
    const url = new URL(`/storage/v1${signedURL}`, base);
    if (
      base.protocol !== "https:" ||
      url.origin !== base.origin ||
      !signedURL.startsWith("/object/sign/erp-backups/")
    )
      throw new Error("Endereço de download inválido.");
    url.searchParams.set("download", arquivo.nome);
    return { url: url.href, nome: arquivo.nome, sha256: arquivo.sha256, bytes: arquivo.bytes };
  });
