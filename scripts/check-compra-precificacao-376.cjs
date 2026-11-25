// Motores reais de compras antes da migração, isolados em banco descartável.
const { PGlite } = require("@electric-sql/pglite"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  motor = require("./fixtures/compra-frete-313.json");
(async () => {
  const db = new PGlite(),
    id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;
create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;
create function can_stock(uuid) returns boolean language sql as $$select coalesce(current_setting('test.perfil',true),'true')='true'$$;
create function can_finance(uuid) returns boolean language sql as $$select false$$;
create function pode_rotina(text) returns boolean language sql as $$select coalesce(current_setting('test.acao',true),'true')='true'$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='${id(10)}'::uuid$$;
create table compras(id uuid primary key,numero int,centro_id uuid,fornecedor_id uuid,status text, data_entrada date,total_itens numeric default 0,total_liquido numeric default 0,frete_valor numeric default 0,desconto_valor numeric default 0,parcelas int,nf_numero text);
create table produtos(id uuid primary key);
create table compra_itens(id uuid primary key default gen_random_uuid(),compra_id uuid,produto_id uuid,quantidade numeric,custo_unitario numeric,lote text,validade date,total numeric);
create table contas_pagar(id uuid default gen_random_uuid(),fornecedor_id uuid,compra_id uuid,documento text,parcela int,valor numeric,vencimento date,centro_id uuid,data_emissao date,status text);
create table auditoria(tabela text,registro_id uuid,acao text,detalhe jsonb,user_id uuid);
create table estoque_movimentos(produto_id uuid,centro_id uuid,quantidade numeric,custo_unitario numeric);
create function registrar_movimento_estoque_controlado(uuid,uuid,text,numeric,numeric,text,uuid,text) returns void language sql as $$insert into estoque_movimentos values($1,$2,$4,$5)$$;`);
    for (const d of Object.values(motor)) await db.exec(d);
    await db.exec(`create trigger trg_compra_itens_total before insert or update on compra_itens for each row execute function compra_itens_total();
insert into produtos values('${id(20)}'),('${id(21)}');
insert into compras(id,numero,centro_id,fornecedor_id,status,data_entrada,parcelas) values('${id(30)}',1,'${id(10)}','${id(15)}','rascunho','2026-11-03',3),('${id(31)}',2,'${id(11)}','${id(15)}','rascunho','2026-11-03',1),('${id(32)}',3,'${id(10)}','${id(15)}','recebida','2026-10-01',1);
insert into compra_itens(id,compra_id,produto_id,quantidade,custo_unitario) values('${id(40)}','${id(32)}','${id(20)}',5,21);`);
    const scalar = async (q, a = []) => Object.values((await db.query(q, a)).rows[0])[0];

    await db.exec(fs.readFileSync("db/fase313_compra_frete_unitario.sql", "utf8"));

    await db.exec(`alter table produtos add column descricao text default 'Produto',add column custo_medio numeric(14,4) default 50,add column estoque_atual numeric(14,3) default 10,add column preco_venda numeric(14,4) default 80,add column markup_percentual numeric(14,2) default 60;
    create function pode_ver_custos_produto_324() returns boolean language sql as $$select coalesce(current_setting('test.custos',true),'true')='true'$$;
    create function pode_alterar_preco(uuid) returns boolean language sql as $$select coalesce(current_setting('test.precos',true),'true')='true'$$;
    create function loja_produto_estoque_271(uuid) returns uuid language sql as $$select '${id(10)}'::uuid$$;
    create or replace function registrar_movimento_estoque_controlado(uuid,uuid,text,numeric,numeric,text,uuid,text) returns void language plpgsql as $$begin
      insert into estoque_movimentos values($1,$2,$4,$5);
      update produtos set custo_medio=case when estoque_atual+$4>0 then (estoque_atual*custo_medio+$4*$5)/(estoque_atual+$4) else custo_medio end,estoque_atual=estoque_atual+$4 where id=$1;
    end $$;`);
    const markup = fs.readFileSync("db/fase23_markup_fixo.sql", "utf8");
    const start = markup.indexOf("create or replace function public.sincronizar_markup_produto()");
    await db.exec(markup.slice(start));
    await db.exec(fs.readFileSync("db/fase375_compra_ipi_item.sql", "utf8"));
    const m = fs.readFileSync("db/fase376_compra_precificacao.sql", "utf8");
    await db.exec(m);
    await db.exec(m);
    if (process.env.SQL_COMPRA_COMPLETO)
      await db.exec(fs.readFileSync(process.env.SQL_COMPRA_COMPLETO, "utf8"));
    await db.query("select adicionar_item_compra_375($1,$2,5,100,5,10,null,null)", [
      id(30),
      id(20),
    ]);
    await db.query("select adicionar_item_compra_375($1,$2,5,100,5,10,null,null)", [
      id(30),
      id(20),
    ]);
    const preview = () => scalar("select previa_precificacao_compra_376($1)", [id(30)]);
    let rows = await preview();
    assert.equal(Number(rows[0].custo_novo), 82.5);
    assert.equal(Number(rows[0].preco_atual), 80);
    assert.equal(Number(rows[0].preco_sugerido), 132);
    const save = (mode, value) =>
      db.query("select salvar_precificacao_compra_376($1,$2,$3,$4)", [id(30), id(20), mode, value]);
    await save("markup", 40);
    assert.equal(
      Number(await scalar("select preco_venda from produtos where id=$1", [id(20)])),
      80,
      "salvar plano não altera produto antes do recebimento",
    );
    await db.exec("set test.precos='false'");
    await assert.rejects(() => save("preco", 95), /permite alterar/);
    await assert.rejects(() => db.query("select receber_compra($1)", [id(30)]), /permissão/);
    assert.equal(Number(await scalar("select count(*) from estoque_movimentos")), 0);
    await db.exec("set test.precos='true'");
    await db.exec("set test.custos='false'");
    await assert.rejects(() => preview(), /Sem acesso/);
    await db.exec("set test.custos='true'");
    await db.query("update produtos set custo_medio=60 where id=$1", [id(20)]);
    await db.query("select receber_compra($1)", [id(30)]);
    assert.equal(
      Number(await scalar("select custo_medio from produtos where id=$1", [id(20)])),
      87.5,
    );
    assert.equal(
      Number(await scalar("select preco_venda from produtos where id=$1", [id(20)])),
      122.5,
    );
    assert.equal(
      Number(await scalar("select markup_percentual from produtos where id=$1", [id(20)])),
      40,
    );
    await db.query("select receber_compra($1)", [id(30)]);
    assert.equal(Number(await scalar("select count(*) from estoque_movimentos")), 1);
    assert.equal(
      Number(await scalar("select count(*) from auditoria where acao='preco_recebimento_376'")),
      1,
    );
    await assert.rejects(() => save("preco", 90), /antes do recebimento/);
    await db.query(
      "insert into compras(id,numero,centro_id,fornecedor_id,status,data_entrada,parcelas) values($1,4,$2,$3,'rascunho','2026-11-25',1)",
      [id(33), id(10), id(15)],
    );
    await db.query("select adicionar_item_compra_375($1,$2,10,100,5,10,null,null)", [
      id(33),
      id(21),
    ]);
    await db.query("select salvar_precificacao_compra_376($1,$2,'preco',80)", [id(33), id(21)]);
    await db.query("select receber_compra($1)", [id(33)]);
    assert.equal(
      Number(await scalar("select preco_venda from produtos where id=$1", [id(21)])),
      80,
      "preço digitado é exato mesmo quando igual ao preço anterior",
    );
    console.log(
      "OK: prévia ponderada, markup e preço explícito, só aplica no recebimento, permissões/custos, auditoria, idempotência e compra recebida protegidos.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.message, e.internalQuery || "");
  process.exit(1);
});
