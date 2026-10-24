/** Backup manual/agendável, criptografado. Não altera banco nem objetos. */
import { createCipheriv, randomBytes, createHash } from "node:crypto";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, writeFile, appendFile, rename, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

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
  const dump = spawn(
    "pg_dump",
    [
      "--format=custom",
      "--no-owner",
      "--no-acl",
      "--schema=public",
      "--schema=auth",
      "--schema=storage",
    ],
    { env: { ...process.env, PGSSLMODE: "verify-full" }, stdio: ["ignore", "pipe", "pipe"] },
  );
  dumpProcess = dump;
  const done = new Promise((ok, no) => {
    dump.on("error", () => no(new Error("Instale pg_dump compatível com a versão do banco.")));
    dump.on("close", (code) =>
      code === 0 ? ok() : no(new Error("pg_dump falhou. Confira conexão, CA e privilégios.")),
    );
  });
  // Evita imprimir respostas que possam conter dados de conexão.
  dump.stderr.resume();
  const [sha256] = await Promise.all([encrypt(dump.stdout, "banco.dump.enc"), done]);
  files.push({ kind: "database", file: "banco.dump.enc", sha256 });
  const buckets = await (await request("/storage/v1/bucket")).json();
  for (const bucket of buckets) {
    if (typeof bucket.id !== "string") throw new Error("Lista de buckets inválida.");
    const folders = [""];
    for (let index = 0; index < folders.length; index++) {
      const prefix = folders[index];
      for (let offset = 0; ; offset += 100) {
        const entries = await (
          await request("/storage/v1/object/list/" + encodeURIComponent(bucket.id), {
            method: "POST",
            body: JSON.stringify({
              prefix,
              limit: 100,
              offset,
              sortBy: { column: "name", order: "asc" },
            }),
          })
        ).json();
        if (!Array.isArray(entries)) throw new Error("Lista de objetos inválida.");
        for (const object of entries) {
          if (
            typeof object.name !== "string" ||
            object.name.includes("/") ||
            [".", ".."].includes(object.name)
          )
            throw new Error("Nome de objeto inválido.");
          const objectPath = prefix ? prefix + "/" + object.name : object.name;
          if (!object.id) {
            folders.push(objectPath);
            continue;
          }
          const filename =
            createHash("sha256")
              .update(bucket.id + "\0" + objectPath)
              .digest("hex") + ".object.enc";
          const response = await request(
            "/storage/v1/object/" +
              encodeURIComponent(bucket.id) +
              "/" +
              objectPath.split("/").map(encodeURIComponent).join("/"),
          );
          if (!response.body) throw new Error("Objeto sem corpo.");
          const digest = await encrypt(Readable.fromWeb(response.body), filename);
          files.push({
            kind: "object",
            file: filename,
            bucket: bucket.id,
            name: objectPath,
            sha256: digest,
          });
        }
        if (entries.length < 100) break;
      }
    }
  }
  await encrypt(
    Readable.from([
      JSON.stringify({ version: 1, created_at: new Date().toISOString(), buckets, files }),
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
