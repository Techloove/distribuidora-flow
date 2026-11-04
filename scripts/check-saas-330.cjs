// PGlite descartável. Sem rede, pagamento real ou alteração de clientes reais.
const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  try {
    await db.exec(`create role authenticated;create role anon;create role service_role;create role authenticator;
 create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,ativo boolean,nome text,email text);
 create table user_roles(user_id uuid,role text);
 create table pedidos(id uuid primary key,valor numeric);alter table pedidos enable row level security;
 create policy leitura on pedidos for all to authenticated using(true) with check(true);grant all on pedidos to authenticated;
 insert into profiles values('${id(1)}',true,'Proprietário','owner@example.test'),('${id(2)}',true,'Master','master@example.test'),('${id(3)}',true,'Representante','rep@example.test');
 insert into user_roles values('${id(1)}','representante'),('${id(2)}','admin'),('${id(3)}','representante');
 insert into pedidos values('${id(10)}',200);
 create function legado_sem_guarda() returns void language sql security definer as $$insert into pedidos values(gen_random_uuid(),123)$$;grant execute on function legado_sem_guarda() to authenticated;`);
    await db.exec(`create function admin_limpar_dados_interno_f130(_confirmacao text) returns integer language plpgsql security definer set search_path=public as $$
 declare manter text[]:=array['profiles','user_roles'];lista text;begin
 select string_agg(format('public.%I',c.relname),',') into lista from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname <> all(manter);
 execute 'truncate table '||lista;return 1;end $$;grant execute on function admin_limpar_dados_interno_f130(text) to authenticated;`);
    const migration = fs.readFileSync("db/fase330_painel_saas_cliente_atual.sql", "utf8");
    await db.exec("alter role authenticator set pgrst.db_pre_request='public.hook_existente'");
    await assert.rejects(() => db.exec(migration), /hook existente/);
    await db.exec("rollback");
    assert.equal(
      await db.query("select to_regclass('public.saas_contrato_330') t").then((r) => r.rows[0].t),
      null,
    );
    await db.exec("alter role authenticator reset pgrst.db_pre_request");
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(`insert into saas_proprietarios_330(usuario_id) values('${id(1)}')`);
    const q = async (s, args) => (await db.query(s, args)).rows;
    const scalar = async (s, args) => Object.values((await q(s, args))[0])[0];
    async function actor(n) {
      await db.exec(
        `reset role;select set_config('request.jwt.claim.sub','${id(n)}',false);select set_config('request.jwt.claims','{"role":"authenticated"}',false);set role authenticated;`,
      );
    }
    const today = String(
      await scalar("select (now() at time zone 'America/Sao_Paulo')::date::text d"),
    ).slice(0, 10);
    const old = String(
      await scalar("select ((now() at time zone 'America/Sao_Paulo')::date-65)::date::text d"),
    ).slice(0, 10);
    const next = String(
      await scalar(
        "select (date_trunc('month',(now() at time zone 'America/Sao_Paulo')::date)+interval '1 month')::date::text d",
      ),
    ).slice(0, 10);
    await db.exec("grant select,update on profiles to authenticated");
    await actor(2);
    await assert.rejects(
      () => q("update profiles set ativo=false where id=$1", [id(1)]),
      /proprietária/,
    );
    assert.equal((await scalar("select saas_status_330()")).proprietario, false);
    await assert.rejects(() => q("select * from saas_contrato_330"), /permission denied/);
    await assert.rejects(() => q("select saas_salvar_contrato_330($1,0)", [{}]), /proprietário/);
    await actor(1);
    let painel = await scalar("select saas_painel_330()");
    assert.equal(painel.status.bloqueado, false);
    assert.equal(painel.status.proprietario, true);
    const payload = {
      empresa: "Cliente de teste",
      responsavel: "Master",
      contato: "contato@example.test",
      plano: "Plano exemplo",
      dominio: "sistema.example.test",
      master_id: id(2),
      mensal_inicio: old,
      mensalidade: 100,
      dia_vencimento: 31,
      setup_valor: 100,
      setup_parcelas: 3,
      setup_vencimento: next,
      tolerancia: 5,
      aviso_dias: 7,
      controle_ativo: false,
      instrucoes: "Procure o proprietário",
    };
    painel = await scalar("select saas_salvar_contrato_330($1,$2)", [
      payload,
      painel.contrato.revisao,
    ]);
    assert.equal(painel.status.bloqueado, false);
    const setup = painel.parcelas.filter((x) => x.tipo === "implantacao");
    assert.equal(setup.length, 3);
    assert.equal(
      setup.reduce((s, x) => s + Number(x.valor), 0),
      100,
    );
    assert.equal(Number(setup[2].valor), 33.34);
    // Limites reais da tolerância e aviso, com alterações apenas na fixture descartável.
    await db.exec(`begin;reset role;select set_config('request.jwt.claim.sub','',false);
   delete from saas_termos_330;delete from saas_setup_330;
   update saas_contrato_330 set mensal_inicio=null,controle_ativo=true,tolerancia=1;
   insert into saas_setup_330 values('fixture',1,(now() at time zone 'America/Sao_Paulo')::date-1,10);`);
    await actor(2);
    assert.equal((await scalar("select saas_status_330()")).estado, "em_tolerancia");
    assert.equal(await scalar("select saas_acesso_330()"), true);
    await db.exec("reset role;update saas_contrato_330 set tolerancia=0");
    assert.equal(await scalar("select saas_bloqueado_330()"), true);
    await db.exec(
      "update saas_setup_330 set vencimento=(now() at time zone 'America/Sao_Paulo')::date+3",
    );
    await actor(2);
    assert.equal((await scalar("select saas_status_330()")).estado, "a_vencer");
    await db.exec("rollback");
    await actor(1);
    // Dia 31 não transborda para outro mês; calendário cria as competências sem cron.
    for (const p of painel.parcelas.filter((x) => x.tipo === "mensalidade"))
      assert.equal(p.competencia.slice(0, 7), p.vencimento.slice(0, 7));
    await assert.rejects(
      () => q("select saas_salvar_contrato_330($1,0)", [payload]),
      /outra sessão/,
    );
    payload.controle_ativo = true;
    painel = await scalar("select saas_salvar_contrato_330($1,$2)", [
      payload,
      painel.contrato.revisao,
    ]);
    assert.equal(painel.status.bloqueado, true);
    await actor(3);
    assert.equal((await scalar("select saas_painel_330()")).contrato, undefined);
    assert.equal((await q("select * from pedidos")).length, 0);
    await assert.rejects(
      () => q("insert into pedidos values($1,10)", [id(11)]),
      /row-level security/,
    );
    await db.exec("select set_config('request.path','/rpc/legado_sem_guarda',false)");
    await assert.rejects(() => q("select saas_pre_request_330()"), /Assinatura pendente/);
    await db.exec("select set_config('request.path','/pedidos',false)");
    await assert.rejects(() => q("select saas_pre_request_330()"), /Assinatura pendente/);
    await db.exec("select set_config('request.path','/rpc/saas_painel_330',false)");
    await q("select saas_pre_request_330()");
    await actor(2);
    assert.equal((await scalar("select saas_status_330()")).master, true);
    assert((await scalar("select saas_painel_330()")).parcelas.length > 0);
    await assert.rejects(
      () =>
        q("select saas_registrar_pagamento_330($1,$2,$3,$4,$5)", [
          painel.parcelas[0].chave,
          "pago",
          today,
          "Recebido de teste",
          id(99),
        ]),
      /proprietário/,
    );
    await actor(1);
    await db.exec("select set_config('request.path','/pedidos',false)");
    await assert.rejects(() => q("select saas_pre_request_330()"), /Assinatura pendente/);
    const vencidas = painel.parcelas.filter((x) => x.estado === "vencido");
    assert(vencidas.length > 0);
    let request;
    for (let i = 0; i < vencidas.length; i++) {
      request = [vencidas[i].chave, "pago", today, "Recebimento fictício", id(100 + i)];
      painel = await scalar("select saas_registrar_pagamento_330($1,$2,$3,$4,$5)", request);
    }
    assert.equal(painel.status.bloqueado, false);
    const historico = painel.historico.length;
    assert.equal(
      (await scalar("select saas_registrar_pagamento_330($1,$2,$3,$4,$5)", request)).historico
        .length,
      historico,
    );
    await assert.rejects(
      () =>
        q("select saas_registrar_pagamento_330($1,$2,$3,$4,$5)", [
          ...request.slice(0, 3),
          "Outro motivo",
          request[4],
        ]),
      /outra operação/,
    );
    const paid = painel.parcelas.find((x) => x.estado === "pago");
    painel = await scalar("select saas_registrar_pagamento_330($1,$2,$3,$4,$5)", [
      paid.chave,
      "reaberto",
      null,
      "Revisão fictícia",
      id(200),
    ]);
    assert.equal(painel.status.bloqueado, true);
    painel = await scalar("select saas_registrar_pagamento_330($1,$2,$3,$4,$5)", [
      paid.chave,
      "cancelado",
      null,
      "Cancelamento de teste",
      id(201),
    ]);
    assert.equal(painel.status.bloqueado, false);
    const original = painel.parcelas.find((x) => x.chave === paid.chave).valor;
    payload.mensalidade = 150;
    payload.vigencia_mensalidade = next;
    painel = await scalar("select saas_salvar_contrato_330($1,$2)", [
      payload,
      painel.contrato.revisao,
    ]);
    assert.equal(painel.parcelas.find((x) => x.chave === paid.chave).valor, original);
    await actor(3);
    await q("select saas_pre_request_330()");
    assert.equal((await q("select * from pedidos")).length, 1);
    await db.exec("reset role");
    assert.equal(await scalar("select count(*) from pedidos"), 1);
    // Mesmo o reset autorizado do ERP deve preservar o SaaS. Reverte a limpeza da fixture.
    await actor(2);
    await db.exec("begin");
    await q("select admin_limpar_dados_interno_f130('LIMPAR')");
    assert((await scalar("select saas_painel_330()")).contrato);
    await db.exec("rollback");
    await actor(1);
    await db.exec("reset role");
    // A revogação do proprietário não depende do papel de representante/admin do ERP.
    await db.exec(`update profiles set ativo=false where id='${id(1)}'`);
    await actor(1);
    await assert.rejects(
      () => q("select saas_salvar_contrato_330($1,$2)", [payload, painel.contrato.revisao]),
      /proprietário/,
    );
    console.log(
      "OK SaaS330: configuração inicialmente liberada, setup com centavos, recorrência por calendário, bloqueio REST/RLS/legado, master sem escrita, proprietário separado, pagamento idempotente, reabertura/cancelamento, histórico preservado e ERP intacto.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
