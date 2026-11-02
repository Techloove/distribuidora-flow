// PGlite: correção histórica delimitada, idempotente, sem pagamentos ou reprecificação.
const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  criar = require("./fixtures/banco-relatorios-302.cjs");
(async () => {
  const db = await criar();
  try {
    for (const d of JSON.parse(
      fs.readFileSync("scripts/fixtures/comissoes-retomada-motores-302.json", "utf8"),
    ))
      await db.exec(d);
    await db.exec(fs.readFileSync("db/fase302_comissoes_aprovadas_data_retomada.sql", "utf8"));
    await db.exec(
      `alter table auditoria alter column id set default gen_random_uuid();insert into profiles(id,email,ativo) values('00000000-0000-4000-8000-000000000001','techloove1@gmail.com',true);insert into user_roles(id,user_id,role) values(gen_random_uuid(),'00000000-0000-4000-8000-000000000001','admin');insert into representantes(id,nome,comissao_percentual) values('92585c89-d6d4-4847-be4f-6760686b8fdc','KENEDE',0),('206d5874-25fb-447f-ba94-e7d7f8f95d2e','GUSTAVO',5);insert into centros(id,nome) values('00000000-0000-4000-8000-000000000010','Ferragens');`,
    );
    for (const n of [13, 23, 25, 28, 33, 34]) {
      const r =
        n === 13 ? "92585c89-d6d4-4847-be4f-6760686b8fdc" : "206d5874-25fb-447f-ba94-e7d7f8f95d2e";
      await db.query(
        `insert into pedidos(id,numero,tipo_documento,status,representante_id,centro_id,total_itens,total_liquido,desconto_valor,comissao_percentual,comissao_valor) values(gen_random_uuid(),$1,'pedido','confirmado',$2,'00000000-0000-4000-8000-000000000010',100,100,0,2,2)`,
        [n, r],
      );
      await db.query(
        `insert into comissoes(id,pedido_id,representante_id,centro_id,status,valor,percentual,base_original,valor_original) select gen_random_uuid(),id,representante_id,centro_id,'prevista',2,2,100,2 from pedidos where numero=$1`,
        [n],
      );
    }
    const protecao = fs
      .readFileSync("db/fase239_configuracao_representantes_admin.sql", "utf8")
      .match(
        /create or replace function public.proteger_definicao_comissao_239[\s\S]+?end \$\$;/,
      )[0];
    await db.exec(protecao);
    await db.exec(
      "create trigger proteger_definicao_comissao_239 before insert or update on representantes for each row execute function proteger_definicao_comissao_239()",
    );
    await db.exec(
      `insert into clientes(id,razao_social) values('00000000-0000-4000-8000-000000000020','Cliente');insert into produtos(id,descricao,comissao_percentual) values('00000000-0000-4000-8000-000000000021','Produto 5%',5);update pedidos set cliente_id='00000000-0000-4000-8000-000000000020';insert into pedido_itens(id,pedido_id,produto_id,quantidade,total) select gen_random_uuid(),id,'00000000-0000-4000-8000-000000000021',10,100 from pedidos`,
    );
    const m = fs.readFileSync("db/fase303_correcao_comissoes_cinco_porcento.sql", "utf8");
    await db.exec(
      `update comissoes set status='paga' where pedido_id=(select id from pedidos where numero=13)`,
    );
    await assert.rejects(() => db.exec(m), /fora do estado/);
    await db.exec("rollback");
    await db.exec(
      `update comissoes set status='prevista' where pedido_id=(select id from pedidos where numero=13)`,
    );
    await db.exec(m);
    await db.exec(m);
    assert.equal(
      (
        await db.query(
          "select count(*) n from comissoes where valor=5 and valor_original=5 and percentual=5",
        )
      ).rows[0].n,
      6,
    );
    assert.equal(
      (await db.query("select count(*) n from auditoria where acao='correcao_comissao_303'"))
        .rows[0].n,
      7,
    );
    assert.equal(
      (await db.query("select comissao_percentual from representantes where nome='KENEDE'")).rows[0]
        .comissao_percentual,
      "5",
    );
    assert.equal((await db.query("select count(*) n from contas_pagar")).rows[0].n, 0);
    assert.equal((await db.query("select count(*) n from movimentos_financeiros")).rows[0].n, 0);
    assert.equal((await db.query("select sum(total_liquido) s from pedidos")).rows[0].s, "600");
    assert.ok(
      (await db.query("select comissao_definida_em from representantes where nome='KENEDE'"))
        .rows[0].comissao_definida_em,
    );
    for (const def of JSON.parse(
      fs.readFileSync("scripts/fixtures/calculo-comissao-303.json", "utf8"),
    ))
      await db.exec(def);
    assert.equal(
      (await db.query("select count(*) n from pedidos where calcular_comissao_itens_215(id)=5"))
        .rows[0].n,
      6,
      "Motor atual calcula 5% para todos os itens conferidos",
    );
    await db.exec("update produtos set comissao_percentual=8");
    assert.equal(
      (await db.query("select count(*) n from pedidos where calcular_comissao_itens_215(id)=8"))
        .rows[0].n,
      6,
      "Produto 8% prevalece sobre representante 5%",
    );
    await db.exec("update produtos set comissao_percentual=null");
    assert.equal(
      (await db.query("select count(*) n from pedidos where calcular_comissao_itens_215(id)=5"))
        .rows[0].n,
      6,
      "Sem percentual no produto usa cadastro do representante",
    );
    console.log(
      "OK: seis comissões corrigidas para 5%, cadastro confirmado, repetição sem duplicidade e comissão paga bloqueia a transação.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.message, e.internalQuery ?? "");
  process.exit(1);
});
