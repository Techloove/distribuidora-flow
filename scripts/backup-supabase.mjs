import { inventariarStorage, assinaturaInventario } from "./inventario-backup-storage.mjs";
/** Backup manual/agendável, criptografado. Não altera banco nem objetos. */
import { createCipheriv, randomBytes, createHash } from "node:crypto";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, writeFile, appendFile, rename, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const required = [
  "PGHOST",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
  "EXT_SUPABASE_URL",
  "EXT_SUPABASE_SERVICE_ROLE_KEY",
  "ERP_BACKUP_KEY",
];
if (required.some((k) => !process.env[k]))
  throw new Error(
    "Configure PGHOST, PGDATABASE, PGUSER, PGPASSWORD, EXT_SUPABASE_URL, EXT_SUPABASE_SERVICE_ROLE_KEY e ERP_BACKUP_KEY em ambiente seguro.",
  );
if (!/^[a-f0-9]{64}$/i.test(process.env.ERP_BACKUP_KEY))
  throw new Error("ERP_BACKUP_KEY deve ter 32 bytes em hexadecimal.");
const api = new URL(process.env.EXT_SUPABASE_URL);
if (api.protocol !== "https:") throw new Error("Backup exige HTTPS para Supabase.");
if (process.env.PGSSLMODE && process.env.PGSSLMODE !== "verify-full")
  throw new Error("Use PGSSLMODE=verify-full e configure o certificado CA do PostgreSQL.");
const key = Buffer.from(process.env.ERP_BACKUP_KEY, "hex");
const destino = resolve(process.argv[2] ?? "/tmp/erp-backups");
const nome = "backup-" + new Date().toISOString().replace(/[:.]/g, "-"),
  temp = join(destino, nome + ".partial"),
  final = join(destino, nome);
await mkdir(destino, { recursive: true, mode: 0o700 });
await mkdir(temp, { mode: 0o700 });
const files = [];
const encrypt = async (source, file) => {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv),
    dest = join(temp, file);
  await writeFile(dest, Buffer.concat([Buffer.from("FLOWBK01"), iv]), { flag: "wx", mode: 0o600 });
  await pipeline(source, cipher, createWriteStream(dest, { flags: "a", mode: 0o600 }));
  await appendFile(dest, cipher.getAuthTag());
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(dest)) hash.update(chunk);
  return hash.digest("hex");
};
const request = async (path, options = {}) => {
  const r = await fetch(new URL(path, api), {
    ...options,
    redirect: "error",
    headers: {
      apikey: process.env.EXT_SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + process.env.EXT_SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error("Falha no backup de Storage (HTTP " + r.status + ").");
  return r;
};
let dumpProcess;
try {
  const inventory = await inventariarStorage(request);
  const dump = spawn("pg_dump", ["--format=custom"], {
    env: { ...process.env, PGSSLMODE: "verify-full" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  dumpProcess = dump;
  let diagnostico = "CONEXAO";
  dump.stderr.on("data", (chunk) => {
    const message = chunk.toString().toLowerCase();
    if (/password authentication|sasl authentication/.test(message)) diagnostico = "SENHA_BANCO";
    else if (/certificate|ssl|tls/.test(message)) diagnostico = "TLS";
    else if (/permission denied|row-level security|must be owner/.test(message))
      diagnostico = "PRIVILEGIOS";
    else if (/version mismatch|server version/.test(message)) diagnostico = "VERSAO";
  });
  const done = new Promise((ok, no) => {
    dump.on("error", () => no(new Error("Instale pg_dump compatível com a versão do banco.")));
    dump.on("close", (code) =>
      code === 0
        ? ok()
        : no(new Error("pg_dump falhou [" + diagnostico + "]. Confira conexão, CA e privilégios.")),
    );
  });
  // Evita imprimir respostas que possam conter dados de conexão.
  const [sha256] = await Promise.all([encrypt(dump.stdout, "banco.dump.enc"), done]);
  files.push({ kind: "database", file: "banco.dump.enc", sha256 });
  const root = fileURLToPath(new URL("../", import.meta.url));
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const source = spawn("git", ["archive", "--format=tar", revision], {
    cwd: root,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const sourceDone = new Promise((ok, no) => {
    source.on("error", () => no(new Error("Não foi possível incluir o código versionado.")));
    source.on("close", (code) =>
      code === 0 ? ok() : no(new Error("Falha ao incluir o código versionado.")),
    );
  });
  const [sourceHash] = await Promise.all([encrypt(source.stdout, "aplicacao.tar.enc"), sourceDone]);
  files.push({ kind: "application", file: "aplicacao.tar.enc", sha256: sourceHash, revision });
  for (const object of inventory.objects) {
    const filename =
      createHash("sha256")
        .update(object.bucket + "\0" + object.name)
        .digest("hex") + ".object.enc";
    const response = await request(
      "/storage/v1/object/" +
        encodeURIComponent(object.bucket) +
        "/" +
        object.name.split("/").map(encodeURIComponent).join("/"),
    );
    if (!response.body) throw new Error("Objeto sem corpo.");
    const checked = Readable.from(
      (async function* () {
        let bytes = 0;
        for await (const chunk of response.body) {
          bytes += chunk.byteLength;
          yield chunk;
        }
        if (Number.isSafeInteger(object.metadata?.size) && bytes !== object.metadata.size)
          throw new Error("Objeto incompleto no backup de Storage.");
      })(),
    );
    const digest = await encrypt(checked, filename);
    files.push({
      kind: "object",
      file: filename,
      bucket: object.bucket,
      name: object.name,
      sha256: digest,
    });
  }
  const after = await inventariarStorage(request);
  if (assinaturaInventario(inventory) !== assinaturaInventario(after))
    throw new Error("Storage alterado durante o backup. Execute novamente em janela controlada.");
  await encrypt(
    Readable.from([
      JSON.stringify({
        version: 2,
        created_at: new Date().toISOString(),
        scope: "all_database_schemas_and_application_storage",
        excluded_buckets: ["erp-backups"],
        application_revision: revision,
        buckets: inventory.buckets,
        files,
      }),
    ]),
    "manifesto.enc",
  );
  await rename(temp, final);
  console.log("Backup criptografado concluído: " + final + " (" + files.length + " arquivos).");
} catch (error) {
  await rm(temp, { recursive: true, force: true });
  throw error;
} finally {
  if (dumpProcess && dumpProcess.exitCode === null) dumpProcess.kill("SIGTERM");
}
