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
create function usuario_ativo() returns boolean language sql as $$select coalesce(current_setting('test.active',true),'true')='true'$$;
create function can_finance(uuid) returns boolean language sql as $$select coalesce(current_setting('test.finance',true),'true')='true'$$;
create function pode_rotina(text) returns boolean language sql as $$select coalesce(current_setting('test.routine',true),'true')='true'$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='${id(10)}'::uuid$$;
create function escopo_representante() returns boolean language sql as $$select coalesce(current_setting('test.rep',true),'false')='true'$$;
create function documento_na_minha_carteira(text,uuid) returns boolean language sql as $$select coalesce(current_setting('test.portfolio',true),'true')='true'$$;
create function sicredi_liquidar_api_224(uuid,uuid,jsonb) returns void language sql as $$select null::void$$;
create table profiles(id uuid primary key);insert into profiles values('${id(1)}');
create table centros(id uuid primary key);insert into centros values('${id(10)}'),('${id(11)}');
create table contas_financeiras(id uuid primary key,centro_id uuid,ativo boolean);insert into contas_financeiras values('${id(20)}','${id(10)}',true);
create table categorias_financeiras(id uuid primary key,tipo text,ativo boolean);insert into categorias_financeiras values('${id(21)}','despesa',true),('${id(22)}','receita',true);
create table contas_receber(id uuid primary key,centro_id uuid,status text,conta_financeira_id uuid,valor numeric,juros numeric,multa numeric,valor_pago numeric);insert into contas_receber values('${id(30)}','${id(10)}','pago','${id(20)}',100,5,2,107);
create table boletos(id uuid primary key,centro_id uuid,conta_receber_id uuid,banco text,canal text,ambiente text,status text,data_liquidacao date,nosso_numero text,valor numeric,valor_liquidado numeric);insert into boletos values('${id(40)}','${id(10)}','${id(30)}','sicredi','api','producao','liquidado',current_date-1,'123456789',100,107),('${id(41)}','${id(11)}','${id(30)}','sicredi','api','producao','liquidado',current_date-1,'111111111',100,107);
create table movimentos_financeiros(id uuid primary key default gen_random_uuid(),conta_id uuid,data date,tipo text,origem text,valor numeric,categoria_id uuid,centro_id uuid,descricao text,documento text,created_by uuid,status text default 'ativo');insert into movimentos_financeiros(conta_id,tipo,origem,valor,centro_id) values('${id(20)}','entrada','recebimento',107,'${id(10)}');
create table auditoria(tabela text,registro_id uuid,acao text,detalhe jsonb,user_id uuid);
create table permissoes(codigo text primary key,nome text,grupo text,ordem int,modulo text);create table role_permissoes(role text,permissao text,primary key(role,permissao));create table role_menus(role text,path text);insert into role_menus values('admin','/boletos');
grant usage on schema auth,public to authenticated;
`);
    const source = fs.readFileSync(
      path.join(root, "db/fase71_perimetro_financeiro_centros.sql"),
      "utf8",
    );
    const a = source.indexOf("create or replace function public.lancar_movimento(");
    await db.exec(source.slice(a, source.indexOf("$$;", a) + 3));
    const sql = fs.readFileSync(path.join(root, "db/fase279_tarifa_cobranca_sicredi.sql"), "utf8");
    await db.exec(sql);
    await db.exec(sql);
    const fee = (boleto = id(40), value = 1.63, category = id(21), confirmed = true) =>
      db.query("select * from registrar_tarifa_sicredi_279($1,$2,current_date,$3,$4,$5)", [
        boleto,
        value,
        category,
        "Extrato TX123",
        confirmed,
      ]);
    await assert.rejects(() => fee(id(41)), /loja\/carteira/);
    for (const flag of ["active", "finance", "routine"]) {
      await db.exec(`set test.${flag}='false'`);
      await assert.rejects(() => fee(), /permissão/);
      await db.exec(`set test.${flag}='true'`);
    }
    await db.exec("set test.rep='true';set test.portfolio='false'");
    await assert.rejects(() => fee(), /carteira/);
    await db.exec("set test.rep='false';set test.portfolio='true'");
    await assert.rejects(() => fee(id(40), 3, id(21), false), /extrato/);
    await assert.rejects(() => fee(id(40), 3, id(22)), /despesa/);
    for (const v of [-1, 0, "NaN", "Infinity", 1.234])
      await assert.rejects(() => fee(id(40), v), /positiva/);
    const before = (await db.query("select * from contas_receber")).rows;
    const boletoBefore = (await db.query("select * from boletos")).rows;
    const first = (await fee()).rows[0];
    const repeat = (await fee()).rows[0];
    assert.equal(first.movimento_id, repeat.movimento_id);
    assert.equal(
      (await db.query("select count(*)::int n from movimentos_financeiros where tipo='saida'"))
        .rows[0].n,
      1,
    );
    assert.equal(
      Number(
        (
          await db.query(
            "select sum(case when tipo='entrada' then valor else -valor end) saldo from movimentos_financeiros",
          )
        ).rows[0].saldo,
      ),
      105.37,
    );
    assert.deepEqual((await db.query("select * from contas_receber")).rows, before);
    assert.deepEqual((await db.query("select * from boletos")).rows, boletoBefore);
    await assert.rejects(() => fee(id(40), 4), /já possui/);
    await db.exec("set role authenticated");
    assert.equal((await db.query("select count(*)::int n from sicredi_tarifas_279")).rows[0].n, 1);
    await assert.rejects(
      db.query("insert into sicredi_tarifas_279(boleto_id) values($1)", [id(41)]),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.query("update movimentos_financeiros set status='estornado' where id=$1", [
      first.movimento_id,
    ]);
    await assert.rejects(() => fee(), /estornada/);
    // Falha no vínculo/auditoria reverte o movimento da despesa junto com a tarifa.
    await db.exec(
      `insert into boletos select '${id(42)}',centro_id,conta_receber_id,banco,canal,ambiente,status,data_liquidacao,nosso_numero,valor,valor_liquidado from boletos where id='${id(40)}';create function falhar_tarifa() returns trigger language plpgsql as $$begin if new.acao='tarifa_cobranca_279' then raise exception 'Falha simulada';end if;return new;end$$;create trigger falhar_tarifa before insert on auditoria for each row execute function falhar_tarifa();`,
    );
    await assert.rejects(() => fee(id(42)), /Falha simulada/);
    assert.equal(
      (await db.query("select count(*)::int n from movimentos_financeiros")).rows[0].n,
      2,
    );
    assert.equal((await db.query("select count(*)::int n from sicredi_tarifas_279")).rows[0].n, 1);
    console.log(
      "Tarifa279 OK: recebimento107 preservado, despesa1,63 separada/saldo105,37, replay sem duplicar, loja/carteira/permissão, categoria, estorno e rollback.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
