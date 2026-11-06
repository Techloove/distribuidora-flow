// Banco descartável: nenhum cliente ou cobrança real é criado.
const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create role authenticator;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table profiles(id uuid primary key,ativo boolean,nome text,email text);create table user_roles(user_id uuid,role text);
create table contas_receber(id uuid primary key,valor numeric);insert into contas_receber values('${id(20)}',500);
insert into profiles values('${id(1)}',true,'Dono','dono@example.test'),('${id(2)}',true,'Master','master@example.test'),('${id(3)}',true,'Vendedor','rep@example.test');
insert into user_roles values('${id(1)}','representante'),('${id(2)}','admin'),('${id(3)}','representante');`);
    await db.exec(fs.readFileSync("db/fase330_painel_saas_cliente_atual.sql", "utf8"));
    await db.exec(fs.readFileSync("db/fase331_servicos_saas.sql", "utf8"));
    const migration = fs.readFileSync("db/fase335_contrato_servicos_faturas_saas.sql", "utf8");
    await db.exec(migration);
    await db.exec(fs.readFileSync("db/fase340_saas_atualizacao_contrato_com_filtro.sql", "utf8"));
    await db.exec(fs.readFileSync("db/fase341_saas_reajuste_salario_minimo.sql", "utf8"));
    await db.exec(fs.readFileSync("db/fase342_saas_carencia_pre_pago.sql", "utf8"));
    await db.exec(migration);
    await db.exec(fs.readFileSync("db/fase340_saas_atualizacao_contrato_com_filtro.sql", "utf8"));
    await db.exec(fs.readFileSync("db/fase341_saas_reajuste_salario_minimo.sql", "utf8"));
    await db.exec(fs.readFileSync("db/fase342_saas_carencia_pre_pago.sql", "utf8"));
    const definicoes = (
      await db.query(
        "select pg_get_functiondef(oid) as fonte from pg_proc where pronamespace='public'::regnamespace and proname in ('saas_salvar_contrato_330','saas_salvar_servico_331','saas_salvar_grade_335','saas_registrar_pagamento_330')",
      )
    ).rows;
    assert.equal(definicoes.length, 4);
    for (const { fonte } of definicoes) {
      const updates = fonte.match(/update public\.saas_contrato_330 set [^;]+;/g);
      assert.equal(updates?.length, 1);
      assert.match(updates[0], /where unico=true;/);
    }
    await db.exec(`insert into saas_proprietarios_330 values('${id(1)}',now());`);
    const q = async (s, args) => (await db.query(s, args)).rows;
    const scalar = async (s, args) => Object.values((await q(s, args))[0])[0];
    const actor = async (n) =>
      db.exec(
        `reset role;select set_config('request.jwt.claim.sub','${id(n)}',false);select set_config('request.jwt.claims','{"role":"authenticated"}',false);set role authenticated`,
      );
    await actor(1);
    let painel = await scalar("select saas_painel_330()");
    assert.equal(painel.parcelas.length, 0);
    assert.equal(painel.contrato.controle_ativo, false);
    const prever = (d) => scalar("select saas_prever_contrato_335($1)", [d]);
    const salvar = (d, rev) => scalar("select saas_salvar_grade_335($1,$2)", [d, rev]);
    const mensal = {
      id: id(10),
      descricao: "Assinatura",
      tipo: "mensalidade",
      periodicidade: "mensal",
      valor: 372.83,
      primeiro_vencimento: "2028-01-01",
      parcelas: 1,
      carencia_inicial_dias: 30,
      percentual_salario: 23,
      reajustes: [{ vigencia: "2028-03-01", salario_minimo: 2000 }],
    };
    const dados = {
      empresa: "Contrato de teste",
      master_id: id(2),
      inicio: "2028-01-01",
      fim: "2028-05-31",
      tolerancia: 5,
      aviso_dias: 7,
      controle_ativo: false,
      servicos: [
        mensal,
        {
          id: id(11),
          descricao: "Setup",
          tipo: "implantacao",
          periodicidade: "parcelado",
          valor: 4900,
          primeiro_vencimento: "2028-01-01",
          parcelas: 5,
        },
      ],
    };
    const previa = await prever(dados);
    const mensalidades = previa.parcelas.filter((p) => p.tipo === "mensalidade");
    assert.deepEqual(
      mensalidades.map((p) => p.vencimento),
      ["2028-01-31", "2028-02-29", "2028-03-31", "2028-04-30", "2028-05-31"],
    );
    assert.equal(Number(mensalidades[0].valor), 372.83);
    assert.equal(Number(mensalidades[2].valor), 460);
    const setup = previa.parcelas.filter((p) => p.tipo === "implantacao");
    assert.equal(setup.length, 5);
    assert(setup.every((p) => Number(p.valor) === 980));
    assert.equal(setup[0].vencimento, "2028-01-01");
    painel = await salvar(dados, 0);
    const salvo = painel.itens_contrato.find((s) => s.id === id(10));
    assert.equal(salvo.carencia_inicial_dias, 30);
    assert.equal(salvo.primeiro_vencimento, "2028-01-31");
    const primeira = painel.parcelas.find((p) => p.chave === `contrato:${id(10)}:1`),
      segunda = painel.parcelas.find((p) => p.chave === `contrato:${id(10)}:2`);
    assert.equal(primeira.periodo_inicio, "2028-01-31");
    assert.equal(primeira.periodo_fim, "2028-02-28");
    assert.equal(segunda.periodo_inicio, "2028-02-29");
    assert.equal(segunda.periodo_fim, "2028-03-30");
    const velho = structuredClone(dados);
    delete velho.servicos[0].carencia_inicial_dias;
    assert.equal(
      (await prever(velho)).parcelas.find((p) => p.tipo === "mensalidade").vencimento,
      "2028-01-31",
    );
    painel = await salvar(velho, painel.contrato.revisao);
    assert.equal(painel.itens_contrato.find((s) => s.id === id(10)).carencia_inicial_dias, 30);
    const semCarencia = structuredClone(dados);
    semCarencia.servicos[0].carencia_inicial_dias = 0;
    assert.equal(
      (await prever(semCarencia)).parcelas.find((p) => p.tipo === "mensalidade").vencimento,
      "2028-01-01",
    );
    const pendente = structuredClone(dados);
    pendente.servicos[0].reajustes[0].salario_minimo = null;
    const parcial = await prever(pendente);
    assert.equal(parcial.parcelas.filter((p) => p.tipo === "mensalidade").length, 2);
    assert.deepEqual(
      parcial.parcelas.filter((p) => p.tipo === "implantacao"),
      setup,
    );
    for (const dias of [-1, 366, 1.5]) {
      const invalido = structuredClone(dados);
      invalido.servicos[0].carencia_inicial_dias = dias;
      await assert.rejects(() => prever(invalido));
    }
    const outro = structuredClone(dados);
    outro.servicos[1].carencia_inicial_dias = 30;
    await assert.rejects(() => prever(outro), /assinatura mensal/);
    await actor(2);
    const master = await scalar("select saas_painel_330()");
    assert.equal(
      master.parcelas.find((p) => p.chave === primeira.chave).periodo_inicio,
      "2028-01-31",
    );
    await assert.rejects(
      () => q("select saas_preparar_carencia_342($1,$2)", [dados.servicos, dados.inicio]),
      /permission denied/,
    );
    await actor(1);
    painel = await scalar(
      "select saas_registrar_pagamento_330($1,'pago',current_date,'Pagamento confirmado de teste',$2)",
      [primeira.chave, id(100)],
    );
    const alteracao = structuredClone(dados);
    alteracao.servicos[0].carencia_inicial_dias = 29;
    await assert.rejects(() => salvar(alteracao, painel.contrato.revisao), /histórico financeiro/);
    await db.exec("reset role");
    const antes = await scalar(
      "select md5(jsonb_agg(to_jsonb(g) order by chave)::text) from saas_grade_335 g",
    );
    await db.exec(fs.readFileSync("db/fase342_saas_carencia_pre_pago.sql", "utf8"));
    assert.equal(
      await scalar("select md5(jsonb_agg(to_jsonb(g) order by chave)::text) from saas_grade_335 g"),
      antes,
    );
    console.log(
      "Carência342 OK: 30 dias gratuitos, primeiro vencimento calculado no servidor, ciclos pré-pagos sem lacuna no mês curto/bissexto, setup independente, reajuste por vigência, salário a definir, carência zero, persistência, formulários antigos, permissões e histórico preservados.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
