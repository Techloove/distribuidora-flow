// PGlite: revisão explícita de preço/data, concorrência e isolamento dos pedidos existentes.
const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  criar = require("./fixtures/banco-relatorios-302.cjs");
(async () => {
  const db = await criar(),
    id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0"),
    scalar = async (q, a = []) => Object.values((await db.query(q, a)).rows[0])[0];
  try {
    await db.exec(
      `create function pode_alterar_preco(uuid) returns boolean language sql as $$select coalesce(current_setting('test.preco',true),'true')='true'$$;create or replace function can_manage(uuid) returns boolean language sql as $$select coalesce(current_setting('test.gestao',true),'true')='true'$$;create or replace function pode_rotina(text) returns boolean language sql as $$select coalesce(current_setting('test.config',true),'true')='true'$$;create or replace function intermediacao_ativa_296(uuid) returns boolean language sql as $$select usuario_ativo() and usuario_pode_acessar_centro($1)$$;create or replace function produto_categoria_loja_246(uuid,uuid) returns boolean language sql as $$select exists(select 1 from loja_produtos where centro_id=$1 and produto_id=$2 and disponivel)$$;alter table intermediacao_cotacoes_296 alter column id set default gen_random_uuid();alter table auditoria alter column id set default gen_random_uuid();insert into profiles(id,ativo) values('${id(1)}',true);insert into centros(id,nome) values('${id(10)}','Cimento'),('${id(11)}','Outra');insert into produtos(id,descricao,ativo) values('${id(20)}','Cimento A',true),('${id(21)}','Outra loja',true);insert into loja_produtos(centro_id,produto_id,disponivel) values('${id(10)}','${id(20)}',true),('${id(11)}','${id(21)}',true);insert into pedidos(id,numero,tipo_documento,status,centro_id) values('${id(30)}',30,'pedido','rascunho','${id(10)}');insert into pedido_itens(id,pedido_id,produto_id,quantidade,custo_fabrica_saca,frete_saca,margem_saca,preco_unitario,total) values('${id(31)}','${id(30)}','${id(20)}',500,27,5.5,1,33.5,16750);`,
    );
    const antes = await scalar("select to_jsonb(i) from pedido_itens i");
    const m = fs.readFileSync("db/fase309_cotacao_edicao_lista.sql", "utf8");
    await db.exec(m);
    await db.exec(m);
    const salvar = (
      dia,
      custo,
      esperada = null,
      ate = "2026-11-03",
      loja = id(10),
      produto = id(20),
    ) =>
      scalar("select to_jsonb(salvar_cotacao_lista_309($1,$2,$3,$4,$5,$6))", [
        loja,
        produto,
        dia,
        custo,
        ate,
        esperada,
      ]);
    const primeira = await salvar("2026-11-01", 27.1234);
    assert.equal(Number(primeira.custo_fabrica), 27.1234);
    assert.equal(primeira.revisao, 1);
    const preco = await salvar("2026-11-03", 27.5, primeira.id);
    assert.equal(preco.revisao, 1);
    assert.equal(
      (await salvar("2026-11-03", 27.5, primeira.id)).id,
      preco.id,
      "Repetição idempotente não cria outra cotação",
    );
    const data = await salvar("2026-11-04", 27.5, preco.id, "2026-11-04");
    assert.equal(
      data.dia,
      "2026-11-04",
      "Alteração explícita de data funciona mesmo com o preço mantido",
    );
    const revisao = await salvar("2026-11-04", 28, data.id, "2026-11-04");
    assert.equal(revisao.revisao, 2);
    await assert.rejects(() => salvar("2026-11-04", 30, data.id, "2026-11-04"), /foi alterada/);
    await assert.rejects(
      () => salvar("2026-11-02", 29, revisao.id, "2026-11-04"),
      /anterior ao último/,
    );
    await assert.rejects(() => salvar("2026-11-05", 29, revisao.id, "2026-11-04"), /data válida/);
    for (const custo of [0, -1, 27.12345, "NaN", "Infinity"])
      await assert.rejects(
        () => salvar("2026-11-04", custo, revisao.id, "2026-11-04"),
        /data válida/,
      );
    await assert.rejects(
      () => salvar("2026-11-03", 20, null, "2026-11-03", id(11), id(21)),
      /Sem permissão/,
    );
    await assert.rejects(
      () => salvar("2026-11-03", 20, null, "2026-11-03", id(10), id(21)),
      /indisponível/,
    );
    assert.equal(await scalar("select count(*) from intermediacao_cotacoes_296"), 4);
    assert.equal(await scalar("select count(*) from auditoria where acao='cotacao_lista_309'"), 4);
    assert.deepEqual(await scalar("select to_jsonb(i) from pedido_itens i"), antes);
    assert.equal(await scalar("select count(*) from contas_receber"), 0);
    assert.equal(await scalar("select count(*) from movimentos_financeiros"), 0);
    await db.exec("set test.gestao='false';set test.config='false';set test.preco='false'");
    await assert.rejects(() => salvar("2026-11-04", 30, revisao.id, "2026-11-04"), /Sem permissão/);
    await db.exec("set test.preco='true';set test.ativo='false'");
    await assert.rejects(() => salvar("2026-11-04", 30, revisao.id, "2026-11-04"), /Sem permissão/);
    console.log(
      "OK: valor/data por linha, quatro casas preservadas, revisão, idempotência, concorrência, loja/permissão e custos dos pedidos intactos.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.stack, e.internalQuery ?? "");
  process.exit(1);
});
