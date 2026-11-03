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
    const old = await scalar(`select to_jsonb(i) from compra_itens i where id='${id(40)}'`);
    const migration = fs.readFileSync("db/fase313_compra_frete_unitario.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const after = await scalar(
      `select to_jsonb(i)-'frete_unitario' from compra_itens i where id='${id(40)}'`,
    );
    assert.deepEqual(after, old);
    const add = (q = 10, c = 27, f = 5.5, compra = id(30), prod = id(20)) =>
      scalar("select to_jsonb(adicionar_item_compra_313($1,$2,$3,$4,$5,'L1','2027-01-01'))", [
        compra,
        prod,
        q,
        c,
        f,
      ]);
    const a = await add();
    assert.equal(Number(a.total), 325);
    assert.equal(Number(a.frete_unitario), 5.5);
    assert.equal(a.lote, "L1");
    assert.equal(a.validade, "2027-01-01");
    const update = (i, q = null, c = null, f = null) =>
      scalar("select to_jsonb(atualizar_item_compra_313($1,$2,$3,$4))", [i, q, c, f]);
    let u = await update(a.id, null, null, 6);
    assert.equal(Number(u.custo_unitario), 27);
    assert.equal(Number(u.quantidade), 10);
    assert.equal(Number(u.total), 330);
    u = await update(a.id, 20);
    assert.equal(Number(u.frete_unitario), 6);
    assert.equal(Number(u.total), 660);
    u = await update(a.id, null, 28);
    assert.equal(Number(u.total), 680);
    assert.equal(Number(u.frete_unitario), 6);
    await add(10, 30, 2);
    await add(5, 40, 8, id(30), id(21));
    const p = await add(1.5, 1.23456, 0.12345);
    assert.equal(Number(p.custo_unitario), 1.2346);
    assert.equal(Number(p.frete_unitario), 0.1235);
    assert.equal(Number(p.total), 2.04);
    await db.query("delete from compra_itens where id=$1", [p.id]);
    for (const vals of [
      [0, 1, 1],
      [1, -1, 0],
      [1, 1, -1],
      [1, 1, "NaN"],
      ["Infinity", 1, 0],
      [1, "NaN", 0],
    ])
      await assert.rejects(() => add(...vals), /válidos/);
    await assert.rejects(() => add(1, 1, 1, id(31)), /outro centro/);
    await assert.rejects(() => update(id(40), 1), /status/);
    await db.exec("set test.acao='false'");
    await assert.rejects(() => add(), /não liberada/);
    await assert.rejects(() => update(a.id, 1), /não liberada/);
    await db.exec("set test.acao='true';set test.perfil='false'");
    await assert.rejects(() => add(), /permissao/);
    await assert.rejects(() => update(a.id, 1), /permissão/);
    await db.exec("set test.perfil='true'");
    // Recebimento: cada produto incorpora seu frete e depois somente o adicional geral.
    await db.query("update compras set frete_valor=24,desconto_valor=4 where id=$1", [id(30)]);
    await db.query("select receber_compra($1)", [id(30)]);
    const cmp = await scalar("select to_jsonb(c) from compras c where id=$1", [id(30)]);
    assert.equal(Number(cmp.total_itens), 1240);
    assert.equal(Number(cmp.total_liquido), 1260);
    const mov = (await db.query("select * from estoque_movimentos order by produto_id")).rows;
    assert.equal(mov.length, 2);
    assert.equal(Number(mov[0].quantidade), 30);
    assert(Math.abs(Number(mov[0].custo_unitario) - (1000 / 30) * (1260 / 1240)) < 1e-8);
    assert(Math.abs(Number(mov[1].custo_unitario) - 48 * (1260 / 1240)) < 1e-8);
    assert.equal(Number(await scalar("select sum(valor) from contas_pagar")), 1260);
    assert.equal(Number(await scalar("select count(*) from contas_pagar")), 3);
    await db.query("select receber_compra($1)", [id(30)]);
    assert.equal(Number(await scalar("select count(*) from contas_pagar")), 3);
    assert.equal(Number(await scalar("select count(*) from estoque_movimentos")), 2);
    await assert.rejects(() => update(a.id, null, null, 0), /status/);
    assert.equal(
      await scalar(
        "select has_function_privilege('anon','adicionar_item_compra_313(uuid,uuid,numeric,numeric,numeric,text,date)','execute')",
      ),
      false,
    );
    console.log(
      "OK: frete próprio por item, precisão, alterações parciais, permissões, histórico preservado, custo ponderado, financeiro e recebimento idempotente.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
