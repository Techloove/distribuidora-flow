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
    const before = await scalar("select total from compra_itens where id=$1", [id(40)]);
    const migration = fs.readFileSync("db/fase375_compra_ipi_item.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    assert.equal(
      await scalar("select total from compra_itens where id=$1", [id(40)]),
      before,
      "legado sem recálculo",
    );
    const add = (compra = id(30), ipi = 10) =>
      scalar("select to_jsonb(adicionar_item_compra_375($1,$2,10,100,5,$3,null,null))", [
        compra,
        id(20),
        ipi,
      ]);
    const item = await add();
    assert.equal(Number(item.total), 1150);
    assert.equal(Number(item.custo_unitario), 100);
    assert.equal(Number(item.ipi_percentual), 10);
    const u = await scalar("select to_jsonb(atualizar_item_compra_375($1,null,null,null,5))", [
      item.id,
    ]);
    assert.equal(Number(u.total), 1100);
    const v = await scalar("select to_jsonb(atualizar_item_compra_375($1,20,null,null,null))", [
      item.id,
    ]);
    assert.equal(Number(v.ipi_percentual), 5);
    assert.equal(Number(v.total), 2200);
    await assert.rejects(() => add(id(30), -1), /IPI/);
    await assert.rejects(() => add(id(30), 101), /IPI/);
    await assert.rejects(() => add(id(31)), /acesso|centro/i);
    await assert.rejects(() => add(id(32)), /rascunho|recebida|edit/i);
    await db.exec("set test.perfil='false'");
    await assert.rejects(() => add(), /permiss/);
    await db.exec("set test.perfil='true'");
    await db.query("select receber_compra($1)", [id(30)]);
    assert.equal(
      Number(await scalar("select sum(valor) from contas_pagar where compra_id=$1", [id(30)])),
      2200,
    );
    assert.equal(
      Number(await scalar("select custo_unitario from estoque_movimentos limit 1")),
      110,
    );
    await assert.rejects(
      () => db.query("select atualizar_item_compra_375($1,null,null,null,8)", [item.id]),
      /rascunho|recebida|edit/i,
    );
    console.log(
      "OK: IPI separado, custo/total/estoque/parcelas corretos, edição parcial preserva IPI, permissões e recebidas protegidas, histórico preservado, migração idempotente.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.message, e.internalQuery || "");
  process.exit(1);
});
