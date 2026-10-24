/** Rotina administrativa: geração, verificação e cópia externa verificada. */
import { mkdir, realpath, readdir, cp, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { resolve, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scripts = fileURLToPath(new URL(".", import.meta.url));
function separado(a, b) {
  const rel = relative(a, b);
  return rel !== "" && (rel === ".." || rel.startsWith("../") || isAbsolute(rel));
}
export async function executarRotina({ local, externo }, run = executarScript) {
  if (!local || !externo)
    throw new Error(
      "Configure ERP_BACKUP_LOCAL e ERP_BACKUP_EXTERNO com diretórios privados distintos.",
    );
  await mkdir(resolve(local), { recursive: true, mode: 0o700 });
  // O destino externo deve existir: evita criar uma pasta local se a montagem estiver ausente.
  const origem = await realpath(resolve(local)),
    destino = await realpath(resolve(externo));
  if (!separado(origem, destino) || !separado(destino, origem))
    throw new Error("Os destinos de backup devem ser separados e não podem conter um ao outro.");
  const lock = join(origem, ".rotina.lock"),
    status = join(origem, "status.json");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (e) {
    if (e.code === "EEXIST")
      throw new Error("Já existe uma rotina em execução ou um bloqueio a revisar.");
    throw e;
  }
  const inicio = new Date().toISOString();
  let backup = null,
    parcial = null;
  const salvar = async (data) => {
    const tmp = status + ".partial";
    await writeFile(tmp, JSON.stringify({ versao: 1, inicio, ...data }, null, 2), { mode: 0o600 });
    await rename(tmp, status);
  };
  try {
    await salvar({ estado: "executando" });
    const antes = new Set(await readdir(origem));
    await run("backup-supabase.mjs", [origem]);
    const novos = (await readdir(origem)).filter(
      (n) => !antes.has(n) && /^backup-[0-9TZ.-]+$/.test(n),
    );
    if (novos.length !== 1)
      throw new Error("Não foi possível identificar um único backup concluído.");
    backup = novos[0];
    await run("verificar-backup.mjs", [join(origem, backup)]);
    const staging = join(destino, backup + ".partial");
    await mkdir(staging, { mode: 0o700 });
    parcial = staging;
    for (const file of await readdir(join(origem, backup))) {
      await cp(join(origem, backup, file), join(parcial, file), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    }
    await run("verificar-backup.mjs", [parcial]);
    // Nome único reservado antes da publicação; nunca sobrescreve uma cópia existente.
    const final = join(destino, backup);
    await mkdir(final, { mode: 0o700 });
    try {
      await rename(parcial, final);
    } catch (e) {
      await rmdir(final).catch(() => {});
      throw e;
    }
    parcial = null;
    await salvar({
      estado: "sucesso",
      fim: new Date().toISOString(),
      backup,
      copia_externa_verificada: true,
    });
    return { backup };
  } catch (e) {
    if (parcial) await rm(parcial, { recursive: true, force: true });
    await salvar({
      estado: "falha",
      fim: new Date().toISOString(),
      backup,
      copia_externa_verificada: false,
      mensagem: "Rotina incompleta. Confira banco, destino externo, espaço, chave e conectividade.",
    });
    throw e;
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
function executarScript(script, args) {
  return new Promise((ok, no) => {
    const proc = spawn(process.execPath, [join(scripts, script), ...args], {
      env: process.env,
      stdio: ["ignore", "ignore", "ignore"],
    });
    proc.on("error", () => no(new Error("Não foi possível iniciar a etapa de backup.")));
    proc.on("close", (code) =>
      code === 0
        ? ok()
        : no(
            new Error(
              "Etapa de backup falhou. Confira a configuração segura e a disponibilidade da infraestrutura.",
            ),
          ),
    );
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  executarRotina({ local: process.env.ERP_BACKUP_LOCAL, externo: process.env.ERP_BACKUP_EXTERNO })
    .then(({ backup }) => console.log("Backup e cópia externa verificados: " + backup))
    .catch(() => {
      console.error(
        "Backup não concluído. Confira configuração, bloqueio de execução e status.json no destino local.",
      );
      process.exitCode = 1;
    });
}
