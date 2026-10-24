import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
const temp = await mkdtemp(join(tmpdir(), "backup-executor-"));
try {
  const bin = join(temp, "bin"),
    externo = join(temp, "externo"),
    local = join(temp, "local"),
    log = join(temp, "rpc.json");
  await mkdir(bin);
  await mkdir(externo);
  await writeFile(
    join(bin, "pg_dump"),
    '#!/usr/bin/env node\nprocess.stdout.write("PGDMP-fixture");',
    { mode: 0o700 },
  );
  const hook = join(temp, "hook.cjs");
  await writeFile(
    hook,
    `const fs=require('node:fs');globalThis.fetch=async(url,options)=>{
 const p=new URL(url).pathname;
 if(p.endsWith('/assumir_backup_268'))return Response.json(process.env.TEST_EMPTY==='true'?null:{id:'fixture-id',lease:'fixture-lease'});
 if(p.endsWith('/finalizar_backup_268')){fs.writeFileSync(process.env.TEST_LOG,options.body);return Response.json(null);}
 if(p==='/storage/v1/bucket')return Response.json([{id:'privado',public:false}]);
 if(p.includes('/list/'))return Response.json([{name:'arquivo.txt',id:'obj'}]);
 return new Response('objeto-sintetico');};`,
  );
  const env = {
    ...process.env,
    PATH: bin + delimiter + process.env.PATH,
    NODE_OPTIONS: "--require=" + hook,
    TEST_LOG: log,
    PGHOST: "fixture.invalid",
    PGDATABASE: "fixture",
    PGUSER: "fixture",
    PGPASSWORD: "fixture",
    EXT_SUPABASE_URL: "https://fixture.invalid",
    EXT_SUPABASE_SERVICE_ROLE_KEY: "fixture",
    ERP_BACKUP_KEY: "1".repeat(64),
    ERP_BACKUP_LOCAL: local,
    ERP_BACKUP_EXTERNO: externo,
  };
  const run = (extra) =>
    spawnSync(process.execPath, ["scripts/executor-backup.mjs"], {
      env: { ...env, ...extra },
      encoding: "utf8",
    });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const done = JSON.parse(await readFile(log));
  assert.equal(done._sucesso, true);
  assert.match(done._arquivo, /^backup-/);
  await rm(log);
  assert.equal(run({ TEST_EMPTY: "true" }).status, 0);
  await assert.rejects(readFile(log), /ENOENT/);
  assert.notEqual(run({ ERP_BACKUP_EXTERNO: join(temp, "ausente") }).status, 0);
  const failed = JSON.parse(await readFile(log));
  assert.equal(failed._sucesso, false);
  assert.equal(failed._arquivo, null);
  console.log(
    "Executor OK: fluxo completo sintético, sucesso apenas após verificação externa, fila vazia sem backup e falha reportada sem segredos.",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
