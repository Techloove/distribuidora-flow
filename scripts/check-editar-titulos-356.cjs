const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;
create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;
create function usuario_ativo() returns boolean language sql as $$select coalesce(current_setting('test.ativo',true),'true')='true'$$;
create function can_finance(uuid) returns boolean language sql as $$select coalesce(current_setting('test.finance',true),'true')='true'$$;
create function pode_rotina(text) returns boolean language sql as $$select coalesce(current_setting('test.permissao',true),'true')='true'$$;
create function escopo_representante() returns boolean language sql as $$select coalesce(current_setting('test.rep',true),'false')='true'$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='${id(10)}'::uuid$$;
create table permissoes(codigo text primary key,nome text,grupo text,ordem int,modulo text);create table role_menus(role text,path text);create table role_permissoes(role text,permissao text,primary key(role,permissao));insert into role_menus values('financeiro','/receber'),('financeiro','/pagar');
create table contas_receber(id uuid primary key,cliente_id uuid,pedido_id uuid,acordo_id uuid,centro_id uuid,documento text,data_emissao date,vencimento date,valor numeric,categoria_id uuid,descricao text,observacao text,status text,valor_pago numeric default 0,juros numeric default 0,multa numeric default 0,desconto numeric default 0,acrescimo numeric default 0,updated_at timestamptz default now());
create table contas_pagar(like contas_receber including all);alter table contas_pagar add column compra_id uuid;
create table movimentos_financeiros(id uuid primary key,conta_receber_id uuid,conta_pagar_id uuid,status text);create table boletos(id uuid primary key,conta_receber_id uuid,status text,nosso_numero text);
create table categorias_financeiras(id uuid primary key,ativo boolean,tipo text);insert into categorias_financeiras values('${id(30)}',true,'receita'),('${id(31)}',true,'despesa');create table auditoria(tabela text,registro_id uuid,acao text,user_id uuid,detalhe jsonb);
insert into contas_receber(id,cliente_id,centro_id,documento,data_emissao,vencimento,valor,categoria_id,status) values('${id(40)}','${id(20)}','${id(10)}','Teste',current_date,current_date+5,50,'${id(30)}','aberto');
insert into contas_pagar(id,cliente_id,centro_id,documento,data_emissao,vencimento,valor,categoria_id,status) values('${id(41)}','${id(21)}','${id(10)}','Despesa',current_date,current_date+5,50,'${id(31)}','aberto');`);
    const sql = fs.readFileSync("db/fase356_editar_titulos.sql", "utf8");
    await db.exec(sql);
    await db.exec(sql);
    const scalar = async (s, a = []) => Object.values((await db.query(s, a)).rows[0])[0];
    const abrir = (t = "contas_receber", i = id(40)) =>
      scalar("select editar_titulo_356($1,$2)", [t, i]);
    const salvar = async (d, t = "contas_receber", i = id(40), v = null) =>
      scalar("select editar_titulo_356($1,$2,$3,$4)", [t, i, d, v ?? (await abrir(t, i)).versao]);
    let old = await abrir();
    await salvar({ documento: "Teste alterado", valor: 75.25, observacao: "Conferido" });
    assert.equal(Number((await abrir()).registro.valor), 75.25);
    assert.equal((await abrir()).registro.documento, "Teste alterado");
    assert.equal(await scalar("select count(*)::int from movimentos_financeiros"), 0);
    assert.equal(await scalar("select count(*)::int from auditoria"), 1);
    await assert.rejects(
      () => salvar({ valor: 90 }, "contas_receber", id(40), old.versao),
      /outra sessão/,
    );
    await salvar({ documento: "Fornecedor corrigido", valor: 80 }, "contas_pagar", id(41));
    assert.equal(Number((await abrir("contas_pagar", id(41))).registro.valor), 80);
    for (const estado of [
      "pendente",
      "em_processamento",
      "registrado",
      "liquidado",
      "baixado",
      "cancelado",
    ]) {
      await db.query("insert into boletos values($1,$2,$3,null)", [id(50), id(40), estado]);
      await assert.rejects(() => abrir(), /boleto/);
      await db.exec("delete from boletos");
    }
    await db.query("insert into boletos values($1,$2,'erro','123')", [id(50), id(40)]);
    await assert.rejects(() => abrir(), /boleto/);
    await db.exec("delete from boletos");
    await db.query("insert into boletos values($1,$2,'erro',null)", [id(50), id(40)]);
    await abrir();
    await db.exec("delete from boletos");
    old = await abrir();
    await db.query("insert into boletos values($1,$2,'registrado','456')", [id(50), id(40)]);
    await assert.rejects(
      () => salvar({ valor: 90 }, "contas_receber", id(40), old.versao),
      /boleto/,
    );
    await db.exec("delete from boletos");
    await db.query("update contas_receber set pedido_id=$1 where id=$2", [id(60), id(40)]);
    assert.equal((await abrir()).vinculado, true);
    await assert.rejects(() => salvar({ valor: 100 }), /origem/);
    await salvar({ documento: "Pedido revisado" });
    await db.exec("update contas_receber set pedido_id=null");
    await db.query("update contas_pagar set compra_id=$1 where id=$2", [id(61), id(41)]);
    await assert.rejects(() => salvar({ valor: 100 }, "contas_pagar", id(41)), /origem/);
    for (const estado of ["pago", "parcial", "cancelado"]) {
      await db.query("update contas_receber set status=$1", [estado]);
      await assert.rejects(() => abrir(), /em aberto/);
    }
    await db.exec("update contas_receber set status='aberto'");
    await db.query("insert into movimentos_financeiros values($1,$2,null,'estornado')", [
      id(70),
      id(40),
    ]);
    await assert.rejects(() => abrir(), /histórico/);
    await db.exec("delete from movimentos_financeiros");
    await assert.rejects(() => salvar({ status: "pago" }), /Campos/);
    await assert.rejects(() => salvar({ categoria_id: id(31) }), /categoria/);
    await assert.rejects(() => salvar({ valor: -1 }), /Confira/);
    await assert.rejects(() => salvar({ valor: 1.001 }), /Confira/);
    await db.exec("update contas_receber set desconto=100");
    await assert.rejects(() => salvar({ valor: 50 }), /saldo positivo/);
    await db.exec("update contas_receber set desconto=0");
    for (const flag of ["test.ativo", "test.finance", "test.permissao"]) {
      await db.exec(`set ${flag}='false'`);
      await assert.rejects(() => abrir(), /permissão/);
      await db.exec(`set ${flag}='true'`);
    }
    await db.exec("set test.rep='true'");
    await assert.rejects(() => abrir(), /permissão/);
    await db.exec("set test.rep='false'");
    await db.query("update contas_receber set centro_id=$1", [id(11)]);
    await assert.rejects(() => abrir(), /loja/);
    assert.equal(
      await scalar(
        "select has_function_privilege('anon','editar_titulo_356(text,uuid,jsonb,text)','execute')",
      ),
      false,
    );
    console.log(
      "OK356: receber/pagar, auditoria, permissões e loja, boleto emitido ou concorrente, histórico, pago/parcial/cancelado, origem preservada, saldo positivo e versão obsoleta. Nenhum movimento financeiro criado.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
