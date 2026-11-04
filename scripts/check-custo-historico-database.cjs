// Regressão em PGlite descartável, com dados fictícios e sem rede.
const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const ts = require("typescript");
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated;
   create table produtos(id int primary key,custo_medio numeric,preco_custo numeric,ultimo_custo numeric);
   create table pedidos(id int primary key,data_pedido date,centro_id int,status text,modalidade_venda text,total_liquido numeric);
   create table pedido_itens(pedido_id int,produto_id int,quantidade numeric,custo_unitario_base numeric);
   create function pode_ver_custos_produto_324() returns boolean language sql stable as $$select coalesce(current_setting('test.custos',true),'true')='true'$$;
   create view produtos_consulta_324 as select id,case when pode_ver_custos_produto_324() then custo_medio end custo_medio,case when pode_ver_custos_produto_324() then preco_custo end preco_custo,case when pode_ver_custos_produto_324() then ultimo_custo end ultimo_custo from produtos;
   create view pedidos_mod_300 as select * from pedidos where modalidade_venda=coalesce(nullif(current_setting('test.modalidade',true),''),'estoque');
   create view pedido_itens_mod_300 as select i.* from pedido_itens i join pedidos_mod_300 p on p.id=i.pedido_id;
   insert into produtos values(1,10,12,15);
   insert into pedidos values(1,'2026-11-01',1,'conferido','estoque',200),(2,'2026-11-02',1,'conferido','estoque',200),(3,'2026-11-03',1,'conferido','estoque',200),(4,'2026-11-04',1,'conferido','intermediacao',400);
   insert into pedido_itens values(1,1,10,10),(2,1,10,0),(3,1,10,null),(4,1,10,32.5);`);
    const definition = (pedidos, itens) =>
      `select p.data_pedido data,p.centro_id,sum(i.quantidade*case when p.modalidade_venda='intermediacao' then coalesce(i.custo_unitario_base,0::numeric) else coalesce(pr.custo_medio,pr.preco_custo,pr.ultimo_custo,0::numeric) end) custo from ${pedidos} p join ${itens} i on i.pedido_id=p.id join produtos_consulta_324 pr on pr.id=i.produto_id where p.status not in('rascunho','cancelado','recusado') group by p.data_pedido,p.centro_id`;
    await db.exec(
      `create view vw_cpv with(security_barrier=true) as ${definition("pedidos", "pedido_itens")}; create view vw_cpv_mod_300 as ${definition("pedidos_mod_300", "pedido_itens_mod_300")}; grant select on vw_cpv,vw_cpv_mod_300 to authenticated;`,
    );
    const q = async (s) => (await db.query(s)).rows;
    const state = async () =>
      JSON.stringify(
        await q(
          "select (select jsonb_agg(p) from pedidos p) pedidos,(select jsonb_agg(i) from pedido_itens i) itens,(select jsonb_agg(p) from produtos p) produtos",
        ),
      );
    const before = await state();
    const options = await q(
      "select relname,reloptions,relacl from pg_class where relname in('vw_cpv','vw_cpv_mod_300') order by 1",
    );
    const migration = fs.readFileSync("db/fase327_cpv_custo_historico.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    assert.equal(await state(), before, "Migração deve preservar todos os dados");
    assert.deepEqual(
      await q(
        "select relname,reloptions,relacl from pg_class where relname in('vw_cpv','vw_cpv_mod_300') order by 1",
      ),
      options,
    );
    const cpv = async (view) =>
      (await q(`select custo from ${view} order by data`)).map((x) =>
        x.custo === null ? null : Number(x.custo),
      );
    assert.deepEqual(await cpv("vw_cpv"), [100, 0, 100, 325]);
    await db.exec("update produtos set custo_medio=14");
    assert.deepEqual(await cpv("vw_cpv"), [100, 0, 140, 325]);
    assert.deepEqual(await cpv("vw_cpv_mod_300"), [100, 0, 140]);
    await db.exec("update produtos set custo_medio=0");
    assert.deepEqual(await cpv("vw_cpv"), [100, 0, 120, 325]);
    await db.exec("set test.modalidade='intermediacao'");
    assert.deepEqual(await cpv("vw_cpv_mod_300"), [325]);
    await db.exec("set test.custos='false'");
    assert.deepEqual(await cpv("vw_cpv"), [null, null, null, null]);
    assert.deepEqual(await cpv("vw_cpv_mod_300"), [null]);
    // Exercita também o trecho real do fechamento React, sem renderizar JSX.
    const mod = { exports: {} };
    const helper = ts.transpileModule(fs.readFileSync("src/lib/custo-pedido.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    new Function("exports", helper)(mod.exports);
    const src = fs.readFileSync("src/components/documento-page.tsx", "utf8");
    const start = src.indexOf("const custos =", src.indexOf("const fechamentoDocumento"));
    const end = src.indexOf("const pct =", start);
    assert(start > 0 && end > start);
    const painel = new Function(
      "itens",
      "produtos",
      "inter",
      "doc",
      "custoItemPedido",
      src.slice(start, end) + "return {custo,lucro,margem,semCusto,estimado};",
    );
    const calc = (snapshot, custo_medio, inter = false) =>
      painel(
        { data: [{ quantidade: 10, produto_id: 1, custo_unitario_base: snapshot }] },
        { data: [{ id: 1, custo_medio, preco_custo: 12 }] },
        inter,
        { total_liquido: 200, comissao_valor: 0 },
        mod.exports.custoItemPedido,
      );
    assert.deepEqual(calc(10, 14), {
      custo: 100,
      lucro: 100,
      margem: 50,
      semCusto: false,
      estimado: false,
    });
    assert.equal(calc(12, 0).custo, 120);
    assert.equal(calc(0, 14).custo, 0);
    assert.equal(calc(null, 0).custo, 120);
    assert.equal(calc(null, 0).estimado, true);
    assert.equal(calc(null, 100, true).semCusto, true);
    assert(
      src.includes("podeVerCustosProduto(roles)"),
      "Fechamento deve respeitar privacidade de custos",
    );
    console.log(
      "OK: custo histórico/zero preservados, fallback positivo identificado, Intermediação isolada, CPV base/modalidade e fechamento coerentes, custos protegidos, DDL idempotente e sem regravar dados.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
