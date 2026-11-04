// PGlite descartável. Não acessa produção nem cria cobranças reais.
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
    const migration = fs.readFileSync("db/fase331_servicos_saas.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(`insert into saas_proprietarios_330(usuario_id) values('${id(1)}')`);
    const q = async (s, args) => (await db.query(s, args)).rows;
    const scalar = async (s, args) => Object.values((await q(s, args))[0])[0];
    const today = await scalar("select (now() at time zone 'America/Sao_Paulo')::date::text");
    const old = await scalar("select ((now() at time zone 'America/Sao_Paulo')::date-10)::text");
    async function actor(n) {
      await db.exec(
        `reset role;select set_config('request.jwt.claim.sub','${id(n)}',false);select set_config('request.jwt.claims','{"role":"authenticated"}',false);set role authenticated`,
      );
    }
    const save = (uid, desc, valor, venc, rev = 0) =>
      scalar("select saas_salvar_servico_331($1,$2,$3,$4,$5,$6)", [
        uid,
        desc,
        valor,
        venc,
        "Referência de exemplo",
        rev,
      ]);
    await actor(1);
    await assert.rejects(() => save(id(30), "Domínio", 120, old), /Configure o contrato/);
    await scalar("select saas_salvar_contrato_330($1,0)", [
      {
        empresa: "Empresa exemplo",
        plano: "Plano",
        master_id: id(2),
        mensal_inicio: today,
        mensalidade: 0,
        dia_vencimento: 10,
        setup_valor: 0,
        setup_parcelas: 1,
        setup_vencimento: today,
        tolerancia: 5,
        aviso_dias: 7,
        controle_ativo: true,
      },
    ]);
    await actor(2);
    await assert.rejects(() => save(id(30), "Domínio", 120, old), /proprietário/);
    await assert.rejects(() => q("select * from saas_servicos_331"), /permission denied/);
    await actor(1);
    for (const valor of [0, -1, "NaN"])
      await assert.rejects(() => save(id(30), "Domínio", valor, old), /Confira descrição/);
    let p = await save(id(30), "Taxa de domínio", 120, old);
    assert.equal(p.status.bloqueado, true);
    assert.equal(p.servicos.length, 1);
    assert.equal(p.parcelas[0].tipo, "servico");
    assert.equal(Number(p.parcelas[0].valor), 120);
    const hist = p.historico.length;
    p = await save(id(30), "Taxa de domínio", 120, old);
    assert.equal(p.servicos.length, 1);
    assert.equal(p.historico.length, hist);
    await db.exec("select set_config('request.path','/rpc/saas_salvar_servico_331',false)");
    await q("select saas_pre_request_330()");
    await db.exec("select set_config('request.path','/pedidos',false)");
    await assert.rejects(() => q("select saas_pre_request_330()"), /Assinatura pendente/);
    p = await save(id(30), "Renovação do domínio", 125.25, old, 1);
    assert.equal(p.servicos[0].revisao, 2);
    await assert.rejects(() => save(id(30), "Outro valor", 130, old, 1), /outra sessão/);
    const chave = "servico:" + id(30);
    p = await scalar("select saas_registrar_pagamento_330($1,$2,$3,$4,$5)", [
      chave,
      "pago",
      today,
      "Recebimento fictício",
      id(40),
    ]);
    assert.equal(p.status.bloqueado, false);
    assert.equal(p.servicos[0].editavel, false);
    assert.equal(Number(p.parcelas[0].valor), 125.25);
    await assert.rejects(
      () => save(id(30), "Mudança posterior", 150, old, 2),
      /histórico financeiro/,
    );
    await actor(2);
    p = await scalar("select saas_painel_330()");
    assert.equal(p.servicos[0].descricao, "Renovação do domínio");
    await assert.rejects(
      () =>
        scalar("select saas_registrar_pagamento_330($1,$2,$3,$4,$5)", [
          chave,
          "reaberto",
          null,
          "Tentativa de master",
          id(41),
        ]),
      /proprietário/,
    );
    await actor(3);
    assert.equal((await scalar("select saas_painel_330()")).servicos, undefined);
    await actor(1);
    await scalar("select saas_registrar_pagamento_330($1,$2,$3,$4,$5)", [
      chave,
      "reaberto",
      null,
      "Revisão de teste",
      id(42),
    ]);
    p = await scalar("select saas_registrar_pagamento_330($1,$2,$3,$4,$5)", [
      chave,
      "cancelado",
      null,
      "Cancelamento de teste",
      id(43),
    ]);
    assert.equal(p.status.bloqueado, false);
    assert.equal(p.parcelas[0].estado, "cancelado");
    p = await save(id(31), "Suporte técnico", 80.5, today);
    assert.equal(p.servicos.length, 2);
    assert.equal(p.parcelas.length, 2);
    await db.exec("reset role");
    assert.equal(await scalar("select valor from contas_receber"), "500");
    console.log(
      "OK SaaS331: lista avulsa, valores/datas, idempotência, revisão concorrente, bloqueio/pagamento/cancelamento, proteção de histórico, master somente leitura e financeiro ERP preservado.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
