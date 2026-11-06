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
    await db.exec(fs.readFileSync("db/fase343_saas_responsaveis_avisos.sql", "utf8"));
    await db.exec(migration);
    await db.exec(fs.readFileSync("db/fase340_saas_atualizacao_contrato_com_filtro.sql", "utf8"));
    await db.exec(fs.readFileSync("db/fase341_saas_reajuste_salario_minimo.sql", "utf8"));
    await db.exec(fs.readFileSync("db/fase342_saas_carencia_pre_pago.sql", "utf8"));
    await db.exec(fs.readFileSync("db/fase343_saas_responsaveis_avisos.sql", "utf8"));
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
      primeiro_vencimento: "2028-11-05",
      parcelas: 1,
      percentual_salario: 23,
      reajustes: [{ vigencia: "2029-01-01", salario_minimo: null }],
    };
    const dados = {
      empresa: "Contrato teste",
      master_id: id(2),
      inicio: "2028-11-01",
      fim: "2029-11-30",
      tolerancia: 5,
      aviso_dias: 7,
      controle_ativo: true,
      servicos: [
        mensal,
        {
          id: id(11),
          descricao: "Setup",
          tipo: "implantacao",
          periodicidade: "parcelado",
          valor: 4900,
          primeiro_vencimento: "2028-11-05",
          parcelas: 5,
        },
        {
          id: id(12),
          descricao: "Domínio",
          tipo: "dominio",
          periodicidade: "anual",
          valor: 40,
          primeiro_vencimento: "2028-11-05",
          parcelas: 1,
        },
      ],
    };
    // Referência a definir não cria cobrança vencida nem bloqueio indevido.
    const passado = {
      ...dados,
      inicio: "2020-01-01",
      fim: "2020-12-31",
      servicos: [
        {
          ...mensal,
          primeiro_vencimento: "2020-01-05",
          reajustes: [{ vigencia: "2020-01-01", salario_minimo: null }],
        },
      ],
    };
    painel = await salvar(passado, 0);
    assert.equal(painel.parcelas.length, 0);
    assert.equal(painel.status.bloqueado, false);
    assert.equal(painel.reajustes_pendentes.length, 1);
    const previa = await prever(dados);
    assert.equal(previa.parcelas.filter((p) => p.tipo === "mensalidade").length, 2);
    const setup = previa.parcelas.filter((p) => p.tipo === "implantacao");
    assert.equal(setup.length, 5);
    assert(setup.every((p) => Number(p.valor) === 980));
    assert.equal(previa.parcelas.filter((p) => p.tipo === "dominio").length, 2);
    assert.equal(previa.reajustes_pendentes[0].vigencia, "2029-01-01");
    painel = await salvar(dados, painel.contrato.revisao);
    assert.equal(painel.itens_contrato.find((s) => s.id === id(10)).percentual_salario, 23);
    assert.equal(painel.reajustes_pendentes.length, 1);
    await actor(2);
    assert.equal((await scalar("select saas_painel_330()")).reajustes_pendentes.length, 1);
    await assert.rejects(() => prever(dados), /proprietário/);
    await assert.rejects(
      () => q("select saas_completar_servicos_341($1)", [dados.servicos]),
      /permission denied/,
    );
    await actor(3);
    await assert.rejects(() => salvar(dados, painel.contrato.revisao), /proprietário/);
    await actor(1);
    await assert.rejects(
      () =>
        scalar(
          "select saas_registrar_pagamento_330($1,'pago',current_date,'Confirmação de teste',$2)",
          [`contrato:${id(10)}:3`, id(100)],
        ),
      /Parcela não encontrada/,
    );
    // Formulário antigo sem os campos novos não apaga a programação existente.
    const antigo = structuredClone(dados);
    delete antigo.servicos[0].percentual_salario;
    delete antigo.servicos[0].reajustes;
    assert.equal((await prever(antigo)).parcelas.filter((p) => p.tipo === "mensalidade").length, 2);
    painel = await salvar(antigo, painel.contrato.revisao);
    assert.equal(painel.reajustes_pendentes.length, 1);
    const definido = structuredClone(dados);
    definido.servicos[0].reajustes[0].salario_minimo = 2000; // Referência fictícia de teste.
    const nova = await prever(definido);
    assert.equal(nova.parcelas.filter((p) => p.tipo === "mensalidade").length, 13);
    assert.equal(Number(nova.parcelas.find((p) => p.chave === `contrato:${id(10)}:3`).valor), 460);
    assert.deepEqual(
      nova.parcelas.filter((p) => p.tipo === "implantacao"),
      setup,
    );
    assert.equal(nova.reajustes_pendentes.length, 0);
    painel = await salvar(definido, painel.contrato.revisao);
    assert.equal(painel.parcelas.length, 20);
    const multi = structuredClone(definido);
    multi.servicos[0].reajustes.push({ vigencia: "2029-03-01", salario_minimo: 2200 });
    const linhas = (await prever(multi)).parcelas;
    assert.equal(Number(linhas.find((p) => p.chave === `contrato:${id(10)}:4`).valor), 460);
    assert.equal(Number(linhas.find((p) => p.chave === `contrato:${id(10)}:5`).valor), 506);
    for (const change of [
      (s) => s.reajustes.push({ ...s.reajustes[0] }),
      (s) => (s.reajustes[0].salario_minimo = -1),
      (s) => (s.percentual_salario = 0),
      (s) => (s.periodicidade = "anual"),
      (s) => (s.reajustes[0].vigencia = "2030-01-01"),
      (s) =>
        s.reajustes.push(
          { vigencia: "2029-02-01", salario_minimo: null },
          { vigencia: "2029-03-01", salario_minimo: 2000 },
        ),
    ]) {
      const invalido = structuredClone(definido);
      change(invalido.servicos[0]);
      await assert.rejects(() => prever(invalido));
    }
    // Um pagamento confirmado impede recalcular a parcela histórica.
    painel = await scalar(
      "select saas_registrar_pagamento_330($1,'pago',current_date,'Pagamento confirmado de teste',$2)",
      [`contrato:${id(10)}:1`, id(101)],
    );
    const historico = structuredClone(definido);
    historico.servicos[0].reajustes.unshift({ vigencia: "2028-11-01", salario_minimo: 2000 });
    await assert.rejects(() => salvar(historico, painel.contrato.revisao), /histórico financeiro/);
    await assert.rejects(() => salvar(definido, painel.contrato.revisao - 1), /outra sessão/);
    await db.exec("reset role");
    const antes = await scalar(
      "select md5(jsonb_agg(to_jsonb(g) order by chave)::text) from saas_grade_335 g",
    );
    await db.exec(fs.readFileSync("db/fase341_saas_reajuste_salario_minimo.sql", "utf8"));
    await db.exec(fs.readFileSync("db/fase342_saas_carencia_pre_pago.sql", "utf8"));
    await db.exec(fs.readFileSync("db/fase343_saas_responsaveis_avisos.sql", "utf8"));
    assert.equal(
      await scalar("select md5(jsonb_agg(to_jsonb(g) order by chave)::text) from saas_grade_335 g"),
      antes,
    );
    await db.exec("set role anon");
    await assert.rejects(() => prever(dados), /permission denied/);
    console.log(
      "Reajustes341 OK: percentual, vigência, salário a definir sem cobrança/bloqueio, setup independente, referências fictícias, múltiplos reajustes, persistência, master/proprietário, histórico, formulários antigos, revisão concorrente e instalação sem recalcular cobranças.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
