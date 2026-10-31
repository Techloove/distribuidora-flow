// PGlite: apuração somente após aprovação e retomada sem alterar valores/estoque/financeiro.
const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  criarBanco = require("./fixtures/banco-relatorios-302.cjs");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = await criarBanco();
  const scalar = async (q, p = []) => Object.values((await db.query(q, p)).rows[0])[0];
  try {
    for (const d of JSON.parse(
      fs.readFileSync("scripts/fixtures/comissoes-retomada-motores-302.json", "utf8"),
    ))
      await db.exec(d);
    await db.exec(`alter table comissoes alter column id set default gen_random_uuid();alter table auditoria alter column id set default gen_random_uuid();
insert into profiles(id,ativo) values('${id(1)}',true);
insert into centros(id,nome,ativo) values('${id(10)}','Cimento',true),('${id(11)}','Outra',true);
insert into representantes(id,nome,ativo,profile_id) values('${id(20)}','Representante teste',true,'${id(1)}');
insert into clientes(id,razao_social) values('${id(21)}','Cliente teste');
insert into produtos(id,descricao,custo_medio,ativo) values('${id(22)}','Produto teste',10,true);
insert into parametros(chave,valor) values('comissao_fato_gerador','venda');
insert into pedidos(id,numero,tipo_documento,status,centro_id,representante_id,cliente_id,data_pedido,total_itens,total_liquido,desconto_valor,comissao_valor,comissao_percentual,modalidade_venda,ciclo_reabertura_289) values
('${id(30)}',30,'pedido','rascunho','${id(10)}','${id(20)}','${id(21)}',(now() at time zone 'America/Sao_Paulo')::date-1,100,100,0,5,5,'estoque',0),
('${id(31)}',31,'orcamento','rascunho','${id(10)}','${id(20)}','${id(21)}',(now() at time zone 'America/Sao_Paulo')::date-1,100,100,0,5,5,'estoque',0),
('${id(32)}',32,'pedido','aguardando_aprovacao','${id(10)}','${id(20)}','${id(21)}',(now() at time zone 'America/Sao_Paulo')::date-1,100,100,0,5,5,'estoque',0),
('${id(33)}',33,'pedido','aprovado','${id(10)}','${id(20)}','${id(21)}',(now() at time zone 'America/Sao_Paulo')::date-1,100,100,0,5,5,'estoque',0),
('${id(34)}',34,'pedido','confirmado','${id(10)}','${id(20)}','${id(21)}',(now() at time zone 'America/Sao_Paulo')::date-1,100,100,0,5,5,'intermediacao',0),
('${id(35)}',35,'pedido','cancelado','${id(10)}','${id(20)}','${id(21)}',(now() at time zone 'America/Sao_Paulo')::date-1,100,100,0,5,5,'estoque',0),
('${id(36)}',36,'pedido','entregue','${id(10)}','${id(20)}','${id(21)}',(now() at time zone 'America/Sao_Paulo')::date-1,100,100,0,5,5,'estoque',0);
insert into comissoes(id,pedido_id,centro_id,representante_id,base_calculo,percentual,valor,status) select ('00000000-0000-4000-8000-'||lpad((numero+100)::text,12,'0'))::uuid,id,centro_id,representante_id,100,5,5,case when numero=35 then 'cancelada' when numero=36 then 'paga' else 'prevista' end from pedidos;`);
    const antes = await scalar("select jsonb_agg(to_jsonb(c) order by id) from comissoes c");
    const migracao = fs.readFileSync("db/fase302_comissoes_aprovadas_data_retomada.sql", "utf8");
    await db.exec(migracao);
    await db.exec(migracao);
    assert.deepEqual(
      await scalar("select jsonb_agg(to_jsonb(c) order by id) from comissoes c"),
      antes,
      "Implantação preserva comissões e histórico",
    );
    assert.equal(
      Number(
        await scalar(
          "select count(*) from vw_comissoes_detalhe where pedido_status in('rascunho','digitacao','aguardando_aprovacao')",
        ),
      ),
      0,
    );
    assert.equal(
      Number(await scalar("select count(*) from vw_comissoes_detalhe")),
      4,
      "Aprovado e adiante, com histórico cancelado",
    );
    const resumo = await scalar("select resumo_comissoes_loja_295($1)", [id(10)]);
    assert.equal(
      resumo.reduce((a, r) => a + Number(r.realizado), 0),
      300,
      "Apuração mensal não inclui orçamento nem análise",
    );
    await db.exec(
      "create trigger regra_comissao_209 before update on comissoes for each row execute function regra_comissao_209();create trigger trg_apurar after insert or update of status,representante_id,total_itens,desconto_valor,comissao_percentual on pedidos for each row execute function trg_apurar_comissao_pedido();",
    );
    for (const p of [30, 31, 32]) {
      await db.query("select apurar_comissao_pedido($1)", [id(p)]);
      await assert.rejects(
        () => db.query("select liberar_comissoes($1)", [[id(p + 100)]]),
        /aprovados/,
      );
      await assert.rejects(
        () => db.query("select pagar_comissoes($1,$2,current_date)", [id(20), [id(p + 100)]]),
        /aprovados/,
      );
      await assert.rejects(
        () =>
          db.query("select agendar_comissao_217($1,1,current_date,$2)", [id(p + 100), id(200 + p)]),
        /aprovados/,
      );
    }
    await db.exec(
      `insert into pedidos(id,numero,tipo_documento,status,centro_id,representante_id,total_itens,total_liquido,desconto_valor,comissao_valor,comissao_percentual,modalidade_venda,data_pedido,ciclo_reabertura_289) values('${id(40)}',40,'pedido','rascunho','${id(10)}','${id(20)}',100,100,0,5,5,'estoque',(now() at time zone 'America/Sao_Paulo')::date-1,0)`,
    );
    await db.query("select apurar_comissao_pedido($1)", [id(40)]);
    assert.equal(
      Number(await scalar("select count(*) from comissoes where pedido_id=$1", [id(40)])),
      0,
    );
    await db.exec(`update pedidos set status='aprovado' where id='${id(40)}'`);
    await db.query("select apurar_comissao_pedido($1)", [id(40)]);
    assert.equal(
      Number(await scalar("select count(*) from comissoes where pedido_id=$1", [id(40)])),
      1,
    );
    await db.exec("update parametros set valor='recebimento' where chave='comissao_fato_gerador'");
    await assert.rejects(
      () => db.query("select liberar_comissoes($1)", [[id(133)]]),
      /recebimento integral/,
    );
    await db.exec("update parametros set valor='venda' where chave='comissao_fato_gerador'");
    await db.query("select liberar_comissoes($1)", [[id(133)]]);
    assert.equal(await scalar("select status from comissoes where id=$1", [id(133)]), "liberada");
    await db.query(
      "select set_config('request.headers','{\"x-client-info\":\"caparao-modalidade/intermediacao\"}',false)",
    );
    assert.equal(Number(await scalar("select count(*) from vw_comissoes_detalhe_mod_300")), 1);
    assert.equal(
      Number(
        await scalar(
          "select count(*) from vw_comissoes_detalhe_mod_300 where pedido_status='rascunho'",
        ),
      ),
      0,
    );
    // Data: escolha explícita atualiza só o rascunho e não recalcula seus itens.
    await db.exec(`update pedidos set data_pedido=date_trunc('month',now() at time zone 'America/Sao_Paulo')::date-1 where id='${id(30)}';create trigger aa_modalidade_296 before insert or update on pedidos for each row execute function modalidade_pedido_296();
insert into pedido_itens(id,pedido_id,produto_id,quantidade,preco_unitario,total,custo_unitario_base,custo_fabrica_saca,frete_saca,margem_saca) values('${id(80)}','${id(30)}','${id(22)}',2,50,100,30,null,null,null);
insert into pedidos(id,numero,tipo_documento,status,centro_id,modalidade_venda,data_pedido,ciclo_reabertura_289,total_liquido) values('${id(41)}',41,'pedido','rascunho','${id(10)}','intermediacao',date_trunc('month',now() at time zone 'America/Sao_Paulo')::date-1,0,100);
insert into pedido_itens(id,pedido_id,produto_id,quantidade,preco_unitario,total,custo_unitario_base,custo_fabrica_saca,frete_saca,margem_saca) values('${id(81)}','${id(41)}','${id(22)}',2,50,100,30,25,5,20);`);
    const itens = await scalar("select jsonb_agg(to_jsonb(i) order by id) from pedido_itens i");
    const ontem = await scalar("select data_pedido::text from pedidos where id=$1", [id(30)]),
      hoje = await scalar("select (now() at time zone 'America/Sao_Paulo')::date::text");
    await assert.rejects(
      () => db.query("select retomar_data_pedido_302($1,$2,$3)", [id(33), ontem, hoje]),
      /digitação/,
    );
    await assert.rejects(
      () => db.query("select retomar_data_pedido_302($1,$2,$3)", [id(31), ontem, hoje]),
      /digitação/,
    );
    await assert.rejects(
      () =>
        db.query(
          "select retomar_data_pedido_302($1,(now() at time zone 'America/Sao_Paulo')::date-2,$2)",
          [id(30), hoje],
        ),
      /mudou/,
    );
    await db.query("select retomar_data_pedido_302($1,$2,$3)", [id(30), ontem, hoje]);
    assert.equal(await scalar("select data_pedido::text from pedidos where id=$1", [id(30)]), hoje);
    await assert.rejects(
      () => db.query("update pedidos set data_pedido=$1 where id=$2", [hoje, id(41)]),
      /Remova/,
    );
    await db.query("select retomar_data_pedido_302($1,$2,$3)", [id(41), ontem, hoje]);
    assert.deepEqual(
      await scalar("select jsonb_agg(to_jsonb(i) order by id) from pedido_itens i"),
      itens,
      "Custos e preços preservados nas duas modalidades",
    );
    assert.equal(Number(await scalar("select count(*) from pedido_data_contexto_302")), 0);
    assert.equal(Number(await scalar("select count(*) from contas_receber")), 0);
    assert.equal(Number(await scalar("select count(*) from contas_pagar")), 0);
    assert.equal(Number(await scalar("select count(*) from movimentos_financeiros")), 0);
    await db.query("update pedidos set status='aprovado' where id=$1", [id(30)]);
    assert.equal(
      await scalar("select mes from vw_comissoes_detalhe where pedido_id=$1", [id(30)]),
      hoje.slice(0, 7),
      "Competência acompanha a data escolhida antes da aprovação",
    );
    await db.exec("set test.ativo='false'");
    await assert.rejects(
      () => db.query("select retomar_data_pedido_302($1,$2,$3)", [id(30), hoje, hoje]),
      /sem acesso/,
    );
    console.log(
      "OK: digitação/orçamento/análise sem comissão válida, liberação/pagamento protegidos; data exige escolha, preserva preços e não cria financeiro.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.message, e.internalQuery ?? "");
  process.exit(1);
});
