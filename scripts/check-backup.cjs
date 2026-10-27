// Valida os scripts completos com banco/Storage sintéticos; não acessa produção.
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { spawnSync } = require("node:child_process");
(async () => {
  const root = path.resolve(__dirname, ".."),
    temp = await fs.mkdtemp(path.join(os.tmpdir(), "flow-backup-test-"));
  try {
    const bin = path.join(temp, "bin");
    await fs.mkdir(bin);
    await fs.writeFile(
      path.join(bin, "pg_dump"),
      '#!/usr/bin/env node\nif(process.argv.slice(2).join(" ")!=="--format=custom")process.exit(42);process.stdout.write("PGDMP-fixture");\n',
      { mode: 0o700 },
    );
    const hook = path.join(temp, "storage.cjs");
    await fs.writeFile(
      hook,
      `let pass=0;globalThis.fetch=async(url,options)=>{const p=new URL(url).pathname;let data;if(p==='/storage/v1/bucket'){pass++;data=[{id:'entrega-comprovantes',public:false},{id:'novo-bucket',public:false},{id:'erp-backups',public:false}];}else if(p.includes('/list/erp-backups'))throw new Error('Backup recursivo proibido');else if(p.includes('/list/')){const b=JSON.parse(options.body);data=b.prefix===''?[{name:'expedicao',id:null}]:[{name:'prova.pdf',id:'object-id',updated_at:process.env.TEST_STORAGE_CHANGED==='true'&&pass>1?'changed':'same',metadata:{size:Buffer.byteLength('comprovante-fixture')}}];}else return new Response(process.env.TEST_TRUNCATED==='true'?'x':'comprovante-fixture');return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});};`,
    );
    const env = {
      ...process.env,
      PATH: bin + path.delimiter + process.env.PATH,
      PGHOST: "fixture.invalid",
      PGDATABASE: "fixture",
      PGUSER: "fixture",
      PGPASSWORD: "fixture",
      EXT_SUPABASE_URL: "https://fixture.invalid",
      EXT_SUPABASE_SERVICE_ROLE_KEY: "fixture",
      ERP_BACKUP_KEY: "1".repeat(64),
    };
    const run = (script, args = [], overrides = {}) =>
      spawnSync(
        process.execPath,
        [
          ...(script === "backup-supabase.mjs" ? ["--require", hook] : []),
          path.join(root, "scripts", script),
          ...args,
        ],
        { env: { ...env, ...overrides }, encoding: "utf8" },
      );
    const generated = run("backup-supabase.mjs", [path.join(temp, "backups")]);
    assert.equal(generated.status, 0, generated.stderr);
    const folders = await fs.readdir(path.join(temp, "backups"));
    assert.equal(folders.length, 1);
    assert.ok(!folders[0].endsWith(".partial"));
    const backup = path.join(temp, "backups", folders[0]);
    assert.equal(run("verificar-backup.mjs", [backup]).status, 0);
    const extracted = path.join(temp, "extracted");
    const result = run("verificar-backup.mjs", [backup, "--extrair", extracted]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await fs.readFile(path.join(extracted, "banco.dump"), "utf8"), "PGDMP-fixture");
    const source = await fs.readFile(path.join(extracted, "aplicacao.tar"));
    assert.ok(source.length > 0);
    assert.equal(
      spawnSync("tar", ["-tf", path.join(extracted, "aplicacao.tar")], { encoding: "utf8" }).status,
      0,
    );
    assert.equal(
      await fs.readFile(
        path.join(extracted, "storage", "entrega-comprovantes", "expedicao", "prova.pdf"),
        "utf8",
      ),
      "comprovante-fixture",
    );
    assert.equal(
      await fs.readFile(
        path.join(extracted, "storage", "novo-bucket", "expedicao", "prova.pdf"),
        "utf8",
      ),
      "comprovante-fixture",
    );
    await assert.rejects(fs.stat(path.join(extracted, "storage", "erp-backups")), /ENOENT/);
    assert.notEqual(
      run("verificar-backup.mjs", [backup], { ERP_BACKUP_KEY: "2".repeat(64) }).status,
      0,
      "Chave errada deve falhar",
    );
    for (const scenario of ["TEST_STORAGE_CHANGED", "TEST_TRUNCATED"]) {
      const changedRoot = path.join(temp, scenario);
      const failed = run("backup-supabase.mjs", [changedRoot], { [scenario]: "true" });
      assert.notEqual(failed.status, 0, scenario + " deve falhar");
      assert.deepEqual(await fs.readdir(changedRoot), [], "Não publicar backup parcial");
    }
    const database = path.join(backup, "banco.dump.enc"),
      bytes = await fs.readFile(database);
    bytes[22] ^= 1;
    await fs.writeFile(database, bytes);
    assert.notEqual(
      run("verificar-backup.mjs", [backup]).status,
      0,
      "Backup adulterado deve falhar",
    );
    console.log(
      "Backup sintético OK: banco + Storage privado, extração fiel, rejeição de chave errada e adulteração. Restauração de produção não executada.",
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
