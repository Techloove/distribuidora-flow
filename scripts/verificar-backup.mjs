/** Confere integridade; --extrair descriptografa localmente, sem restaurar banco. */
import { createDecipheriv, createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { stat, mkdir, open, rename, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import { resolve, join, sep } from "node:path";
if (!/^[a-f0-9]{64}$/i.test(process.env.ERP_BACKUP_KEY ?? ""))
  throw new Error("Configure ERP_BACKUP_KEY em ambiente seguro.");
const dir = resolve(process.argv[2] ?? ""),
  output =
    process.argv[3] === "--extrair" ? resolve(process.argv[4] ?? join(dir, "extraido")) : null,
  key = Buffer.from(process.env.ERP_BACKUP_KEY, "hex");
const decrypt = async (file, dest) => {
  const full = join(dir, file);
  const size = (await stat(full)).size;
  if (size < 36) throw new Error("Backup truncado.");
  const handle = await open(full, "r");
  let head = Buffer.alloc(20),
    tag = Buffer.alloc(16);
  try {
    await handle.read(head, 0, 20, 0);
    await handle.read(tag, 0, 16, size - 16);
  } finally {
    await handle.close();
  }
  if (head.subarray(0, 8).toString() !== "FLOWBK01") throw new Error("Formato de backup inválido.");
  const cipher = createDecipheriv("aes-256-gcm", key, head.subarray(8));
  cipher.setAuthTag(tag);
  await pipeline(createReadStream(full, { start: 20, end: size - 17 }), cipher, dest);
};
let chunks = [];
await decrypt(
  "manifesto.enc",
  new Writable({
    write(chunk, _, next) {
      chunks.push(chunk);
      next();
    },
  }),
);
const manifest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
if (![1, 2].includes(manifest.version) || !Array.isArray(manifest.files))
  throw new Error("Manifesto inválido.");
for (const entry of manifest.files) {
  if (!/^[a-zA-Z0-9.-]+\.enc$/.test(entry.file)) throw new Error("Caminho inválido.");
  const hash = createHash("sha256");
  for await (const c of createReadStream(join(dir, entry.file))) hash.update(c);
  if (hash.digest("hex") !== entry.sha256) throw new Error("Checksum divergente.");
  let dest = new Writable({
    write(_, __, next) {
      next();
    },
  });
  let target = null,
    pending = null;
  if (output) {
    target =
      entry.kind === "database"
        ? join(output, "banco.dump")
        : entry.kind === "application"
          ? join(output, "aplicacao.tar")
          : resolve(output, "storage", entry.bucket, entry.name);
    if (!target.startsWith(output + sep)) throw new Error("Caminho de objeto inválido.");
    await mkdir(resolve(target, ".."), { recursive: true, mode: 0o700 });
    try {
      await stat(target);
      throw new Error("Arquivo de extração já existe.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    pending = target + ".partial";
    dest = createWriteStream(pending, { flags: "wx", mode: 0o600 });
  }
  try {
    await decrypt(entry.file, dest);
    if (pending) await rename(pending, target);
  } catch (error) {
    if (pending) await rm(pending, { force: true });
    throw error;
  }
}
if (output) await mkdir(output, { recursive: true, mode: 0o700 });
console.log(
  "Integridade verificada: " +
    manifest.files.length +
    " arquivos. Nenhuma restauração no banco foi executada.",
);
