const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const d = new PGlite();
  try {
    await d.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;
create function usuario_ativo() returns boolean language sql as $$select current_setting('t.ativo',true)='true'$$;
create function complemento_pendente_238() returns boolean language sql as $$select false$$;
create function saas_acesso_330() returns boolean language sql as $$select true$$;
create function has_role(uuid,text) returns boolean language sql as $$select current_setting('t.admin',true)='true' and $2='admin'$$;
create function can_operate(uuid) returns boolean language sql as $$select true$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='${id(50)}'::uuid$$;
create table profiles(id uuid primary key);insert into profiles values('${id(1)}');
create table centros(id uuid primary key);insert into centros values('${id(50)}'),('${id(51)}');
create table produtos(id uuid primary key,preco_venda numeric);insert into produtos values('${id(20)}',9.95);
create table pedidos(id uuid primary key,centro_id uuid,status text,modalidade_venda text,tipo_documento text,total_itens numeric);insert into pedidos values('${id(10)}','${id(50)}','rascunho','estoque','pedido',3582);
create table pedido_itens(id uuid primary key,pedido_id uuid,produto_id uuid,quantidade numeric,preco_unitario numeric,desconto_percentual numeric);
insert into pedido_itens values('${id(30)}','${id(10)}','${id(20)}',400,9.95,10);
create table auditoria(tabela text,registro_id uuid,acao text,user_id uuid,detalhe jsonb);
create function recalcular_pedido(uuid) returns void language sql as $$update pedidos set total_itens=(select round(sum(quantidade*preco_unitario*(1-desconto_percentual/100)),2) from pedido_itens where pedido_id=pedidos.id) where id=$1$$;
set t.ativo='true';set t.admin='true';`);
    const legado = fs.readFileSync("db/fase81_hardening_crud_pedidos.sql", "utf8");
    const inicio = legado.indexOf("create or replace function public.atualizar_item_pedido(");
    await d.exec(
      legado
        .slice(inicio, legado.indexOf("$$;", inicio) + 3)
        .replace("round(_preco_unitario,2)", "round(_preco_unitario,4)"),
    );
    await d.exec(
      "alter table pedidos add column orcamento_situacao text;alter table pedidos add column orcamento_validade date",
    );
    const sql = fs.readFileSync("db/fase381_negociacao_preco_item.sql", "utf8");
    await d.exec(sql);
    await d.exec(sql);
    const save = (old, next) =>
      d.query("select negociar_preco_item_381($1,$2,$3,400,10,$4)", [
        id(30),
        old,
        next,
        "Negociação de teste",
      ]);
    await d.exec("set role authenticated");
    await save(9.95, 9.5);
    let h = (await d.query("select * from pedido_item_precos_381")).rows;
    assert.equal(h.length, 1);
    assert.equal(Number(h[0].preco_anterior), 9.95);
    assert.equal(Number(h[0].preco_novo), 9.5);
    await assert.rejects(save(9.95, 9), /outra operação/);
    await save(9.5, 9.5);
    assert.equal((await d.query("select * from pedido_item_precos_381")).rows.length, 1);
    await assert.rejects(d.exec("delete from pedido_item_precos_381"), /permission denied/);
    await d.exec("set t.admin='false'");
    assert.equal((await d.query("select * from pedido_item_precos_381")).rows.length, 0);
    await assert.rejects(save(9.5, 9), /Somente administrador/);
    await d.exec("reset role;set t.admin='true'");
    let i = (await d.query("select * from pedido_itens")).rows[0];
    assert.equal(Number(i.quantidade), 400);
    assert.equal(Number(i.desconto_percentual), 10);
    assert.equal(
      Number((await d.query("select total_itens from pedidos")).rows[0].total_itens),
      3420,
    );
    assert.equal(
      Number((await d.query("select preco_venda from produtos")).rows[0].preco_venda),
      9.95,
    );
    await d.query("select atualizar_item_pedido_parcial_381($1,300,null,null)", [id(30)]);
    i = (await d.query("select * from pedido_itens")).rows[0];
    assert.equal(Number(i.quantidade), 300);
    assert.equal(Number(i.preco_unitario), 9.5);
    assert.equal(Number(i.desconto_percentual), 10);
    assert.equal(
      Number((await d.query("select total_itens from pedidos")).rows[0].total_itens),
      2565,
    );
    await assert.rejects(save(9.5, 9), /outra operação/);
    await d.exec("update pedido_itens set quantidade=400;update pedidos set total_itens=3420");
    await d.exec(
      "create function falhar_auditoria_teste() returns trigger language plpgsql as $$begin raise exception 'Falha sintética de auditoria';end$$;create trigger falhar_auditoria_teste before insert on auditoria for each row execute function falhar_auditoria_teste()",
    );
    await assert.rejects(save(9.5, 9), /Falha sintética/);
    assert.equal(
      Number((await d.query("select preco_unitario from pedido_itens")).rows[0].preco_unitario),
      9.5,
    );
    assert.equal(
      Number((await d.query("select total_itens from pedidos")).rows[0].total_itens),
      3420,
    );
    assert.equal(
      (await d.query("select count(*)::int n from pedido_item_precos_381")).rows[0].n,
      1,
    );
    await d.exec("drop trigger falhar_auditoria_teste on auditoria");
    for (const status of ["entregue", "cancelado"]) {
      await d.query("update pedidos set status=$1", [status]);
      await assert.rejects(save(9.5, 9), /fora da negociação/);
    }
    await d.exec("update pedidos set status='rascunho',modalidade_venda='intermediacao'");
    await assert.rejects(save(9.5, 9), /intermediação/);
    await d.exec(`update pedidos set modalidade_venda='estoque',centro_id='${id(51)}'`);
    await assert.rejects(save(9.5, 9), /sem acesso/);
    await d.exec(`update pedidos set centro_id='${id(50)}'`);
    for (const bad of [-1, "NaN", "Infinity", 1.12345])
      await assert.rejects(save(9.5, bad), /Preço inválido/);
    await d.exec("set t.ativo='false'");
    await assert.rejects(save(9.5, 9), /Somente administrador/);
    await d.exec("set role anon");
    await assert.rejects(save(9.5, 9), /permission denied/);
    console.log(
      "OK: negociação381 restrita a admin/loja/edição, histórico imutável, concorrência, total, quantidade/desconto preservados e catálogo inalterado.",
    );
  } finally {
    await d.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
