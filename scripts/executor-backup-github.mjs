/** Etapas do GitHub Actions: só registra sucesso após conferir o artefato externo baixado. */
import { mkdir, readFile, writeFile, readdir, appendFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { publicarBackupDownload } from "./publicar-backup-download.mjs";

export async function executarEtapa(
  etapa,
  {
    env = process.env,
    request = fetch,
    run = executarScript,
    publicar = publicarBackupDownload,
  } = {},
) {
  const root = resolve(env.BACKUP_RUN_ROOT || "/tmp/caparao-backup-github");
  const stateFile = join(root, "execucao.json");
  const url = new URL(env.EXT_SUPABASE_URL);
  if (url.protocol !== "https:" || !env.EXT_SUPABASE_SERVICE_ROLE_KEY)
    throw new Error("Configuração segura do Supabase ausente.");
  const rpc = async (nome, args) => {
    const r = await request(new URL("/rest/v1/rpc/" + nome, url), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        apikey: env.EXT_SUPABASE_SERVICE_ROLE_KEY,
        Authorization: "Bearer " + env.EXT_SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error("Falha no controle do backup (HTTP " + r.status + ").");
    return r.json();
  };
  const output = async (values) => {
    if (env.GITHUB_OUTPUT)
      await appendFile(
        env.GITHUB_OUTPUT,
        Object.entries(values)
          .map(([k, v]) => k + "=" + v + "\n")
          .join(""),
      );
  };
  if (etapa === "assumir") {
    for (const key of ["PGHOST", "PGUSER", "PGPASSWORD", "ERP_BACKUP_KEY"])
      if (!env[key]) throw new Error("Configure " + key + " no GitHub antes de ativar o backup.");
    if (!/^[a-f0-9]{64}$/i.test(env.ERP_BACKUP_KEY))
      throw new Error("Chave de recuperação inválida.");
    const job = await rpc("assumir_backup_268", {
      _agendado: env.BACKUP_CRIAR_SOLICITACAO === "true",
    });
    if (!job) {
      await output({ ativo: "false" });
      return;
    }
    if (![job.id, job.lease].every((id) => typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id)))
      throw new Error("Identidade da execução inválida.");
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeFile(stateFile, JSON.stringify(job), { flag: "wx", mode: 0o600 });
    await output({ ativo: "true" });
    return;
  }
  const job = JSON.parse(await readFile(stateFile, "utf8"));
  if (etapa === "gerar") {
    const local = join(root, "local");
    await mkdir(local, { recursive: true, mode: 0o700 });
    await run("backup-supabase.mjs", [local], env);
    const names = (await readdir(local)).filter((n) => /^backup-[0-9TZ.-]+$/.test(n));
    if (names.length !== 1) throw new Error("Não foi possível identificar uma cópia concluída.");
    job.backup = names[0];
    await run("verificar-backup.mjs", [join(local, job.backup)], env);
    await writeFile(stateFile, JSON.stringify(job), { mode: 0o600 });
    await output({ diretorio: join(local, job.backup), backup: job.backup });
    return;
  }
  if (etapa === "concluir") {
    if (!/^backup-[0-9TZ.-]+$/.test(job.backup ?? "")) throw new Error("Backup não gerado.");
    const externo = join(root, "externo", job.backup);
    // Este diretório deve ser preenchido por download-artifact, nunca por uma cópia local.
    await run("verificar-backup.mjs", [externo], env);
    const download = await publicar({ diretorio: externo, id: job.id });
    await rpc("registrar_download_backup_283", {
      _id: job.id,
      _lease: job.lease,
      _objeto: download.objeto,
      _sha256: download.sha256,
      _bytes: download.bytes,
    });
    await rpc("finalizar_backup_268", {
      _id: job.id,
      _lease: job.lease,
      _sucesso: true,
      _arquivo: job.backup,
    });
    console.log("Cópia externa e download privado verificados. Backup concluído.");
    return;
  }
  if (etapa === "falhar") {
    await rpc("finalizar_backup_268", {
      _id: job.id,
      _lease: job.lease,
      _sucesso: false,
      _arquivo: null,
    });
    return;
  }
  throw new Error("Etapa de backup desconhecida.");
}

async function executarScript(name, args, env) {
  await new Promise((ok, no) => {
    let output = "";
    const child = spawn(process.execPath, [new URL(name, import.meta.url).pathname, ...args], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.on("data", (chunk) => {
      output = (output + chunk.toString()).slice(-8000);
    });
    child.on("error", () =>
      no(new Error("Não foi possível iniciar a geração/verificação do backup.")),
    );
    child.on("close", (code) => {
      const reason = ["TLS", "PRIVILEGIOS", "VERSAO", "CONEXAO"].find((value) =>
        output.includes("[" + value + "]"),
      );
      code === 0
        ? ok()
        : no(
            new Error(
              "Geração/verificação incompleta" +
                (reason ? " [" + reason + "]" : "") +
                ". Confira o acesso de leitura ao banco, TLS, espaço e Storage.",
            ),
          );
    });
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  executarEtapa(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
