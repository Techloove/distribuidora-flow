const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  try {
    await db.exec(`create role authenticated;create role anon;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function usuario_ativo() returns boolean language sql stable as $$select coalesce(current_setting('test.active',true),'true')<>'false'$$;
create function saas_acesso_330() returns boolean language sql stable as $$select coalesce(current_setting('test.saas',true),'true')<>'false'$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql stable as $$select $1='${id(10)}'::uuid$$;
create function escopo_representante() returns boolean language sql stable as $$select true$$;
create table pedidos(id uuid primary key,centro_id uuid,representante_id uuid,status text,modalidade_venda text,tipo_documento text);
create function documento_na_minha_carteira(text,uuid) returns boolean language sql stable security definer as $$select exists(select 1 from pedidos where id=$2 and representante_id=auth.uid())$$;
alter table pedidos enable row level security;create policy pedido_read on pedidos for select to authenticated using(usuario_pode_acessar_centro(centro_id) and representante_id=auth.uid());grant select on pedidos to authenticated;
create table pedido_itens(id uuid primary key,pedido_id uuid references pedidos,centro_id uuid,produto_id uuid,quantidade numeric);
alter table pedido_itens enable row level security;create policy itens_read on pedido_itens for select to authenticated using(true);
create policy acesso_centro_restrito on pedido_itens as restrictive for all to authenticated using(usuario_pode_acessar_centro(centro_id));
create policy carteira on pedido_itens as restrictive for all to authenticated using(exists(select 1 from pedidos p where p.id=pedido_itens.pedido_id));
create policy ativo on pedido_itens as restrictive for all to authenticated using(usuario_ativo() and saas_acesso_330());
create policy no_insert on pedido_itens as restrictive for insert to authenticated with check(false);
create policy no_update on pedido_itens as restrictive for update to authenticated using(false);
create policy no_delete on pedido_itens as restrictive for delete to authenticated using(false);
grant all on pedido_itens to authenticated;
create table estoque_saldos(produto_id uuid,centro_id uuid,quantidade numeric);create table estoque_reservas(produto_id uuid,centro_id uuid,pedido_id uuid,quantidade numeric);
insert into pedidos values('${id(94)}','${id(10)}','${id(1)}','rascunho','estoque','pedido'),('${id(93)}','${id(10)}','${id(2)}','aguardando_aprovacao','estoque','pedido'),('${id(95)}','${id(20)}','${id(1)}','rascunho','estoque','pedido');
insert into pedido_itens values('${id(101)}','${id(94)}',null,'${id(50)}',20),('${id(102)}','${id(94)}',null,'${id(50)}',20),('${id(103)}','${id(93)}',null,'${id(50)}',1),('${id(104)}','${id(95)}',null,'${id(50)}',1),('${id(105)}','${id(94)}','${id(20)}','${id(50)}',99);
insert into estoque_saldos values('${id(50)}','${id(10)}',-5000),('${id(50)}','${id(20)}',9999);
insert into estoque_reservas values('${id(50)}','${id(10)}','${id(94)}',40),('${id(50)}','${id(10)}','${id(93)}',15);`);
    const q = async (s, a) => (await db.query(s, a)).rows;
    const actor = async () =>
      db.exec(`reset role;select set_config('test.actor','${id(1)}',false);set role authenticated`);
    await actor();
    assert.equal((await q("select * from pedido_itens")).length, 0);
    await db.exec("reset role");
    const before = JSON.stringify(
      await q("select jsonb_agg(to_jsonb(i) order by id) itens from pedido_itens i"),
    );
    const m = fs.readFileSync("db/fase332_itens_pedido_visibilidade_estoque.sql", "utf8");
    await db.exec(m);
    await db.exec(m);
    assert.equal(
      JSON.stringify(
        await q("select jsonb_agg(to_jsonb(i) order by id) itens from pedido_itens i"),
      ),
      before,
    );
    await actor();
    assert.deepEqual(
      (await q("select id from pedido_itens order by id")).map((x) => x.id),
      [id(101), id(102)],
    );
    let a = await q("select * from alertas_estoque_pedido_332($1)", [id(94)]);
    assert.equal(a.length, 2);
    assert(
      a.every(
        (x) =>
          x.insuficiente &&
          Number(x.estoque_disponivel) === 0 &&
          Number(x.quantidade_pedido) === 40,
      ),
    );
    await assert.rejects(
      () => q("select * from alertas_estoque_pedido_332($1)", [id(93)]),
      /sem acesso/,
    );
    await assert.rejects(
      () => q("select * from alertas_estoque_pedido_332($1)", [id(95)]),
      /sem acesso/,
    );
    await assert.rejects(
      () => q("insert into pedido_itens values($1,$2,null,$3,1)", [id(200), id(94), id(50)]),
      /row-level security/,
    );
    assert.equal((await q("update pedido_itens set quantidade=500 returning id")).length, 0);
    await db.exec(`reset role;update estoque_saldos set quantidade=50 where centro_id='${id(10)}'`);
    await actor();
    a = await q("select * from alertas_estoque_pedido_332($1)", [id(94)]);
    assert(a.every((x) => Number(x.estoque_disponivel) === 35 && x.insuficiente));
    await db.exec(`reset role;update estoque_saldos set quantidade=60 where centro_id='${id(10)}'`);
    await actor();
    a = await q("select * from alertas_estoque_pedido_332($1)", [id(94)]);
    assert(a.every((x) => Number(x.estoque_disponivel) === 45 && !x.insuficiente));
    for (const patch of [
      "status='entregue'",
      "status='rascunho',modalidade_venda='intermediacao'",
      "modalidade_venda='estoque',tipo_documento='orcamento'",
    ]) {
      await db.exec(`reset role;update pedidos set ${patch} where id='${id(94)}'`);
      await actor();
      assert.equal((await q("select * from alertas_estoque_pedido_332($1)", [id(94)])).length, 0);
    }
    await db.exec("set test.saas='false'");
    assert.equal((await q("select * from pedido_itens")).length, 0);
    await assert.rejects(
      () => q("select * from alertas_estoque_pedido_332($1)", [id(94)]),
      /sem acesso/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      () => q("select * from alertas_estoque_pedido_332($1)", [id(94)]),
      /permission denied/,
    );
    console.log(
      "OK332: loja herdada, carteira/lojas preservadas, item inconsistente oculto, dados intactos, escrita direta negada, estoque agregado e reservas corretos, sem alertas em histórico/intermediação/orçamento.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
