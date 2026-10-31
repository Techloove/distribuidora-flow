// PGlite: contratos e motores reais em banco descartável, sem integrações financeiras.
const { PGlite } = require("@electric-sql/pglite"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql as $$select '00000000-0000-4000-8000-000000000001'::uuid$$;
 create function usuario_ativo() returns boolean language sql as $$select true$$;
 create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select true$$;
 create function escopo_representante() returns boolean language sql as $$select false$$;
 create function documento_na_minha_carteira(text,uuid) returns boolean language sql as $$select true$$;
 create function pode_rotina(text) returns boolean language sql as $$select true$$;
 create function norm_cidade(text) returns text language sql immutable as $$select lower(coalesce($1,''))$$;
 create function norm_txt(text) returns text language sql immutable as $$select lower(coalesce($1,''))$$;
 create function vencimento_util(date) returns date language sql as $$select $1$$;
 create function can_manage(uuid) returns boolean language sql as $$select true$$;
 create function can_operate(uuid) returns boolean language sql as $$select true$$;
 create type app_role as enum('admin','gestor','financeiro','comercial','representante','estoque','expedicao');
 create function has_role(uuid,app_role) returns boolean language sql as $$select true$$;`);
    await db.exec(fs.readFileSync("scripts/fixtures/modalidade-contratos-300.sql", "utf8"));
    const base = JSON.parse(
      fs.readFileSync("scripts/fixtures/modalidade-motores-300.json", "utf8"),
    );
    // Funções não alteradas por esta entrega, necessárias às visões reais.
    const pending = [
      ...base.rpcs.map((d, i) => ["rpc_" + i, d]),
      ...base.helpers.map((d, i) => ["helper_" + i, d]),
      ...Object.entries(base.views).map(([n, d]) => [
        n,
        `create view public.${n} with(security_invoker=true) as ${d}`,
      ]),
    ];
    while (pending.length) {
      let ok = 0,
        last;
      for (let i = pending.length - 1; i >= 0; i--) {
        const [n, d] = pending[i];
        try {
          await db.exec(d);
          pending.splice(i, 1);
          ok++;
        } catch (e) {
          last = { n, message: e.message };
        }
      }
      if (!ok) throw Error("Dependência ausente: " + JSON.stringify(last));
    }

    await db.exec(
      "grant usage on schema public to authenticated;grant select on all tables in schema public to authenticated;",
    );
    const migration = fs.readFileSync("db/fase300_filtro_modalidade_analitico.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const scalar = async (q, p = []) => Object.values((await db.query(q, p)).rows[0])[0];
    await db.exec(`insert into centros(id,nome,ativo) values('${id(10)}','Cimento',true),('${id(11)}','Outra',true);
insert into clientes(id,razao_social,limite_credito,status,centro_id) values('${id(20)}','Cliente teste',5000,'ativo','${id(10)}');
insert into produtos(id,codigo,descricao,unidade,peso_kg,custo_medio,preco_custo,ultimo_custo,ativo,estoque_atual,estoque_minimo) values('${id(25)}','1','Cimento','SC',50,20,20,20,true,100,0);
insert into formas_pagamento(id,nome,ativo) values('${id(26)}','Prazo',true);
insert into pedidos(id,numero,cliente_id,centro_id,data_pedido,status,tipo_documento,modalidade_venda,total_liquido,total_itens,comissao_valor,custo_frete,tributos_estimados,despesas_variaveis,desconto_valor,frete_valor,forma_pagamento_id) values
('${id(30)}',30,'${id(20)}','${id(10)}',current_date,'confirmado','pedido','estoque',100,100,5,0,0,0,0,0,'${id(26)}'),
('${id(31)}',31,'${id(20)}','${id(10)}',current_date,'confirmado','pedido','intermediacao',200,200,10,0,0,0,0,0,'${id(26)}');
insert into pedido_itens(id,pedido_id,produto_id,quantidade,preco_unitario,desconto_percentual,total,custo_unitario_base) values
('${id(35)}','${id(30)}','${id(25)}',2,50,0,100,20),('${id(36)}','${id(31)}','${id(25)}',2,100,0,200,80);
insert into contas_receber(id,cliente_id,pedido_id,centro_id,valor,valor_pago,juros,multa,acrescimo,desconto,status,vencimento) values
('${id(40)}','${id(20)}','${id(30)}','${id(10)}',100,20,0,0,0,0,'parcial',current_date-1),
('${id(41)}','${id(20)}','${id(31)}','${id(10)}',200,50,0,0,0,0,'parcial',current_date-1),
('${id(42)}','${id(20)}',null,'${id(10)}',30,0,0,0,0,0,'aberto',current_date-1);
insert into boletos(id,conta_receber_id,pedido_id,cliente_id,centro_id,valor,status) values
('${id(45)}','${id(40)}','${id(30)}','${id(20)}','${id(10)}',100,'registrado'),
('${id(46)}','${id(41)}','${id(31)}','${id(20)}','${id(10)}',200,'registrado'),
('${id(47)}','${id(42)}',null,'${id(20)}','${id(10)}',30,'registrado');
insert into contas_financeiras(id,nome,saldo_inicial,centro_id,ativo) values('${id(50)}','Banco teste',1000,'${id(10)}',true);
insert into movimentos_financeiros(id,conta_id,conta_receber_id,centro_id,data,tipo,origem,valor,status) values
('${id(51)}','${id(50)}','${id(40)}','${id(10)}',current_date,'entrada','recebimento',20,'ativo'),
('${id(52)}','${id(50)}','${id(41)}','${id(10)}',current_date,'entrada','recebimento',50,'ativo'),
('${id(53)}','${id(50)}',null,'${id(10)}',current_date,'entrada','outro',7,'ativo');
insert into cargas(id,numero,centro_id,status,valor_total,peso_kg,volumes) values('${id(60)}',60,'${id(10)}','montagem',300,200,5);
insert into carga_pedidos(id,carga_id,pedido_id,volumes) values('${id(61)}','${id(60)}','${id(30)}',2),('${id(62)}','${id(60)}','${id(31)}',3);`);
    await db.exec(`insert into comissoes(id,pedido_id,centro_id,valor,status) values('${id(90)}','${id(30)}','${id(10)}',5,'liberada'),('${id(91)}','${id(31)}','${id(10)}',10,'liberada');
 insert into contas_pagar(id,centro_id,valor,valor_pago,juros,multa,acrescimo,desconto,status) values('${id(70)}','${id(10)}',10,0,0,0,0,0,'aberto'),('${id(71)}','${id(10)}',20,0,0,0,0,0,'aberto'),('${id(72)}','${id(10)}',30,0,0,0,0,0,'aberto'),('${id(73)}','${id(10)}',40,0,0,0,0,0,'aberto');
 insert into comissao_pagamentos(id,conta_pagar_id) values('${id(75)}','${id(70)}'),('${id(76)}','${id(72)}');
 insert into comissao_pagamento_itens(id,pagamento_id,comissao_id,valor) values('${id(77)}','${id(75)}','${id(90)}',5),('${id(78)}','${id(76)}','${id(90)}',5),('${id(79)}','${id(76)}','${id(91)}',10);
 insert into comissao_parcelas(id,comissao_id,conta_pagar_id,valor) values('${id(74)}','${id(91)}','${id(71)}',20);`);
    const snapshot = await scalar("select jsonb_agg(to_jsonb(p) order by id) from pedidos p");
    const modo = async (m) =>
      db.query("select set_config('request.headers',$1,false)", [
        JSON.stringify({ "x-client-info": "caparao-modalidade/" + m }),
      ]);
    for (const [m, total, saldo, cpv, recebido] of [
      ["todos", 300, 260, 200, 70],
      ["estoque", 100, 80, 40, 20],
      ["intermediacao", 200, 150, 160, 50],
    ]) {
      await modo(m);
      assert.equal(
        Number(await scalar("select sum(total_liquido) from pedidos_mod_300")),
        total,
        m + " vendas",
      );
      assert.equal(
        Number(await scalar("select sum(saldo) from vw_titulos_receber_mod_300")),
        saldo,
        m + " aberto",
      );
      assert.equal(
        Number(await scalar("select sum(custo) from vw_cpv_mod_300")),
        cpv,
        m + " custo congelado",
      );
      assert.equal(
        Number(await scalar("select valor_total from vw_cargas_mod_300")),
        total,
        m + " carga mista soma somente o recorte",
      );
      const d = await scalar("select dashboard_financeiro_mod_300($1)", [id(10)]);
      assert.equal(Number(d.faturamento_mes), total);
      assert.equal(Number(d.a_receber), saldo);
      assert.equal(
        Number(d.a_pagar),
        m === "todos" ? 100 : m === "estoque" ? 10 : 20,
        "Títulos gerais e mistos não atribuídos",
      );
      assert.equal(Number(d.recebido_mes), recebido);
      const comum = await scalar("select dashboard_financeiro($1)", [id(10)]);
      assert.equal(
        Number(comum.faturamento_mes),
        300,
        "Motor original permanece consolidado mesmo sob filtro",
      );
      assert.equal(
        Number(await scalar("select count(*) from boletos_mod_300")),
        m === "todos" ? 3 : 1,
      );
      assert.equal(
        Number(await scalar("select saldo_atual from vw_conta_saldo_mod_300")),
        m === "todos" ? 1077 : recebido,
        "Saldo inicial só em Todos",
      );
    }
    await modo("estoque");
    assert.equal(
      Number(await scalar("select valor_total from cargas where id=$1", [id(60)])),
      300,
      "Operação da carga permanece íntegra",
    );
    assert.deepEqual(
      await scalar("select jsonb_agg(to_jsonb(p) order by id) from pedidos p"),
      snapshot,
    );
    // O contrato de colunas é preservado, inclusive aliases de contagens como "pedidos".
    const nomes = {
      pedidos: "pedidos_mod_300",
      contas_financeiras: "contas_financeiras_mod_300",
      cargas: "cargas_mod_300",
      vw_resultado_estimado_215: "vw_resultado_estimado_215_mod_300",
      vw_rota_resultado: "vw_rota_resultado_mod_300",
      vw_dre_base: "vw_dre_base_mod_300",
      vw_comissao_proporcional_217: "vw_comissao_proporcional_217_mod_300",
      vw_lead_rota: "vw_lead_rota_mod_300",
      vw_lead_pedidos: "vw_lead_pedidos_mod_300",
      vw_lead_produtos_cliente: "vw_lead_produtos_cliente_mod_300",
      vw_boletos_pendentes: "vw_boletos_pendentes_mod_300",
      vw_titulos_receber: "vw_titulos_receber_mod_300",
      vw_titulos_pagar: "vw_titulos_pagar_mod_300",
      vw_fluxo_realizado: "vw_fluxo_realizado_mod_300",
      vw_rentabilidade_item: "vw_rentabilidade_item_mod_300",
      vw_fluxo_previsto: "vw_fluxo_previsto_mod_300",
      vw_despesas_categoria: "vw_despesas_categoria_mod_300",
      vw_carga_pedidos: "vw_carga_pedidos_mod_300",
      vw_comissoes_resumo: "vw_comissoes_resumo_mod_300",
      vw_cpv: "vw_cpv_mod_300",
      vw_cliente_titulos: "vw_cliente_titulos_mod_300",
      vw_vendas_mensal: "vw_vendas_mensal_mod_300",
      vw_top_produtos: "vw_top_produtos_mod_300",
      vw_top_clientes: "vw_top_clientes_mod_300",
      vw_comissoes_representante: "vw_comissoes_representante_mod_300",
      vw_fluxo_caixa: "vw_fluxo_caixa_mod_300",
      vw_metas_acompanhamento: "vw_metas_acompanhamento_mod_300",
      vw_margem_pedido_209: "vw_margem_pedido_209_mod_300",
      vw_cliente_historico: "vw_cliente_historico_mod_300",
      vw_clientes_inativos: "vw_clientes_inativos_mod_300",
      vw_carteira_comercial_209: "vw_carteira_comercial_209_mod_300",
      vw_lead_rota_metas: "vw_lead_rota_metas_mod_300",
      vw_historico_cliente: "vw_historico_cliente_mod_300",
      vw_extrato_conta: "vw_extrato_conta_mod_300",
      vw_conta_saldo: "vw_conta_saldo_mod_300",
      vw_pedidos_para_carga: "vw_pedidos_para_carga_mod_300",
      vw_fluxo_operacional: "vw_fluxo_operacional_mod_300",
      vw_conciliacao_creditos_dev: "vw_conciliacao_creditos_dev_mod_300",
      vw_cargas: "vw_cargas_mod_300",
      vw_separacao: "vw_separacao_mod_300",
      vw_comissoes_detalhe: "vw_comissoes_detalhe_mod_300",
      vw_relatorio_vendas: "vw_relatorio_vendas_mod_300",
      vw_receita_vendas: "vw_receita_vendas_mod_300",
      vw_vendas_rota: "vw_vendas_rota_mod_300",
      vw_vendas_rota_cidade: "vw_vendas_rota_cidade_mod_300",
      vw_produtos_rota: "vw_produtos_rota_mod_300",
      vw_vendas_representante_rota: "vw_vendas_representante_rota_mod_300",
      vw_contas_receber_efetivas_299: "vw_contas_receber_efetivas_299_mod_300",
      vw_rentabilidade_pedido: "vw_rentabilidade_pedido_mod_300",
      vw_cobranca_clientes_209: "vw_cobranca_clientes_209_mod_300",
      vw_dre_mensal: "vw_dre_mensal_mod_300",
    };
    for (const [origem, destino] of Object.entries(nomes)) {
      const contrato = async (nome) =>
        db.query(
          "select attname,format_type(atttypid,atttypmod) tipo from pg_attribute where attrelid=('public.'||$1)::regclass and attnum>0 and not attisdropped order by attnum",
          [nome],
        );
      assert.deepEqual(
        (await contrato(destino)).rows,
        (await contrato(origem)).rows,
        "Contrato " + origem,
      );
    }
    await modo("invalido");
    await assert.rejects(() => db.exec("select * from pedidos_mod_300"), /inválido/);
    await modo("estoque");
    await db.exec(
      `alter table pedidos enable row level security;create policy escopo on pedidos for select to authenticated using(centro_id='${id(11)}');set role authenticated;`,
    );
    assert.equal(
      Number(await scalar("select count(*) from pedidos_mod_300")),
      0,
      "Visão mantém RLS original",
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(() => db.exec("select * from pedidos_mod_300"), /permission denied/);
    console.log(
      "OK: filtro em vendas, contas, boletos, custos, caixa, cargas mistas e indicadores; Todos conserva gerais; contratos/RLS e operações originais preservados; migração idempotente.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.message, e.internalQuery ?? "");
  process.exit(1);
});
