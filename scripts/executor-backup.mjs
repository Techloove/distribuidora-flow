/** Executor administrativo chamado por timer; segredos somente no host. */
import { join } from "node:path";
import { publicarBackupDownload } from "./publicar-backup-download.mjs";
import { executarRotina } from "./rotina-backup.mjs";
async function rpc(nome, args) {
  const url = new URL(process.env.EXT_SUPABASE_URL),
    key = process.env.EXT_SUPABASE_SERVICE_ROLE_KEY;
  if (url.protocol !== "https:" || !key) throw new Error("Configuração segura indisponível");
  const r = await fetch(new URL("/rest/v1/rpc/" + nome, url), {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error("Falha no controle de execução");
  return r.json();
}
let job;
try {
  job = await rpc("assumir_backup_268", { _agendado: process.argv.includes("--agendar") });
  if (job) {
    let result;
    try {
      result = await executarRotina({
        local: process.env.ERP_BACKUP_LOCAL,
        externo: process.env.ERP_BACKUP_EXTERNO,
      });
      if (process.env.ERP_BACKUP_PUBLICAR_DOWNLOAD === "true") {
        const download = await publicarBackupDownload({
          diretorio: join(process.env.ERP_BACKUP_EXTERNO, result.backup),
          id: job.id,
        });
        await rpc("registrar_download_backup_283", {
          _id: job.id,
          _lease: job.lease,
          _objeto: download.objeto,
          _sha256: download.sha256,
          _bytes: download.bytes,
        });
      }
    } catch {
      await rpc("finalizar_backup_268", {
        _id: job.id,
        _lease: job.lease,
        _sucesso: false,
        _arquivo: null,
      });
      throw new Error("Rotina incompleta");
    }
    await rpc("finalizar_backup_268", {
      _id: job.id,
      _lease: job.lease,
      _sucesso: true,
      _arquivo: result.backup,
    });
    console.log("Backup e cópia externa verificados. Histórico atualizado.");
  }
} catch {
  console.error(
    "Executor de backup falhou. Confira infraestrutura e status local. Uma falha ao atualizar o histórico exige conciliação com a cópia externa.",
  );
  process.exitCode = 1;
}
