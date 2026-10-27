const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`set timezone='America/Sao_Paulo';create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;
create function auth.role() returns text language sql as $$select coalesce(current_setting('test.role',true),'service_role')$$;
create function usuario_ativo() returns boolean language sql as $$select coalesce(current_setting('test.active',true),'true')='true'$$;
create function can_finance(uuid) returns boolean language sql as $$select true$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='${id(10)}'::uuid$$;
create function escopo_representante() returns boolean language sql as $$select coalesce(current_setting('test.rep',true),'false')='true'$$;
create function documento_na_minha_carteira(text,uuid) returns boolean language sql as $$select coalesce(current_setting('test.portfolio',true),'true')='true'$$;
create function ator_financeiro_pode_acessar_centro(uuid,uuid) returns boolean language sql as $$select $1='${id(1)}'::uuid$$;
create function has_role(uuid,text) returns boolean language sql as $$select $1='${id(1)}'::uuid and $2='admin'$$;
create table profiles(id uuid primary key,ativo boolean);insert into profiles values('${id(1)}',true);
create table centros(id uuid primary key);insert into centros values('${id(10)}'),('${id(11)}');
create table sicredi_config(ambiente text,cooperativa text,posto text,codigo_beneficiario text);insert into sicredi_config values('producao','0165','02','00623');
create table sicredi_auto_config_247(id bool primary key,ativo boolean,segredo text,endpoint text);insert into sicredi_auto_config_247 values(true,true,'secret','https://erp/api/sicredi/sincronizar');
create table boletos(id uuid primary key,centro_id uuid,banco text,canal text,ambiente text,nosso_numero text,cooperativa text,posto text,codigo_beneficiario text,data_emissao date,status text,valor numeric,valor_liquidado numeric);
insert into boletos values('${id(40)}','${id(10)}','sicredi','api','producao','600000228','0165','02','00623',current_date-2,'liquidado',100,100),('${id(41)}','${id(11)}','sicredi','api','producao','600000229','0165','02','00623',current_date-2,'registrado',200,0);
create table movimentos_financeiros(id uuid,valor numeric);insert into movimentos_financeiros values('${id(50)}',100);
create table contas_receber(id uuid,status text,valor_pago numeric);insert into contas_receber values('${id(60)}','pago',100);
create schema cron;create table cron.job(jobname text);create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin insert into cron.job values($1);return 1;end$$;
create schema net;create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;
grant usage on schema public,auth to authenticated;`);
    const sql = fs.readFileSync(path.join(root, "db/fase280_tarifas_api_sicredi.sql"), "utf8");
    await db.exec(sql);
    await db.exec(sql);
    assert.equal((await db.query("select count(*)::int n from cron.job")).rows[0].n, 1);
    const reserve = async (secret = "secret") =>
      (await db.query("select sicredi_tarifas_reservar_280($1) r", [secret])).rows[0].r;
    const finish = async (r, items, error = null) =>
      db.query("select sicredi_tarifas_finalizar_280($1,$2,$3) n", [
        r.lease,
        items === null ? null : JSON.stringify(items),
        error,
      ]);
    await assert.rejects(() => reserve("bad"), /autorizado/);
    await db.exec("set test.role='authenticated'");
    await assert.rejects(() => reserve(), /servidor/);
    await db.exec("set test.role='service_role'");
    const before = (await db.query("select * from boletos")).rows,
      financeBefore = (await db.query("select * from movimentos_financeiros")).rows,
      titleBefore = (await db.query("select * from contas_receber")).rows;
    let r = await reserve();
    assert.ok(r.lease);
    assert.deepEqual(await reserve(), {});
    const item = (num, desc, value) => ({
      cooperativa: "0165",
      posto: "02",
      beneficiario: "00623",
      dia: r.dia,
      nosso_numero: num,
      descricao: desc,
      valor: value,
    });
    await assert.rejects(
      () => finish(r, [{ ...item("600000228", "TARIFA COBRANCA", 1.63), cooperativa: "9999" }]),
      /incompatível/,
    );
    assert.equal(
      (await db.query("select count(*)::int n from sicredi_tarifas_api_280")).rows[0].n,
      0,
    );
    await finish(r, [
      item("600000228", "TARIFA COBRANCA", 1.63),
      item("600000228", "OUTRO DEBITO", 2),
      item("600000229", "TARIFA COBRANCA", 3),
      item("999999999", "TARIFA SEM BOLETO", 4),
    ]);
    let rows = (await db.query("select * from sicredi_tarifas_api_280 order by boleto_id")).rows;
    assert.equal(rows.length, 2);
    assert.equal(Number(rows[0].tarifa_total), 1.63);
    assert.equal(rows[0].outros_debitos, 1);
    assert.equal(rows[0].debitos.length, 2);
    await assert.rejects(() => finish(r, []), /expirada/);
    const dia = r.dia;
    await db.query("update sicredi_tarifas_fila_280 set proxima_consulta='epoch' where dia=$1", [
      dia,
    ]);
    r = await reserve();
    assert.equal(r.dia, dia);
    await finish(r, [item("600000228", "TARIFA COBRANCA", 1.63)]);
    rows = (await db.query("select * from sicredi_tarifas_api_280")).rows;
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].tarifa_total), 1.63);
    await db.query("update sicredi_tarifas_fila_280 set proxima_consulta='epoch' where dia=$1", [
      dia,
    ]);
    r = await reserve();
    await finish(r, null, "TOKEN=SEGREDO");
    assert.equal((await db.query("select * from sicredi_tarifas_api_280")).rows.length, 1);
    assert.equal(
      (await db.query("select erro from sicredi_tarifas_fila_280 where dia=$1", [dia])).rows[0]
        .erro,
      "CONSULTA_FALHOU",
    );
    // Ambiguidade não atribui tarifa a outra loja e preserva snapshot anterior.
    await db.exec(
      `insert into boletos select '${id(42)}','${id(11)}',banco,canal,ambiente,nosso_numero,cooperativa,posto,codigo_beneficiario,data_emissao,status,valor,valor_liquidado from boletos where id='${id(40)}'`,
    );
    await db.query("update sicredi_tarifas_fila_280 set proxima_consulta='epoch' where dia=$1", [
      dia,
    ]);
    r = await reserve();
    await assert.rejects(() => finish(r, [item("600000228", "TARIFA COBRANCA", 1.63)]), /ambíguo/);
    assert.equal((await db.query("select * from sicredi_tarifas_api_280")).rows.length, 1);
    await db.query("delete from boletos where id=$1", [id(42)]);
    await finish(r, []);
    assert.equal((await db.query("select * from sicredi_tarifas_api_280")).rows.length, 0);
    await db.query("update sicredi_tarifas_fila_280 set proxima_consulta='epoch' where dia=$1", [
      dia,
    ]);
    r = await reserve();
    await finish(r, [
      item("600000228", "TARIFA COBRANCA", 1.63),
      item("600000229", "TARIFA COBRANCA", 3),
    ]);
    await db.exec("set role authenticated;set test.role='authenticated'");
    assert.equal(
      (await db.query("select count(*)::int n from sicredi_tarifas_api_280")).rows[0].n,
      1,
    );
    await assert.rejects(
      () => db.exec("select * from sicredi_tarifas_fila_280"),
      /permission denied/,
    );
    await assert.rejects(() => db.exec("delete from sicredi_tarifas_api_280"), /permission denied/);
    await assert.rejects(() => reserve(), /permission denied/);
    await db.exec("set test.rep='true';set test.portfolio='false'");
    assert.equal(
      (await db.query("select count(*)::int n from sicredi_tarifas_api_280")).rows[0].n,
      0,
    );
    await db.exec("set test.rep='false';set test.active='false'");
    await assert.rejects(() => db.exec("select sicredi_tarifas_status_280(null)"), /acesso/);
    await db.exec("reset role;set test.active='true';set test.role='service_role'");
    assert.deepEqual((await db.query("select * from boletos")).rows, before);
    assert.deepEqual((await db.query("select * from movimentos_financeiros")).rows, financeBefore);
    assert.deepEqual((await db.query("select * from contas_receber")).rows, titleBefore);
    console.log(
      "TarifasAPI280 OK: snapshots completos/idempotentes, débitos desconhecidos separados, convênio/loja/carteira, segredo/lease/RLS, falha preserva cache; sem baixa nem despesa.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
