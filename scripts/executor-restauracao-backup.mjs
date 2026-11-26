/** Importa a cópia concluída somente para PostgreSQL descartável e sem rede. */
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform, Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validarRestauracao } from "./validar-restauracao-backup.mjs";

export function validarListaPacote(nomes, detalhes) {
  const names = nomes.trimEnd().split("\n");
  const lines = detalhes.trimEnd().split("\n");
  if (names.length !== lines.length || names.length > 100000)
    throw new Error("Inventário inválido.");
  const seen = new Set();
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (name === "./" && lines[i].startsWith("d")) continue;
    if (!/^\.\/[a-zA-Z0-9.-]+\.enc$/.test(name) || !lines[i].startsWith("-") || seen.has(name))
      throw new Error("Pacote contém caminhos, links ou arquivos não autorizados.");
    seen.add(name);
  }
  if (
    !seen.has("./manifesto.enc") ||
    !seen.has("./banco.dump.enc") ||
    !seen.has("./aplicacao.tar.enc")
  )
    throw new Error("Pacote completo obrigatório.");
}
function command(args) {
  const r = spawnSync("tar", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 60000,
  });
  if (r.status !== 0) throw new Error("Não foi possível ler o pacote.");
  return r.stdout;
}
export async function executarRestauracao(
  etapa,
  { env = process.env, request = fetch, validar = validarRestauracao } = {},
) {
  const root = resolve(env.RESTORE_TEST_ROOT ?? "");
  if (!/^\/tmp\/caparao-restore-[0-9]+-[0-9]+$/.test(root))
    throw new Error("Destino isolado inválido.");
  const base = new URL(env.EXT_SUPABASE_URL ?? "https://invalid");
  const key = env.EXT_SUPABASE_SERVICE_ROLE_KEY;
  if (base.protocol !== "https:" || !key) throw new Error("Configuração segura indisponível.");
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const rpc = async (name, args = {}) => {
    const r = await request(new URL("/rest/v1/rpc/" + name, base), {
      method: "POST",
      redirect: "error",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error("Rotina de restauração indisponível. Confira fase378 e executor.");
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  };
  const state = join(root, "solicitacao.json");
  if (etapa === "assumir") {
    const job = await rpc("assumir_restauracao_backup_378");
    if (job) {
      if (
        !/^[a-f0-9-]{36}$/i.test(job.id) ||
        !/^[a-f0-9-]{36}$/i.test(job.lease) ||
        !/^[a-f0-9-]{36}\/backup-[0-9TZ.-]+\.tar$/i.test(job.objeto) ||
        !/^[a-f0-9]{64}$/.test(job.sha256) ||
        !Number.isSafeInteger(job.bytes) ||
        job.bytes <= 0
      )
        throw new Error("Identidade de recuperação inválida.");
      await mkdir(root, { mode: 0o700, recursive: true });
      await writeFile(state, JSON.stringify(job), { mode: 0o600, flag: "wx" });
    }
    if (env.GITHUB_OUTPUT) await writeFile(env.GITHUB_OUTPUT, `ativo=${!!job}\n`, { flag: "a" });
    return;
  }
  const job = JSON.parse(await readFile(state, "utf8"));
  if (etapa === "falhar")
    return rpc("finalizar_restauracao_backup_378", {
      _id: job.id,
      _lease: job.lease,
      _sucesso: false,
    });
  if (etapa !== "restaurar") throw new Error("Etapa inválida.");
  const arquivo = join(root, "pacote.tar");
  const r = await request(new URL("/storage/v1/object/erp-backups/" + job.objeto, base), {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(600000),
  });
  if (!r.ok || !r.body) throw new Error("Cópia para recuperação indisponível.");
  let bytes = 0;
  const hash = createHash("sha256");
  await pipeline(
    Readable.fromWeb(r.body),
    new Transform({
      transform(chunk, _, next) {
        bytes += chunk.length;
        if (bytes > job.bytes) return next(new Error("Pacote maior que o registrado."));
        hash.update(chunk);
        next(null, chunk);
      },
    }),
    createWriteStream(arquivo, { mode: 0o600, flags: "wx" }),
  );
  if (bytes !== job.bytes || hash.digest("hex") !== job.sha256)
    throw new Error("Pacote incompleto ou adulterado.");
  validarListaPacote(command(["-tf", arquivo]), command(["-tvf", arquivo]));
  const destino = join(root, "criptografado");
  await mkdir(destino, { mode: 0o700 });
  command(["-xf", arquivo, "-C", destino, "--no-same-owner", "--no-same-permissions"]);
  await rm(arquivo);
  await validar("preparar", env);
  await validar("restaurar", env);
  const report = JSON.parse(await readFile(join(root, "relatorio.json"), "utf8"));
  await rpc("finalizar_restauracao_backup_378", {
    _id: job.id,
    _lease: job.lease,
    _sucesso: true,
    _relatorio: report,
  });
  console.log("Recuperação isolada concluída. Banco de produção preservado.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  executarRestauracao(process.argv[2]).catch(() => {
    console.error(
      "Conferência incompleta. Revise a instalação da fase378, a integridade da cópia e o executor de recuperação.",
    );
    process.exitCode = 1;
  });
