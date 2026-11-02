// PGlite: competência por aprovação, virada do mês, fuso, reabertura e escopo.
const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  criar = require("./fixtures/banco-relatorios-302.cjs");
(async () => {
  const db = await criar();
  const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
  const scalar = async (q, a = []) => Object.values((await db.query(q, a)).rows[0])[0];
  try {
    for (const d of JSON.parse(
      fs.readFileSync("scripts/fixtures/comissoes-retomada-motores-302.json", "utf8"),
    ))
      await db.exec(d);
    for (const d of JSON.parse(
      fs.readFileSync("scripts/fixtures/calculo-comissao-303.json", "utf8"),
    ))
      await db.exec(d);
    await db.exec(fs.readFileSync("db/fase302_comissoes_aprovadas_data_retomada.sql", "utf8"));
    await db.exec(fs.readFileSync("db/fase304_representante_sem_comissao.sql", "utf8"));
    await db.exec(
      `alter table comissoes alter column id set default gen_random_uuid();insert into profiles(id,ativo) values('${id(1)}',true);insert into representantes(id,nome,comissao_percentual) values('${id(20)}','Vendedor',5);insert into centros(id,nome) values('${id(10)}','Loja'),('${id(11)}','Outra');insert into clientes(id,razao_social) values('${id(21)}','Cliente');`,
    );
    for (const n of [30, 31, 32, 33]) {
      await db.query(
        `insert into pedidos(id,numero,tipo_documento,status,representante_id,cliente_id,centro_id,total_itens,total_liquido,desconto_valor,comissao_percentual,comissao_valor,data_pedido,ciclo_reabertura_289,modalidade_venda) values($1,$2,'pedido','confirmado',$3,$4,$5,100,100,0,5,5,'2026-10-31',$6,'estoque')`,
        [id(n), n, id(20), id(21), n === 33 ? id(11) : id(10), n === 32 ? 1 : 0],
      );
      await db.query(
        `insert into comissoes(id,pedido_id,representante_id,centro_id,base_calculo,percentual,valor,status) select gen_random_uuid(),id,representante_id,centro_id,100,5,5,case when numero=31 then 'paga' else 'prevista' end from pedidos where id=$1`,
        [id(n)],
      );
    }
    const hist = async (n, anterior, novo, em) =>
      db.query(
        `insert into pedido_status_historico(id,pedido_id,status_anterior,status_novo,created_at) values(gen_random_uuid(),$1,$2,$3,$4)`,
        [id(n), anterior, novo, em],
      );
    await hist(30, "rascunho", "confirmado", "2026-11-02T15:00:00Z");
    await hist(31, "rascunho", "confirmado", "2026-11-01T02:30:00Z");
    await hist(32, "rascunho", "confirmado", "2026-10-15T15:00:00Z");
    await hist(32, "cancelado", "rascunho", "2026-11-01T15:00:00Z");
    await hist(32, "aguardando_aprovacao", "aprovado", "2026-11-02T15:00:00Z");
    await hist(33, "rascunho", "confirmado", "2026-11-02T15:00:00Z");
    const before = await scalar("select jsonb_agg(to_jsonb(c) order by id) from comissoes c");
    const m = fs.readFileSync("db/fase305_competencia_comissao_aprovacao.sql", "utf8");
    await db.exec(m);
    await db.exec(m);
    assert.deepEqual(
      await scalar("select jsonb_agg(to_jsonb(c) order by id) from comissoes c"),
      before,
      "Valores e pagamentos existentes preservados",
    );
    assert.equal(await scalar("select data_comissao_305($1)::text", [id(30)]), "2026-11-02");
    assert.equal(
      await scalar("select data_comissao_305($1)::text", [id(31)]),
      "2026-10-31",
      "Conversão para São Paulo antes de escolher mês",
    );
    assert.equal(
      await scalar("select data_comissao_305($1)::text", [id(32)]),
      "2026-11-02",
      "Último ciclo usa nova aprovação",
    );
    assert.equal(
      await scalar("select mes from vw_comissoes_detalhe where pedido_id=$1", [id(30)]),
      "2026-11",
    );
    assert.equal(
      await scalar("select mes from vw_comissoes_detalhe_mod_300 where pedido_id=$1", [id(30)]),
      "2026-11",
    );
    assert.equal(
      await scalar("select data_pedido::text from vw_comissoes_detalhe where pedido_id=$1", [
        id(30),
      ]),
      "2026-10-31",
      "Data comercial preservada",
    );
    assert.equal(
      (await scalar("select resumo_comissoes_loja_295($1)", [id(10)])).find(
        (x) => x.mes === "2026-11",
      ).realizado,
      200,
    );
    assert.equal(
      (await scalar("select resumo_comissoes_loja_295_mod_300($1)", [id(10)])).find(
        (x) => x.mes === "2026-11",
      ).realizado,
      200,
    );
    await db.exec(
      `create trigger trg_apurar after insert or update of status,representante_id,total_itens,desconto_valor,comissao_percentual on pedidos for each row execute function trg_apurar_comissao_pedido();insert into pedidos(id,numero,tipo_documento,status,representante_id,cliente_id,centro_id,total_itens,total_liquido,desconto_valor,comissao_valor,comissao_percentual,data_pedido,ciclo_reabertura_289) values('${id(40)}',40,'pedido','rascunho','${id(20)}','${id(21)}','${id(10)}',100,100,0,5,5,date_trunc('month',now() at time zone 'America/Sao_Paulo')::date-1,0)`,
    );
    assert.equal(
      await scalar("select count(*) from pedido_comissao_aprovacoes_305 where pedido_id=$1", [
        id(40),
      ]),
      0,
    );
    await db.query(`update pedidos set status='aprovado' where id=$1`, [id(40)]);
    const stamp = await scalar(
      "select aprovada_em::text from pedido_comissao_aprovacoes_305 where pedido_id=$1",
      [id(40)],
    );
    const hoje = await scalar("select (now() at time zone 'America/Sao_Paulo')::date::text");
    assert.equal(
      await scalar("select data_competencia::text from vw_comissoes_detalhe where pedido_id=$1", [
        id(40),
      ]),
      hoje,
    );
    await db.query(`update pedidos set status='entregue' where id=$1`, [id(40)]);
    assert.equal(
      await scalar(
        "select aprovada_em::text from pedido_comissao_aprovacoes_305 where pedido_id=$1",
        [id(40)],
      ),
      stamp,
      "Entrega não muda aprovação",
    );
    await db.query(`update pedidos set status='rascunho',ciclo_reabertura_289=1 where id=$1`, [
      id(40),
    ]);
    await db.query(`update pedidos set status='aprovado' where id=$1`, [id(40)]);
    assert.equal(
      await scalar("select count(*) from pedido_comissao_aprovacoes_305 where pedido_id=$1", [
        id(40),
      ]),
      2,
    );
    await db.exec(
      `alter table pedidos enable row level security;create policy pedidos_escopo_teste on pedidos for select to authenticated using(usuario_pode_acessar_centro(centro_id));set role authenticated;`,
    );
    assert.equal(await scalar("select data_comissao_305($1)", [id(33)]), null);
    await assert.rejects(
      () =>
        db.query(`insert into pedido_comissao_aprovacoes_305 values($1,999,now(),'aprovacao')`, [
          id(40),
        ]),
      /permission denied/,
    );
    await db.exec("reset role");
    assert.equal(await scalar("select count(*) from movimentos_financeiros"), 0);
    console.log(
      "OK: aprovação define mês, data do pedido preservada, histórico real por ciclo, fuso de São Paulo, loja/modalidade e pagamentos preservados.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.stack, e.internalQuery ?? "");
  process.exit(1);
});
