/** Provisionamento administrativo. Não imprime nem grava credenciais em arquivos. */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = "Techloove/distribuidora-flow";
const project = "zviwittrjdwyczhutvjf";

export async function configurarBackupGithub({
  env = process.env,
  request = fetch,
  gh = github,
  somenteSupabase = false,
} = {}) {
  if (!env.SUPABASE_ACCESS_TOKEN) throw new Error("Acesso administrativo Supabase ausente.");
  // Confere a capacidade de guardar segredos antes de criar qualquer credencial no banco.
  if (!somenteSupabase) await gh(["api", `repos/${repo}/actions/secrets/public-key`]);
  const api = async (path, body) => {
    const r = await request(`https://api.supabase.com/v1/projects/${project}${path}`, {
      method: body ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: "Bearer " + env.SUPABASE_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!r.ok)
      throw new Error(
        "Configuração Supabase incompleta (HTTP " +
          r.status +
          "). Nenhuma credencial é exibida nos logs.",
      );
    return r.json();
  };
  const sql = (query) => api("/database/query", { query, read_only: false });
  await sql(`begin;
do $$begin
 if exists(select 1 from pg_roles where rolname='caparao_backup_reader')
 and not exists(select 1 from vault.secrets where name='caparao_backup_pgpassword') then
 raise exception 'Papel existente não gerenciado por esta implantação';end if;
 if (select count(*) from vault.secrets where name='caparao_backup_recovery_key')>1
 or (select count(*) from vault.secrets where name='caparao_backup_pgpassword')>1 then raise exception 'Segredos duplicados';end if;
 if not exists(select 1 from vault.secrets where name='caparao_backup_recovery_key') then
 perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'caparao_backup_recovery_key','Chave AES dos backups. Guarde cópia offline separada; não apague ou rotacione sem preservar as chaves anteriores.');end if;
 if not exists(select 1 from vault.secrets where name='caparao_backup_pgpassword') then
 perform vault.create_secret(encode(extensions.gen_random_bytes(36),'hex'),'caparao_backup_pgpassword','Senha do leitor exclusivo de backup, sem permissão de escrita.');end if;
 if not exists(select 1 from pg_roles where rolname='caparao_backup_reader') then
 execute format('create role caparao_backup_reader login nosuperuser nocreatedb nocreaterole noreplication bypassrls connection limit 2 password %L',
 (select decrypted_secret from vault.decrypted_secrets where name='caparao_backup_pgpassword'));
 end if;
end $$;
grant pg_read_all_data to caparao_backup_reader;
alter role caparao_backup_reader set default_transaction_read_only=on;
comment on role caparao_backup_reader is 'Leitor exclusivo dos backups Caparaó System. Não usar na aplicação.';
commit;`);
  const rows = await sql(
    "select name,decrypted_secret from vault.decrypted_secrets where name in ('caparao_backup_recovery_key','caparao_backup_pgpassword')",
  );
  const key = rows.find((r) => r.name === "caparao_backup_recovery_key")?.decrypted_secret;
  const password = rows.find((r) => r.name === "caparao_backup_pgpassword")?.decrypted_secret;
  if (!/^[a-f0-9]{64}$/.test(key ?? "") || !password)
    throw new Error("Credenciais de backup indisponíveis no cofre.");
  const keys = await api("/api-keys?reveal=true");
  const service = keys.find((k) => k.name === "service_role")?.api_key;
  if (!service) throw new Error("Chave de serviço indisponível.");
  const poolers = await api("/config/database/pooler");
  const host = poolers.find(
    (p) => typeof p.db_host === "string" && p.db_host.endsWith(".pooler.supabase.com"),
  )?.db_host;
  if (!host) throw new Error("Pooler de conexão indisponível.");
  if (somenteSupabase) {
    // O valor segue somente por HTTPS ao cofre autorizado; nunca vai para stdout ou arquivo.
    const value = service.replace(/'/g, "''");
    await sql(`do $$declare v uuid;begin
      if (select count(*) from vault.secrets where name='caparao_backup_service_role')>1 then raise exception 'Segredos duplicados';end if;
      select id into v from vault.secrets where name='caparao_backup_service_role';
      if v is null then perform vault.create_secret('${value}','caparao_backup_service_role','Chave do serviço para fila e Storage de backup. Copiar apenas para o segredo protegido do GitHub.');
      else perform vault.update_secret(v,'${value}');end if;
    end $$;`);
    return {
      projeto: project,
      cofre_configurado: true,
      papel_leitura: "caparao_backup_reader",
      segredos: [
        "caparao_backup_pgpassword",
        "caparao_backup_recovery_key",
        "caparao_backup_service_role",
      ],
    };
  }
  for (const [name, value] of Object.entries({
    BACKUP_PGPASSWORD: password,
    ERP_BACKUP_KEY: key,
    BACKUP_SUPABASE_SERVICE_ROLE_KEY: service,
  }))
    await gh(["secret", "set", name, "--repo", repo], value);
  for (const [name, value] of Object.entries({
    BACKUP_SUPABASE_URL: `https://${project}.supabase.co`,
    BACKUP_PGHOST: host,
    BACKUP_PGUSER: `caparao_backup_reader.${project}`,
  }))
    await gh(["variable", "set", name, "--repo", repo, "--body", value]);
  return {
    projeto: project,
    repositorio: repo,
    segredos_configurados: 3,
    variaveis_configuradas: 3,
  };
}

async function github(args, input) {
  const r = spawnSync("gh", args, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, GH_TOKEN: process.env.GITHUB_BACKUP_TOKEN || process.env.GH_TOKEN },
  });
  if (r.status !== 0)
    throw new Error(
      "Não foi possível configurar o GitHub. Confira acesso à API e permissão de administração dos segredos do repositório.",
    );
  return r.stdout;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  configurarBackupGithub({ somenteSupabase: process.argv.includes("--somente-supabase") })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
