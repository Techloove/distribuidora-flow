const fs = require("node:fs"),
  assert = require("node:assert/strict");
module.exports = async ({ db, id, scalar }) => {
  const consulta = (nome) => scalar(`select ${nome}(current_date,current_date,$1)`, [id(10)]);
  await assert.rejects(() => consulta("relatorio_vendas_230_mod_300"), /d.valor does not exist/);
  const pedidosAntes = await db.query("select * from pedidos order by id");
  await db.exec(fs.readFileSync("db/fase346_lucro_bruto_sem_comissao.sql", "utf8"));
  const baseAntes = await consulta("relatorio_vendas_230");
  const migration = fs.readFileSync("db/fase369_relatorio_vendas_modalidade.sql", "utf8");
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual(await consulta("relatorio_vendas_230"), baseAntes);
  const recorte = async (m) =>
    db.query("select set_config('request.headers',$1,false)", [
      JSON.stringify({ "x-client-info": "caparao-modalidade/" + m }),
    ]);
  for (const [modo, vendas, custo, comissao] of [
    ["todos", 300, 200, 15],
    ["estoque", 100, 40, 5],
    ["intermediacao", 200, 160, 10],
  ]) {
    await recorte(modo);
    const r = await consulta("relatorio_vendas_230_mod_300");
    assert.equal(Number(r.totais.vendas), vendas);
    assert.equal(Number(r.totais.custo), custo);
    assert.equal(Number(r.totais.comissao), comissao);
    assert.equal(Number(r.totais.lucro_bruto_com), vendas - custo);
    assert.equal(r.pedidos.length, modo === "todos" ? 2 : 1);
  }
  const centroOriginal = await scalar(
    "select pg_get_functiondef('usuario_pode_acessar_centro(uuid)'::regprocedure)",
  );
  const permissoesOriginal = await scalar(
    "select pg_get_functiondef('pode_rotina(text)'::regprocedure)",
  );
  await db.exec(
    `create or replace function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='${id(10)}'::uuid$$;`,
  );
  await assert.rejects(
    () => scalar("select relatorio_vendas_230_mod_300(current_date,current_date,$1)", [id(11)]),
    /Centro sem acesso/,
  );
  await db.exec(
    "create or replace function pode_rotina(text) returns boolean language sql as $$select $1<>'vendas_rentabilidade_ver'$$;",
  );
  const restrito = await consulta("relatorio_vendas_230_mod_300");
  assert.equal(restrito.rentabilidade, false);
  assert.equal(restrito.totais.custo, null);
  assert.equal(restrito.totais.lucro_bruto_com, null);
  await db.exec(centroOriginal);
  await db.exec(permissoesOriginal);
  const map = { devolucoes: "devolucoes_mod_300" };
  for (const materialized of ["MATERIALIZED", "NOT MATERIALIZED", ""]) {
    const texto = `WITH devolucoes AS ${materialized} (SELECT 1 AS valor FROM public.devolucoes) SELECT valor FROM devolucoes`;
    const novo = await scalar("select reescrever_leitura_300($1,$2)", [texto, map]);
    assert.match(novo, /FROM public.devolucoes_mod_300/);
    assert.match(novo, /SELECT valor FROM devolucoes$/);
  }
  assert.equal(
    await scalar(
      "select has_function_privilege('authenticated','relatorio_vendas_230_mod_300(date,date,uuid,uuid,uuid,text,text,text,text,text,boolean,integer,integer)','EXECUTE')",
    ),
    true,
  );
  assert.equal(
    await scalar(
      "select has_function_privilege('anon','relatorio_vendas_230_mod_300(date,date,uuid,uuid,uuid,text,text,text,text,text,boolean,integer,integer)','EXECUTE')",
    ),
    false,
  );
  assert.equal(
    await scalar(
      "select has_function_privilege('authenticated','reescrever_leitura_300(text,jsonb)','EXECUTE')",
    ),
    false,
  );
  assert.deepEqual(await db.query("select * from pedidos order by id"), pedidosAntes);
  console.log(
    "OK369: reproduz CTE materializada inválida; relatório real nos três modos, lucro bruto atual, assinatura/ACL, helper privado e pedidos preservados; reaplicável.",
  );
};
