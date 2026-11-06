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
    await db.exec(
      `reset role;insert into profiles values('${id(4)}',true,'Segundo responsável','segundo@example.test'),('${id(5)}',true,'Financeiro','financeiro@example.test');insert into user_roles values('${id(4)}','admin'),('${id(5)}','financeiro'),('${id(2)}','representante');`,
    );
    await actor(1);
    const hoje = await scalar("select (now() at time zone 'America/Sao_Paulo')::date::text");
    const ontem5 = await scalar("select ((now() at time zone 'America/Sao_Paulo')::date-5)::text");
    const inicio = await scalar("select ((now() at time zone 'America/Sao_Paulo')::date-10)::text");
    const fim = await scalar("select ((now() at time zone 'America/Sao_Paulo')::date+365)::text");
    const amanha = await scalar("select ((now() at time zone 'America/Sao_Paulo')::date+1)::text");
    const dados = {
      empresa: "Contrato de teste",
      master_id: id(2),
      master_ids: [id(2), id(4)],
      inicio,
      fim,
      tolerancia: 5,
      aviso_dias: 7,
      controle_ativo: true,
      servicos: [
        {
          id: id(10),
          descricao: "Serviço de teste",
          tipo: "servico",
          periodicidade: "unica",
          valor: 100,
          primeiro_vencimento: ontem5,
          parcelas: 1,
        },
      ],
    };
    painel = await salvar(dados, 0);
    assert.deepEqual(painel.contrato.master_ids, [id(2), id(4)]);
    for (const usuario of [2, 4]) {
      await actor(usuario);
      const s = await scalar("select saas_status_330()");
      assert.equal(s.master, true);
      assert.equal(s.estado, "em_tolerancia");
      assert.equal(s.dias_ate_bloqueio, 1);
      assert.equal(s.data_bloqueio, amanha);
      assert.equal(s.limite_regularizacao, hoje);
      assert.equal((await scalar("select saas_painel_330()")).parcelas.length, 1);
      await assert.rejects(() => salvar(dados, painel.contrato.revisao), /proprietário/);
      await assert.rejects(
        () =>
          scalar(
            "select saas_registrar_pagamento_330($1,'pago',current_date,'Recebimento de teste',$2)",
            [`contrato:${id(10)}:1`, id(101)],
          ),
        /proprietário/,
      );
    }
    await actor(3);
    let rep = await scalar("select saas_status_330()");
    assert.equal(rep.master, false);
    assert.equal(rep.vencimento, null);
    assert.equal(rep.dias_ate_bloqueio, null);
    assert.equal(rep.estado, "em_dia");
    assert.equal((await scalar("select saas_painel_330()")).contrato, undefined);
    await db.exec("reset role;update saas_contrato_330 set tolerancia=4 where unico=true");
    await actor(3);
    rep = await scalar("select saas_status_330()");
    assert.equal(rep.bloqueado, true);
    assert.equal(rep.manutencao, true);
    assert.equal(rep.estado, "manutencao");
    assert.equal(rep.data_bloqueio, null);
    const privado = await scalar("select saas_painel_330()");
    assert.equal(privado.mensagem, "Sistema em Manutenção");
    assert.equal(privado.parcelas, undefined);
    assert.equal(privado.contrato, undefined);
    await db.exec("select set_config('request.path','/rpc/legado_sem_guarda',false)");
    await assert.rejects(() => scalar("select saas_pre_request_330()"), /Sistema em Manutenção/);
    await actor(2);
    const bloqueado = await scalar("select saas_status_330()");
    assert.equal(bloqueado.master, true);
    assert.equal(bloqueado.dias_ate_bloqueio, 0);
    assert.equal(bloqueado.data_bloqueio, hoje);
    await assert.rejects(() => scalar("select saas_pre_request_330()"), /Mensalidade pendente/);
    await db.exec("select set_config('request.path','/rpc/saas_painel_330',false)");
    await scalar("select saas_pre_request_330()");
    assert.equal((await scalar("select saas_painel_330()")).parcelas.length, 1);
    await actor(1);
    const velho = structuredClone(dados);
    delete velho.master_ids;
    velho.tolerancia = 4;
    painel = await salvar(velho, painel.contrato.revisao);
    assert.deepEqual(painel.contrato.master_ids, [id(2), id(4)]);
    for (const ids of [[], [id(2), id(2)], [id(3)], [id(5)]])
      await assert.rejects(
        () => salvar({ ...velho, master_ids: ids }, painel.contrato.revisao),
        /responsáveis|administradores/,
      );
    await assert.rejects(
      () => salvar({ ...velho, master_id: id(4) }, painel.contrato.revisao),
      /Atualize o painel/,
    );
    await db.exec(`reset role;delete from user_roles where user_id='${id(4)}' and role='admin';`);
    await actor(4);
    assert.equal((await scalar("select saas_status_330()")).master, false);
    assert.equal((await scalar("select saas_painel_330()")).contrato, undefined);
    await actor(1);
    painel = await salvar({ ...velho, master_ids: [id(2)] }, painel.contrato.revisao);
    await scalar(
      "select saas_registrar_pagamento_330($1,'pago',current_date,'Recebimento confirmado de teste',$2)",
      [`contrato:${id(10)}:1`, id(102)],
    );
    await actor(2);
    const pago = await scalar("select saas_status_330()");
    assert.equal(pago.bloqueado, false);
    assert.equal(pago.dias_ate_bloqueio, null);
    await actor(3);
    assert.equal((await scalar("select saas_status_330()")).bloqueado, false);
    await db.exec("reset role");
    const antes = await scalar("select revisao from saas_contrato_330");
    await db.exec(fs.readFileSync("db/fase343_saas_responsaveis_avisos.sql", "utf8"));
    assert.equal(await scalar("select revisao from saas_contrato_330"), antes);
    await db.exec("set role anon");
    await assert.rejects(() => scalar("select saas_status_330()"), /permission denied/);
    console.log(
      "Responsáveis343 OK: múltiplos administradores, leitura sem confirmação de pagamento, preservação de usuários em formulário antigo, rejeição de representante/financeiro, prazo exato de bloqueio, master admin+representante, manutenção sem dados financeiros para outros usuários/API, revogação por papel, liberação após pagamento e migração repetida sem alterar contrato.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
