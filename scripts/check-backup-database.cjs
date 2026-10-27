const { PGlite } = require("@electric-sql/pglite");
const { readFileSync } = require("node:fs");
const assert = require("node:assert/strict");
(async () => {
  const db = new PGlite(),
    uid = "00000000-0000-4000-8000-000000000001";
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql as $$select '${uid}'::uuid$$;
 create function auth.role() returns text language sql as $$select current_setting('teste.role',true)$$;
 create function has_role(uuid,text) returns boolean language sql as $$select $2='admin' and current_setting('teste.admin',true)='true'$$;
 create table profiles(id uuid primary key,ativo boolean,precisa_completar_cadastro boolean);insert into profiles values('${uid}',true,false);
 create table auditoria(tabela text,registro_id uuid,acao text,detalhe jsonb,user_id uuid);
 set teste.admin='true';`);
  const sql = readFileSync("db/fase268_backup_administrativo.sql", "utf8");
  await db.exec(sql);
  await db.exec(sql);
  await db.exec(`create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated,anon;
    grant all on storage.objects to authenticated,anon;
    create policy antiga_ampla on storage.objects for all to authenticated,anon using(true) with check(true);`);
  const downloadSql = readFileSync("db/fase283_backup_download_privado.sql", "utf8");
  await db.exec(downloadSql);
  await db.exec(downloadSql);
  const user = () => db.exec("reset role;set teste.role='authenticated';set role authenticated"),
    service = () => db.exec("reset role;set teste.role='service_role';set role service_role"),
    owner = () => db.exec("reset role");
  const request = async () => (await db.query("select solicitar_backup_268() id")).rows[0].id;
  const claim = async (s = false) =>
    (await db.query("select assumir_backup_268($1) j", [s])).rows[0].j;
  const list = async () => (await db.query("select listar_backups_268() j")).rows[0].j;
  const finish = (j, ok = true, lease = j.lease) =>
    db.query("select finalizar_backup_268($1,$2,$3,$4)", [
      j.id,
      lease,
      ok,
      ok ? "backup-2026-10-24T03-00-00-000Z" : null,
    ]);
  await user();
  let id = await request();
  assert.equal(await request(), id);
  assert.equal((await list())[0].estado, "pendente");
  assert.equal(JSON.stringify(await list()).includes("lease"), false);
  await assert.rejects(claim(), /permission denied/);
  await assert.rejects(db.query("select * from backup_execucoes_268"), /permission denied/);
  await db.exec("set teste.admin='false'");
  await assert.rejects(request(), /administrador ativo/);
  await assert.rejects(list(), /administrador ativo/);
  await db.exec("set teste.admin='true'");
  await owner();
  await db.exec("update profiles set ativo=false");
  await user();
  await assert.rejects(request(), /administrador ativo/);
  await owner();
  await db.exec("update profiles set ativo=true,precisa_completar_cadastro=true");
  await user();
  await assert.rejects(list(), /administrador ativo/);
  await owner();
  await db.exec("update profiles set precisa_completar_cadastro=false");
  await service();
  await assert.rejects(list(), /permission denied/);
  let job = await claim();
  assert.equal(job.id, id);
  assert.equal(await claim(true), null);
  await assert.rejects(finish(job, true, uid), /expirada ou divergente/);
  const objeto = job.id + "/backup-2026-10-24T03-00-00-000Z.tar";
  const registrar = (path = objeto, lease = job.lease) =>
    db.query("select registrar_download_backup_283($1,$2,$3,$4,$5)", [
      job.id,
      lease,
      path,
      "a".repeat(64),
      1024,
    ]);
  await assert.rejects(registrar("../outro.tar"), /inválido/);
  await assert.rejects(registrar(objeto, uid), /divergente/);
  await registrar();
  await owner();
  await db.query(
    "insert into storage.objects(bucket_id,name) values('erp-backups',$1),('erp-backups','outro.tar'),('comprovantes','prova.pdf')",
    [objeto],
  );
  await user();
  assert.equal(
    (await db.query("select * from storage.objects where bucket_id='erp-backups'")).rows.length,
    0,
  );
  await assert.rejects(
    db.query("select obter_download_backup_283($1)", [job.id]),
    /não disponível/,
  );
  await service();
  await finish(job);
  await assert.rejects(finish(job), /expirada ou divergente/);
  await user();
  assert.equal((await list())[0].copia_externa_verificada, true);
  assert.equal((await list())[0].download_disponivel, true);
  const info = (await db.query("select obter_download_backup_283($1) info", [job.id])).rows[0].info;
  assert.equal(info.objeto, objeto);
  assert.equal(info.bytes, 1024);
  assert.equal(
    (await db.query("select * from storage.objects where bucket_id='erp-backups'")).rows.length,
    1,
  );
  await assert.rejects(registrar(), /permission denied/);
  await assert.rejects(
    db.query("insert into storage.objects(bucket_id,name) values('erp-backups','invasao.tar')"),
    /row-level security/,
  );
  assert.equal(
    (await db.query("delete from storage.objects where bucket_id='erp-backups' returning *")).rows
      .length,
    0,
  );
  assert.equal(
    (
      await db.query(
        "update storage.objects set name='alterado.tar' where bucket_id='erp-backups' returning *",
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (await db.query("select * from storage.objects where bucket_id='comprovantes'")).rows.length,
    1,
  );
  await db.exec("set teste.admin='false'");
  assert.equal(
    (await db.query("select * from storage.objects where bucket_id='erp-backups'")).rows.length,
    0,
  );
  await assert.rejects(
    db.query("select obter_download_backup_283($1)", [job.id]),
    /administrador ativo/,
  );
  await db.exec("set teste.admin='true'");
  await assert.rejects(request(), /cinco minutos/);
  await service();
  job = await claim(true);
  await owner();
  await db.query(
    "update backup_execucoes_268 set lease_ate=now()-interval '1 second' where id=$1",
    [job.id],
  );
  await service();
  assert.equal(await claim(), null);
  await assert.rejects(finish(job), /expirada ou divergente/);
  await user();
  assert.equal((await list()).find((x) => x.id === job.id).estado, "falha");
  await owner();
  await db.exec("set role anon");
  await assert.rejects(request(), /permission denied/);
  await assert.rejects(list(), /permission denied/);
  assert.equal(
    (await db.query("select * from storage.objects where bucket_id='erp-backups'")).rows.length,
    0,
  );
  await assert.rejects(db.query("select obter_download_backup_283($1)", [id]), /permission denied/);
  await owner();
  assert.equal(
    (await db.query("select count(*)::int n from backup_execucoes_268 where estado='sucesso'"))
      .rows[0].n,
    1,
  );
  await db.close();
  console.log(
    "Backup268/283 OK: download privado, bloqueio contra políticas amplas, reaplicação, administrador ativo, negação direta/anon, fila única, lease, intervalo, expiração e resultado sem segredos.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
