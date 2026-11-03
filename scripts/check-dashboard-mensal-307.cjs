// PGlite: mês limitado nas duas pontas, financeiro por vencimento e comissão por aprovação.
const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  criar = require("./fixtures/banco-relatorios-302.cjs");
(async () => {
  const db = await criar(),
    id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0"),
    scalar = async (q, a = []) => Object.values((await db.query(q, a)).rows[0])[0];
  try {
    for (const d of JSON.parse(
      fs.readFileSync("scripts/fixtures/comissoes-retomada-motores-302.json", "utf8"),
    ))
      await db.exec(d);
    for (const d of JSON.parse(
      fs.readFileSync("scripts/fixtures/calculo-comissao-303.json", "utf8"),
    ))
      await db.exec(d);
    for (const f of [
      "fase302_comissoes_aprovadas_data_retomada.sql",
      "fase304_representante_sem_comissao.sql",
      "fase305_competencia_comissao_aprovacao.sql",
    ])
      await db.exec(fs.readFileSync("db/" + f, "utf8"));
    await db.exec(
      `insert into profiles(id,ativo) values('${id(1)}',true);insert into centros(id,nome,ativo) values('${id(10)}','Ferragens',true),('${id(11)}','Outra',true);insert into clientes(id,razao_social,centro_id) values('${id(20)}','Cliente','${id(10)}');insert into representantes(id,nome,comissao_percentual) values('${id(21)}','Vendedor',5);insert into produtos(id,descricao,categoria,ativo) values('${id(22)}','Produto','Ferragens',true);insert into rotas(id,nome) values('${id(23)}','Rota teste');`,
    );
    for (const [n, date, status, value, mode] of [
      [30, "2026-10-31", "confirmado", 100, "estoque"],
      [31, "2026-11-01", "confirmado", 200, "estoque"],
      [32, "2026-11-30", "confirmado", 300, "intermediacao"],
      [33, "2026-12-01", "confirmado", 900, "estoque"],
      [34, "2026-11-03", "rascunho", 400, "estoque"],
    ]) {
      await db.query(
        `insert into pedidos(id,numero,tipo_documento,status,cliente_id,centro_id,representante_id,rota_id,data_pedido,total_itens,total_liquido,desconto_valor,modalidade_venda,ciclo_reabertura_289) values($1,$2,'pedido',$3,$4,$5,$6,$7,$8,$9,$9,0,$10,0)`,
        [id(n), n, status, id(20), id(10), id(21), id(23), date, value, mode],
      );
      await db.query(
        "insert into pedido_itens(id,pedido_id,produto_id,quantidade,total) values(gen_random_uuid(),$1,$2,$3,$3)",
        [id(n), id(22), value],
      );
    }
    await db.query(
      `insert into comissoes(id,pedido_id,representante_id,centro_id,valor,status) values(gen_random_uuid(),$1,$2,$3,5,'prevista')`,
      [id(30), id(21), id(10)],
    );
    await db.query(
      `update pedido_comissao_aprovacoes_305 set aprovada_em='2026-11-02T12:00:00Z' where pedido_id=$1`,
      [id(30)],
    );
    for (const [n, venc, value] of [
      [40, "2026-10-31", 10],
      [41, "2026-11-01", 20],
      [42, "2026-11-30", 30],
      [43, "2026-12-01", 90],
    ]) {
      await db.query(
        `insert into contas_receber(id,cliente_id,centro_id,pedido_id,documento,valor,valor_pago,juros,multa,acrescimo,desconto,vencimento,status) values($1,$2,$3,$4,'Teste',$5,0,0,0,0,0,$6,'aberto')`,
        [id(n), id(20), id(10), id(31), value, venc],
      );
      await db.query(
        `insert into contas_pagar(id,centro_id,documento,valor,valor_pago,juros,multa,acrescimo,desconto,vencimento,status) values(gen_random_uuid(),$1,'Teste',$2,0,0,0,0,0,$3,'aberto')`,
        [id(10), value, venc],
      );
    }
    await db.query(
      `insert into pedidos(id,numero,tipo_documento,status,centro_id,data_pedido,total_liquido) values($1,35,'pedido','confirmado',$2,'2026-11-03',10000),($3,36,'orcamento','rascunho',$4,'2026-11-03',10000)`,
      [id(35), id(11), id(36), id(10)],
    );
    const antes = await scalar("select jsonb_agg(to_jsonb(p) order by id) from pedidos p");
    const m = fs.readFileSync("db/fase307_dashboard_mensal.sql", "utf8");
    await db.exec(m);
    await db.exec(m);
    assert.deepEqual(
      await scalar("select jsonb_agg(to_jsonb(p) order by id) from pedidos p"),
      antes,
    );
    const nov = await scalar("select dashboard_resumo_mes_307($1,$2)", [id(10), "2026-11-01"]);
    assert.equal(Number(nov.vendasConfirmadas), 500);
    assert.equal(Number(nov.receber), 50);
    assert.equal(Number(nov.pagar), 50);
    assert.equal(
      Number(nov.comissoes),
      5,
      "Aprovação em novembro com pedido de outubro conta comissão em novembro",
    );
    assert.equal(Number(nov.pedidosAbertos), 1);
    assert.equal(nov.inicio, "2026-11-01");
    assert.equal(nov.fim, "2026-11-30");
    assert.equal(
      Number(
        (await scalar("select dashboard_resumo_mes_307(null,$1)", ["2026-11-01"]))
          .vendasConfirmadas,
      ),
      500,
      "Todas as lojas respeita somente centros autorizados",
    );
    const out = await scalar("select dashboard_resumo_mes_307($1,$2)", [id(10), "2026-10-01"]);
    assert.equal(Number(out.vendasConfirmadas), 100);
    assert.equal(Number(out.receber), 10);
    assert.equal(Number(out.comissoes), 0);
    const rank = await scalar("select dashboard_rankings_mes_307($1,$2)", [id(10), "2026-11-01"]);
    assert.equal(Number(rank.rotas[0].valor), 500, "Dezembro não entra no ranking de novembro");
    await db.query(
      "select set_config('request.headers','{\"x-client-info\":\"caparao-modalidade/intermediacao\"}',false)",
    );
    const inter = await scalar("select dashboard_resumo_mes_307_mod_300($1,$2)", [
      id(10),
      "2026-11-01",
    ]);
    assert.equal(Number(inter.vendasConfirmadas), 300);
    assert.equal(Number(inter.receber), 0);
    assert.equal(Number(inter.comissoes), 0);
    const rInter = await scalar("select dashboard_rankings_mes_307_mod_300($1,$2)", [
      id(10),
      "2026-11-01",
    ]);
    assert.equal(Number(rInter.rotas[0].valor), 300);
    await assert.rejects(
      () => db.query("select dashboard_resumo_mes_307($1,$2)", [id(11), "2026-11-01"]),
      /Centro nao autorizado/,
    );
    await assert.rejects(
      () =>
        db.query(
          "select dashboard_resumo_mes_307(null,((now() at time zone 'America/Sao_Paulo')::date+interval '2 months')::date)",
        ),
      /mês atual/,
    );
    await db.exec("set test.ativo='false'");
    await assert.rejects(
      () => db.query("select dashboard_resumo_mes_307(null,$1)", ["2026-11-01"]),
      /Acesso nao autorizado/,
    );
    console.log(
      "OK: mês corrente/anteriores isolados, limites do ranking, vencimentos, competência de aprovação, modalidade, lojas e dados preservados.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.stack, e.internalQuery ?? "");
  process.exit(1);
});
