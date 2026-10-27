/** Publica somente o pacote criptografado, com verificação da cópia remota. */
import { createReadStream } from "node:fs";
import { stat, mkdtemp, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

export async function publicarBackupDownload({ diretorio, id }) {
  if (!/^[a-f0-9-]{36}$/i.test(id) || !/^backup-[0-9TZ.-]+$/.test(basename(diretorio)))
    throw new Error("Identidade do backup inválida.");
  const base = new URL(process.env.EXT_SUPABASE_URL);
  const key = process.env.EXT_SUPABASE_SERVICE_ROLE_KEY;
  if (base.protocol !== "https:" || !key) throw new Error("Configuração segura indisponível.");
  const temp = await mkdtemp(join(tmpdir(), "backup-download-"));
  const nome = basename(diretorio) + ".tar";
  const arquivo = join(temp, nome);
  const objeto = `${id}/${nome}`;
  const endpoint = new URL(`/storage/v1/object/erp-backups/${objeto}`, base);
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  try {
    await new Promise((ok, no) => {
      const tar = spawn("tar", ["-cf", arquivo, "-C", diretorio, "."], { stdio: "ignore" });
      tar.on("error", () => no(new Error("Instale tar no host de backup.")));
      tar.on("close", (code) =>
        code === 0 ? ok() : no(new Error("Falha ao empacotar o backup.")),
      );
    });
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(arquivo)) hash.update(chunk);
    const sha256 = hash.digest("hex");
    const bytes = (await stat(arquivo)).size;
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: { ...headers, "Content-Type": "application/x-tar", "x-upsert": "false" },
      body: createReadStream(arquivo),
      duplex: "half",
      signal: AbortSignal.timeout(3_600_000),
    });
    if (!response.ok)
      throw new Error(
        "Falha ao publicar o download privado. Confira bucket e limite de tamanho do Storage.",
      );
    const copia = await fetch(endpoint, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(3_600_000),
    });
    if (!copia.ok || !copia.body) throw new Error("Não foi possível verificar o download privado.");
    const remoto = createHash("sha256");
    let recebido = 0;
    for await (const chunk of copia.body) {
      remoto.update(chunk);
      recebido += chunk.length;
    }
    if (recebido !== bytes || remoto.digest("hex") !== sha256)
      throw new Error("Cópia para download incompleta ou adulterada.");
    return { objeto, sha256, bytes };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
