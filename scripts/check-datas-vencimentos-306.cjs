// PGlite: motor real de confirmação e prazos com aprovação, original imutável e rollback.
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
    for (const d of JSON.parse(
      fs.readFileSync("scripts/fixtures/confirmacao-prazos-306.json", "utf8"),
    ))
      await db.exec(d);
    await db.exec(
      `alter table auditoria alter column id set default gen_random_uuid();alter table comissoes alter column id set default gen_random_uuid();alter table contas_receber alter column id set default gen_random_uuid();create unique index teste_inter_unique on intermediacao_confirmacoes_296(pedido_id,ciclo);create table teste_movimentos(pedido uuid);create function recalcular_pedido(uuid) returns void language sql as $$select$$;create function validar_pedido(uuid) returns jsonb language sql as $$select '[]'::jsonb$$;create function registrar_movimento_estoque_controlado(uuid,uuid,text,numeric,numeric,text,uuid,text) returns void language sql as $$insert into teste_movimentos values($7)$$;create trigger trg_apurar after insert or update of status,representante_id,total_itens,desconto_valor,comissao_percentual on pedidos for each row execute function trg_apurar_comissao_pedido();insert into profiles(id,ativo) values('${id(1)}',true);insert into centros(id,nome) values('${id(10)}','Loja');insert into representantes(id,nome,comissao_percentual) values('${id(20)}','Vendedor',5);insert into clientes(id,razao_social) values('${id(21)}','Cliente');insert into produtos(id,descricao,comissao_percentual) values('${id(22)}','Produto',5);insert into formas_pagamento(id,nome,parcelas_padrao,dias_primeira_parcela,intervalo_dias) values('${id(23)}','30/60/90',3,30,30);`,
    );
    const novo = async (n, status = "rascunho", modalidade = "estoque") => {
      await db.query(
        `insert into pedidos(id,numero,tipo_documento,status,centro_id,cliente_id,representante_id,modalidade_venda,ciclo_reabertura_289,data_pedido,parcelas,forma_pagamento_id,total_itens,total_liquido,desconto_valor,comissao_percentual,comissao_valor) values($1,$2,'pedido',$3,$4,$5,$6,$7,0,'2026-10-31',3,$8,100,100,0,5,5)`,
        [id(n), n, status, id(10), id(21), id(20), modalidade, id(23)],
      );
      await db.query(
        "insert into pedido_itens(id,pedido_id,produto_id,quantidade,total) values(gen_random_uuid(),$1,$2,10,100)",
        [id(n), id(22)],
      );
    };
    await novo(50);
    await db.query(`update pedidos set data_pedido='2026-11-01' where id=$1`, [id(50)]);
    await db.query(
      `insert into auditoria(tabela,registro_id,acao,detalhe,created_at) values('pedidos',$1,'data_retomada_302','{"data_anterior":"2026-10-31","data_nova":"2026-11-01"}',now())`,
      [id(50)],
    );
    await db.exec(
      `insert into contas_receber(id,documento,valor,vencimento,status) values('${id(500)}','Título antigo',70,'2026-11-15','aberto')`,
    );
    const tituloAntigo = await scalar("select to_jsonb(t) from contas_receber t where id=$1", [
      id(500),
    ]);
    await db.query(
      `insert into auditoria(tabela,registro_id,acao,detalhe,created_at) values('pedidos',$1,'insert_campos','{"depois":{"data_pedido":"2026-10-30"}}',now()-interval '1 day')`,
      [id(50)],
    );
    const m = fs.readFileSync("db/fase306_datas_pedido_vencimento_aprovacao.sql", "utf8");
    await db.exec(m);
    await db.exec(m);
    assert.deepEqual(
      await scalar("select to_jsonb(t) from contas_receber t where id=$1", [id(500)]),
      tituloAntigo,
    );
    let datas = await scalar("select datas_pedido_306($1)", [id(50)]);
    assert.equal(datas.data_original, "2026-10-30");
    assert.equal(datas.data_comercial, "2026-11-01");
    assert.equal(datas.data_aprovacao, null);
    await db.query(`update pedidos set data_pedido='2026-11-02' where id=$1`, [id(50)]);
    assert.equal(
      (await scalar("select datas_pedido_306($1)", [id(50)])).data_original,
      "2026-10-30",
    );
    await novo(60, "aprovado");
    await db.query(
      `update pedido_comissao_aprovacoes_305 set aprovada_em='2026-11-02T12:00:00Z' where pedido_id=$1`,
      [id(60)],
    );
    await db.query("select confirmar_pedido($1)", [id(60)]);
    assert.deepEqual(
      (
        await db.query(
          "select vencimento::text from contas_receber where pedido_id=$1 order by parcela",
          [id(60)],
        )
      ).rows.map((x) => x.vencimento),
      ["2026-12-02", "2027-01-01", "2027-01-31"],
    );
    assert.deepEqual(
      (
        await db.query(
          "select valor::text from contas_receber where pedido_id=$1 order by parcela",
          [id(60)],
        )
      ).rows.map((x) => Number(x.valor)),
      [33.33, 33.33, 33.34],
    );
    assert.equal(await scalar("select count(*) from teste_movimentos"), 1);
    await novo(61);
    await db.query("select confirmar_pedido($1)", [id(61)]);
    assert.equal(
      await scalar("select count(*) from comissoes where pedido_id=$1", [id(61)]),
      1,
      "Comissão criada após confirmar, sem inserir durante o rascunho",
    );
    assert.equal(
      await scalar(
        "select count(*) from contas_receber where pedido_id=$1 and vencimento=(select (aprovada_em at time zone 'America/Sao_Paulo')::date from pedido_comissao_aprovacoes_305 where pedido_id=$1)+30+(parcela-1)*30",
        [id(61)],
      ),
      3,
    );
    await db.query("select confirmar_pedido($1)", [id(61)]);
    assert.equal(
      await scalar("select count(*) from contas_receber where pedido_id=$1", [id(61)]),
      3,
      "Repetição não duplica parcelas",
    );
    await novo(62, "rascunho", "intermediacao");
    await db.query("select confirmar_pedido($1)", [id(62)]);
    assert.equal(
      await scalar("select count(*) from teste_movimentos"),
      2,
      "Intermediação não movimenta estoque",
    );
    assert.equal(
      await scalar("select count(*) from contas_receber where pedido_id=$1", [id(62)]),
      3,
    );
    await db.query("update representantes set recebe_comissao=false where id=$1", [id(20)]);
    await novo(65);
    await db.query("select confirmar_pedido($1)", [id(65)]);
    assert.equal(
      await scalar("select count(*) from contas_receber where pedido_id=$1", [id(65)]),
      3,
      "Sócio sem comissão mantém o financeiro da venda",
    );
    assert.equal(
      await scalar("select count(*) from comissoes where pedido_id=$1", [id(65)]),
      0,
      "Sócio não gera comissão",
    );
    await novo(64);
    await db.query("update pedidos set parcelas=2 where id=$1", [id(64)]);
    await assert.rejects(
      () => db.query("select confirmar_pedido($1)", [id(64)]),
      /Quantidade de parcelas/,
    );
    assert.equal(
      await scalar("select count(*) from pedido_comissao_aprovacoes_305 where pedido_id=$1", [
        id(64),
      ]),
      0,
      "Falha desfaz aprovação preliminar",
    );
    assert.equal(
      await scalar("select count(*) from contas_receber where pedido_id=$1", [id(64)]),
      0,
    );
    assert.equal(await scalar("select status from pedidos where id=$1", [id(64)]), "rascunho");
    assert.equal(await scalar("select count(*) from movimentos_financeiros"), 0);
    await db.exec("set role authenticated");
    await assert.rejects(
      () => db.query("select fixar_aprovacao_confirmacao_306($1)", [id(64)]),
      /permission denied/,
    );
    await assert.rejects(
      () => db.query("update pedido_datas_originais_306 set data_original=current_date"),
      /permission denied/,
    );
    await db.exec("reset role");
    console.log(
      "OK: original preservada, aprovação como base das parcelas, 30/60/90 e centavos corretos, confirmação direta/intermediação, idempotência e rollback sem alterar títulos antigos.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.stack, e.internalQuery ?? "");
  process.exit(1);
});
