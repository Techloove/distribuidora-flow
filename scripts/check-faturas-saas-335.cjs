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
    const dados = {
      empresa: "Contrato teste",
      plano: "Plano anual",
      responsavel: "Master",
      contato: "master@example.test",
      dominio: "cliente.example.test",
      master_id: id(2),
      inicio: "2028-01-01",
      fim: "2028-12-31",
      tolerancia: 5,
      aviso_dias: 7,
      controle_ativo: false,
      instrucoes: "Pagamento por acordo",
      servicos: [
        {
          id: id(10),
          descricao: "Assinatura",
          tipo: "mensalidade",
          periodicidade: "mensal",
          valor: 399.9,
          primeiro_vencimento: "2028-01-31",
          parcelas: 1,
        },
        {
          id: id(11),
          descricao: "Setup",
          tipo: "implantacao",
          periodicidade: "parcelado",
          valor: 100,
          primeiro_vencimento: "2028-01-31",
          parcelas: 3,
        },
        {
          id: id(12),
          descricao: "Hospedagem anual",
          tipo: "hospedagem",
          periodicidade: "anual",
          valor: 120,
          primeiro_vencimento: "2028-01-31",
          parcelas: 1,
        },
      ],
    };
    const prever = (d) => scalar("select saas_prever_contrato_335($1)", [d]);
    const salvar = (d, rev) => scalar("select saas_salvar_grade_335($1,$2)", [d, rev]);
    let previa = await prever(dados);
    assert.equal(previa.parcelas.length, 16);
    assert.equal(Number(previa.total), 5018.8);
    assert.equal(
      previa.parcelas.find((p) => p.chave === `contrato:${id(10)}:2`).vencimento,
      "2028-02-29",
    );
    assert.equal(
      previa.parcelas.find((p) => p.chave === `contrato:${id(10)}:3`).vencimento,
      "2028-03-31",
    );
    assert.equal(
      Number(previa.parcelas.find((p) => p.chave === `contrato:${id(11)}:3`).valor),
      33.34,
    );
    assert.equal(
      (await scalar("select saas_painel_330()")).parcelas.length,
      0,
      "Prévia não cria cobranças",
    );
    for (const patch of [
      { fim: "2027-12-31" },
      { fim: "2040-01-01" },
      { servicos: [] },
      { servicos: [dados.servicos[0], dados.servicos[0]] },
      { servicos: [{ ...dados.servicos[0], valor: "NaN" }] },
      { servicos: [{ ...dados.servicos[1], primeiro_vencimento: "2028-12-31" }] },
      { servicos: [{ ...dados.servicos[0], primeiro_vencimento: "2027-12-31" }] },
      { servicos: [{ ...dados.servicos[0], periodicidade: "semanal" }] },
    ])
      await assert.rejects(() => prever({ ...dados, ...patch }));
    const anual = await prever({
      ...dados,
      inicio: "2028-02-29",
      fim: "2030-03-01",
      servicos: [{ ...dados.servicos[2], primeiro_vencimento: "2028-02-29" }],
    });
    assert.deepEqual(
      anual.parcelas.map((p) => p.vencimento),
      ["2028-02-29", "2029-02-28", "2030-02-28"],
    );
    await actor(2);
    await assert.rejects(() => prever(dados), /proprietário/);
    await assert.rejects(() => salvar(dados, 0), /proprietário/);
    await assert.rejects(() => q("select * from saas_grade_335"), /permission denied/);
    await actor(1);
    painel = await salvar(dados, 0);
    assert.equal(painel.parcelas.length, 16);
    assert.equal(painel.itens_contrato.length, 3);
    assert.equal(painel.contrato.fim, "2028-12-31");
    await assert.rejects(() => salvar(dados, 0), /outra sessão/);
    painel = await salvar(dados, painel.contrato.revisao);
    assert.equal(painel.parcelas.length, 16, "Salvar novamente não duplica");
    await actor(2);
    painel = await scalar("select saas_painel_330()");
    assert.equal(painel.parcelas.length, 16);
    assert.equal(painel.masters.length, 0);
    assert(painel.parcelas.some((p) => p.descricao === "Hospedagem anual"));
    await assert.rejects(
      () =>
        scalar("select saas_registrar_pagamento_330($1,$2,$3,$4,$5)", [
          painel.parcelas[0].chave,
          "pago",
          "2026-01-01",
          "Teste de pagamento",
          id(40),
        ]),
      /proprietário/,
    );
    await actor(3);
    painel = await scalar("select saas_painel_330()");
    assert.equal(painel.contrato, undefined);
    assert.equal(painel.parcelas, undefined);
    await actor(1);
    painel = await scalar("select saas_painel_330()");
    const chave = `contrato:${id(11)}:1`;
    const hoje = await scalar("select (now() at time zone 'America/Sao_Paulo')::date::text");
    painel = await scalar("select saas_registrar_pagamento_330($1,$2,$3,$4,$5)", [
      chave,
      "pago",
      hoje,
      "Pagamento de teste",
      id(40),
    ]);
    assert.equal(painel.parcelas.find((p) => p.chave === chave).estado, "pago");
    await assert.rejects(
      () =>
        salvar(
          {
            ...dados,
            servicos: dados.servicos.map((s) => (s.id === id(11) ? { ...s, valor: 150 } : s)),
          },
          painel.contrato.revisao,
        ),
      /histórico/,
    );
    await assert.rejects(
      () =>
        salvar(
          { ...dados, servicos: dados.servicos.filter((s) => s.id !== id(11)) },
          painel.contrato.revisao,
        ),
      /histórico/,
    );
    await assert.rejects(
      () => scalar("select saas_salvar_contrato_330($1,$2)", [{}, painel.contrato.revisao]),
      /lista de serviços/,
    );
    // Cobrança vencida com bloqueio continua acessível no painel de regularização.
    await db.exec(
      `reset role;insert into saas_grade_335 values('teste-atraso','${id(10)}','Assinatura vencida','mensalidade','2020-01-01',99,'2020-01-01',50);update saas_contrato_330 set controle_ativo=true;`,
    );
    await actor(1);
    await db.exec("select set_config('request.path','/rpc/saas_salvar_grade_335',false)");
    await q("select saas_pre_request_330()");
    await db.exec("select set_config('request.path','/rpc/saas_prever_contrato_335',false)");
    await q("select saas_pre_request_330()");
    await db.exec("select set_config('request.path','/pedidos',false)");
    await assert.rejects(() => q("select saas_pre_request_330()"), /Assinatura pendente/);
    await actor(2);
    assert.equal((await scalar("select saas_painel_330()")).status.bloqueado, true);
    await db.exec("reset role");
    assert.equal(Number(await scalar("select sum(valor) from contas_receber")), 500);
    // Adoção da lista preserva cobranças antigas e seus pagamentos, sem sobreposição.
    await db.exec(`reset role;select set_config('request.jwt.claim.sub','',false);
 delete from saas_grade_335;delete from saas_itens_contrato_335;delete from saas_legado_335;
 update saas_contrato_330 set modelo_335=false,controle_ativo=false,mensal_inicio=null;
 insert into saas_setup_330 values('setup:1',1,'2020-01-10',50);
 insert into saas_servicos_331(id,descricao,valor,vencimento,autor) values('${id(50)}','Domínio anterior',120,'2020-02-10','${id(1)}');
 insert into saas_eventos_330(requisicao,chave,acao,valor,vencimento,pagamento_data,motivo,autor) values('${id(51)}','setup:1','pago',50,'2020-01-10','2020-01-10','Histórico anterior','${id(1)}');
`);
    await actor(1);
    painel = await scalar("select saas_painel_330()");
    assert.equal(painel.parcelas.length, 2);
    await assert.rejects(() => salvar(dados, painel.contrato.revisao), /preservar os vencimentos/);
    const transicao = { ...dados, inicio: "2020-01-01" };
    painel = await salvar(transicao, painel.contrato.revisao);
    assert.equal(painel.parcelas.length, 18);
    assert.equal(painel.parcelas.find((p) => p.chave === "setup:1").estado, "pago");
    assert.equal(
      painel.parcelas.find((p) => p.chave === "servico:" + id(50)).descricao,
      "Domínio anterior",
    );
    await db.exec("reset role");
    await db.exec(migration);
    await db.exec(fs.readFileSync("db/fase340_saas_atualizacao_contrato_com_filtro.sql", "utf8"));
    await db.exec(fs.readFileSync("db/fase341_saas_reajuste_salario_minimo.sql", "utf8"));
    await db.exec(fs.readFileSync("db/fase342_saas_carencia_pre_pago.sql", "utf8"));
    await actor(1);
    assert.equal((await scalar("select saas_painel_330()")).parcelas.length, 18);
    await db.exec("set role anon");
    await assert.rejects(() => prever(dados), /permission denied/);
    console.log(
      "Faturas335 OK: vigência, mensal/anual/parcelado, centavos, prévia sem escrita, idempotência, histórico, proprietário/master, isolamento do ERP e regularização durante bloqueio.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
