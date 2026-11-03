// PGlite: histórico por cliente/loja, somente intermediação aprovada, sem médias ou gravações.
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
    for (const f of [
      "fase302_comissoes_aprovadas_data_retomada.sql",
      "fase305_competencia_comissao_aprovacao.sql",
    ])
      await db.exec(fs.readFileSync("db/" + f, "utf8"));
    await db.exec(
      `insert into profiles(id,ativo) values('${id(1)}',true);insert into centros(id,nome) values('${id(10)}','Cimento'),('${id(11)}','Outra loja');insert into clientes(id,razao_social,centro_id) values('${id(20)}','Cliente A','${id(10)}'),('${id(21)}','Cliente B','${id(10)}');insert into produtos(id,descricao) values('${id(22)}','Cimento A'),('${id(23)}','Cimento B');`,
    );
    for (const [n, cli, loja, modalidade, tipo, status] of [
      [30, 20, 10, "intermediacao", "pedido", "rascunho"],
      [31, 20, 10, "intermediacao", "pedido", "aprovado"],
      [32, 20, 10, "intermediacao", "pedido", "entregue"],
      [33, 21, 10, "intermediacao", "pedido", "aprovado"],
      [34, 20, 11, "intermediacao", "pedido", "aprovado"],
      [35, 20, 10, "estoque", "pedido", "aprovado"],
      [36, 20, 10, "intermediacao", "pedido", "rascunho"],
      [37, 20, 10, "intermediacao", "pedido", "cancelado"],
      [38, 20, 10, "intermediacao", "orcamento", "aprovado"],
    ]) {
      await db.query(
        `insert into pedidos(id,numero,cliente_id,centro_id,modalidade_venda,tipo_documento,status,data_pedido,ciclo_reabertura_289,responsavel_frete_intermediacao) values($1,$2,$3,$4,$5,$6,$7,'2026-11-01',0,'loja')`,
        [id(n), n, id(cli), id(loja), modalidade, tipo, status],
      );
      await db.query(
        "insert into pedido_itens(id,pedido_id,produto_id,quantidade,frete_saca,margem_saca) values(gen_random_uuid(),$1,$2,500,$3,$4)",
        [id(n), id(22), n === 31 ? 5.5 : 6, n === 31 ? 1 : 2],
      );
    }
    await db.query(
      `insert into pedido_itens(id,pedido_id,produto_id,quantidade,frete_saca,margem_saca) values(gen_random_uuid(),$1,$2,200,7,1.5)`,
      [id(32), id(23)],
    );
    await db.query(
      `update pedido_comissao_aprovacoes_305 set aprovada_em=case when pedido_id=$1 then '2026-11-01T12:00:00Z'::timestamptz else '2026-11-02T12:00:00Z'::timestamptz end`,
      [id(31)],
    );
    const antes = await scalar("select jsonb_agg(to_jsonb(i) order by id) from pedido_itens i");
    const m = fs.readFileSync("db/fase310_historico_frete_margem_cliente.sql", "utf8");
    await db.exec(m);
    await db.exec(m);
    const consultar = (n = 30, limite = 10) =>
      scalar("select historico_intermediacao_cliente_310($1,$2)", [id(n), limite]);
    const h = await consultar();
    assert.equal(h.cliente, "Cliente A");
    assert.equal(h.loja, "Cimento");
    assert.deepEqual(
      h.pedidos.map((p) => p.numero),
      [32, 31],
    );
    assert.equal(h.pedidos[0].itens.length, 2, "Limite é de pedidos, preserva todos os produtos");
    assert.deepEqual(
      h.pedidos[0].itens.map((i) => [i.frete_saco, i.margem_saco]),
      [
        [6, 2],
        [7, 1.5],
      ],
    );
    assert.equal(h.pedidos[1].itens[0].frete_saco, 5.5);
    assert.equal((await consultar(30, 1)).pedidos[0].itens.length, 2);
    assert.deepEqual(
      await scalar("select jsonb_agg(to_jsonb(i) order by id) from pedido_itens i"),
      antes,
    );
    await db.query(`update pedidos set status='aprovado' where id=$1`, [id(30)]);
    assert.equal(
      (await consultar()).pedidos.some((p) => p.numero === 30),
      false,
      "Pedido atual nunca entra na referência",
    );
    await db.query(`update pedidos set cliente_id=$1 where id=$2`, [id(21), id(30)]);
    assert.deepEqual(
      (await consultar()).pedidos.map((p) => p.numero),
      [33],
      "Trocar cliente troca o histórico inteiro",
    );
    await db.query("update pedidos set cliente_id=$1 where id=$2", [id(20), id(30)]);
    await assert.rejects(() => consultar(35), /apenas em Vendas Intermediação/);
    await assert.rejects(() => consultar(34), /sem acesso/);
    await assert.rejects(() => consultar(30, 21), /entre 1 e 20/);
    await db.exec(
      `create or replace function escopo_representante() returns boolean language sql as $$select true$$;create or replace function documento_na_minha_carteira(text,uuid) returns boolean language sql as $$select $2<>'${id(31)}'::uuid$$`,
    );
    assert.deepEqual(
      (await consultar()).pedidos.map((p) => p.numero),
      [32],
      "Carteira é conferida em cada pedido anterior",
    );
    await db.exec(
      `create or replace function documento_na_minha_carteira(text,uuid) returns boolean language sql as $$select false$$`,
    );
    await assert.rejects(() => consultar(), /sem acesso/);
    assert.equal(await scalar("select count(*) from movimentos_financeiros"), 0);
    console.log(
      "OK: cliente e loja isolados, apenas intermediação aprovada, atual excluído, itens sem médias e carteiras respeitadas; consulta sem gravações.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.stack, e.internalQuery ?? "");
  process.exit(1);
});
