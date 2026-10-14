const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create role anon; create role service_role; create schema auth;
   create function auth.role() returns text language sql as $$select coalesce(current_setting('request.jwt.claim.role',true),'service_role')$$;
   create table profiles(id uuid primary key,ativo boolean);
   create table user_roles(user_id uuid,role text);
   create function has_role(uuid,text) returns boolean language sql as $$select exists(select 1 from user_roles where user_id=$1 and role=$2)$$;
   create table centros(id uuid primary key);
   create table contas_financeiras(id uuid primary key,nome text,ativo boolean,centro_id uuid);
   create table categorias_financeiras(id uuid primary key,tipo text);
   create table boletos(id uuid primary key,banco text,canal text,nosso_numero text,cooperativa text,posto text,codigo_beneficiario text);
   create table sicredi_cnab_arquivos(tipo text,sequencia int);
   create table auditoria(tabela text,registro_id uuid,acao text,detalhe jsonb,user_id uuid);
   insert into profiles values('${id(1)}',true),('${id(2)}',true),('${id(3)}',false);
   insert into user_roles values('${id(1)}','admin'),('${id(2)}','gestor'),('${id(3)}','admin');
   insert into centros values('${id(10)}'),('${id(11)}');
   insert into contas_financeiras values('${id(20)}','Sicredi',true,null),('${id(21)}','Exclusiva',true,'${id(10)}');
  `);
    const apiSql = fs.readFileSync(path.join(root, "db/fase18_sicredi_config.sql"), "utf8");
    await db.exec(apiSql.slice(apiSql.indexOf("create table"), apiSql.indexOf("grant select")));
    const cnabSql = fs.readFileSync(path.join(root, "db/fase204_sicredi_cnab240.sql"), "utf8");
    await db.exec(
      cnabSql.slice(
        cnabSql.indexOf("create table"),
        cnabSql.indexOf("create table if not exists public.sicredi_cnab_arquivos"),
      ),
    );
    await db.exec(`create unique index sicredi_api_one on sicredi_config((true)); create unique index sicredi_cnab_one on sicredi_cnab_config((true));
   insert into sicredi_config(api_key,username,password,cooperativa,posto,codigo_beneficiario,tipo_cobranca) values('fixture-key','fixture-user','fixture-password','1111','02','12345','NORMAL');`);
    const src = fs.readFileSync(
      path.join(root, "db/fase208_sicredi_configuracao_compartilhada.sql"),
      "utf8",
    );
    const start = src.indexOf("create or replace function public.cnab_salvar_config(");
    await db.exec(src.slice(start, src.indexOf("$$;", start) + 3));
    const migration = fs.readFileSync(
      path.join(root, "db/fase223_sicredi_convenio_unificado.sql"),
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration);
    const read = async (table) => (await db.query(`select * from ${table}`)).rows[0];
    const savedApi = await read("sicredi_config");
    assert.equal(savedApi.api_key, "fixture-key");
    assert.equal(savedApi.password, "fixture-password");
    let api = {
      ...savedApi,
      api_key: "",
      password: "",
      cooperativa: "2222",
      tipo_juro: "PERCENTUAL",
      juros: 2,
      multa: 3,
    };
    const call = (_api, _cnab, _confirmar = true, actor = id(1)) =>
      db.query("select sicredi_salvar_convenio_223($1,$2,$3,$4)", [
        actor,
        JSON.stringify(_api),
        _cnab === null ? null : JSON.stringify(_cnab),
        _confirmar,
      ]);
    await call(api, null); // API-only does not demand a CNAB account.
    assert.equal((await read("sicredi_config")).api_key, "fixture-key");
    let cnab = {
      centro_id: "",
      nome: "Distribuidora",
      documento: "12345678000195",
      cooperativa: "9999",
      posto: "99",
      beneficiario: "99999",
      conta: "123456",
      conta_dv: "1",
      conta_financeira_id: id(20),
      categoria_tarifa_id: null,
      proxima_remessa: 8,
      proximo_nosso_numero: 42,
      homologado: false,
      juros_mensal: 99,
      multa_percentual: 99,
      tipo_cobranca: "NORMAL",
    };
    await call(api, cnab);
    let c = await read("sicredi_cnab_config");
    assert.equal(c.cooperativa, "2222");
    assert.equal(c.posto, "02");
    assert.equal(c.beneficiario, "12345");
    assert.equal(Number(c.juros_mensal), 2);
    assert.equal(Number(c.multa_percentual), 3);
    assert.equal(c.proxima_remessa, 8);
    assert.equal(c.proximo_nosso_numero, 42);
    // A different centre still shares the current counters. Stale UI numbers never reset them.
    await db.exec("update sicredi_cnab_config set proxima_remessa=9,proximo_nosso_numero=45");
    await call(
      { ...api, api_key: "replacement-key", password: "replacement-password" },
      { ...cnab, centro_id: id(11), proxima_remessa: 1, proximo_nosso_numero: 1 },
    );
    c = await read("sicredi_cnab_config");
    assert.equal(c.centro_id, id(10));
    assert.equal(c.proxima_remessa, 9);
    assert.equal(c.proximo_nosso_numero, 45);
    await call(api, cnab);
    assert.equal((await read("sicredi_config")).api_key, "replacement-key");
    assert.equal((await read("sicredi_config")).password, "replacement-password");
    await assert.rejects(call(api, null), /Mantenha os dados CNAB/);
    await assert.rejects(call({ ...api, tipo_juro: "VALOR" }, cnab), /juros mensais/);
    await assert.rejects(
      call(api, { ...cnab, conta_financeira_id: id(21) }),
      /conta financeira compartilhada/,
    );
    const before = await read("sicredi_cnab_config");
    const auditsBefore = (await db.query("select count(*) n from auditoria")).rows[0].n;
    await assert.rejects(
      call(
        { ...api, especie_documento: null, api_key: "must-rollback" },
        { ...cnab, nome: "Must roll back" },
      ),
      /not-null|null value/,
    );
    assert.deepEqual(await read("sicredi_cnab_config"), before);
    assert.equal((await read("sicredi_config")).api_key, "replacement-key");
    assert.equal((await db.query("select count(*) n from auditoria")).rows[0].n, auditsBefore);
    // Legacy divergence is preserved on migration and requires explicit review on first save.
    await db.exec("update sicredi_config set multa=4");
    await assert.rejects(call(api, cnab, false), /confirme a unificacao/);
    await call(api, cnab, true);
    await assert.rejects(call(api, cnab, true, id(2)), /administrador ativo/);
    await assert.rejects(call(api, cnab, true, id(3)), /administrador ativo/);
    await db.exec("set request.jwt.claim.role='authenticated'");
    await assert.rejects(call(api, cnab), /administrador ativo/);
    await db.exec("set request.jwt.claim.role='service_role'");
    await assert.rejects(
      db.query("select cnab_salvar_config($1,$2)", [id(1), JSON.stringify(cnab)]),
      /convenio unico/,
    );
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(call(api, cnab), /permission denied/);
      await assert.rejects(
        db.query("select cnab_salvar_config_fase208($1,$2)", [id(1), JSON.stringify(cnab)]),
        /permission denied/,
      );
      await db.exec("reset role");
    }
    await db.exec("insert into sicredi_cnab_arquivos values('remessa',9)");
    await assert.rejects(call(api, { ...cnab, conta: "98765" }), /historico/);
    await db.exec(
      `insert into boletos values('${id(30)}','sicredi','api','123','2222','02','12345')`,
    );
    await assert.rejects(call({ ...api, cooperativa: "3333" }, cnab), /Preserve a identificacao/);
    await call(api, cnab);
    assert.equal((await read("sicredi_cnab_config")).proximo_nosso_numero, 45);
    console.log(
      "Convênio Sicredi OK: migração reaplicável, API isolada e API+CNAB atômicos, dados comuns únicos, confirmação de diferenças, credenciais preservadas, sequências globais sem retrocesso, rollback e histórico, papéis e RPCs antigos protegidos.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
