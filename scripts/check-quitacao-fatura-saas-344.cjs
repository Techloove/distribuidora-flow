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
    await db.exec("reset role");
    await db.exec(fs.readFileSync("db/fase344_saas_quitacao_fatura_mensal.sql", "utf8"));
    await db.exec(fs.readFileSync("db/fase344_saas_quitacao_fatura_mensal.sql", "utf8"));
    await actor(1);
    const competencia = await scalar(
      "select (date_trunc('month',now() at time zone 'America/Sao_Paulo')-interval '1 month')::date::text",
    );
    const fim = await scalar(
      "select (date_trunc('month',now() at time zone 'America/Sao_Paulo')+interval '2 months')::date::text",
    );
    const proxima = await scalar(
      "select (date_trunc('month',now() at time zone 'America/Sao_Paulo')+interval '1 month')::date::text",
    );
    const data = await scalar("select (now() at time zone 'America/Sao_Paulo')::date::text");
    const dados = {
      empresa: "Contrato de teste",
      master_id: id(2),
      inicio: competencia,
      fim,
      tolerancia: 0,
      aviso_dias: 7,
      controle_ativo: true,
      servicos: [
        { id: id(10), descricao: "Mensalidade", tipo: "mensalidade", valor: 372.83 },
        { id: id(11), descricao: "Domínio", tipo: "dominio", valor: 40 },
        { id: id(12), descricao: "Setup", tipo: "implantacao", valor: 980 },
        { id: id(13), descricao: "Serviço já pago", tipo: "servico", valor: 50 },
        { id: id(14), descricao: "Serviço cancelado", tipo: "servico", valor: 20 },
        {
          id: id(15),
          descricao: "Outro mês",
          tipo: "servico",
          valor: 100,
          primeiro_vencimento: proxima,
        },
      ].map((s, i) => ({
        ...s,
        periodicidade: "unica",
        parcelas: 1,
        primeiro_vencimento:
          s.primeiro_vencimento ?? competencia.slice(0, 8) + String(1 + i * 2).padStart(2, "0"),
      })),
    };
    painel = await salvar(dados, 0);
    const chave = (n) => `contrato:${id(n)}:1`;
    await scalar(
      "select saas_registrar_pagamento_330($1,'pago',$2,'Pagamento anterior de teste',$3)",
      [chave(13), data, id(100)],
    );
    painel = await scalar(
      "select saas_registrar_pagamento_330($1,'cancelado',null,'Cancelamento anterior de teste',$2)",
      [chave(14), id(101)],
    );
    const chaves = [chave(10), chave(11), chave(12)],
      valor = 1392.83,
      req = id(102),
      motivo = "Pix mensal recebido de teste";
    const quitar = (
      comp = competencia,
      keys = chaves,
      total = valor,
      pago = data,
      texto = motivo,
      requisicao = req,
    ) =>
      scalar("select saas_quitar_fatura_344($1,$2,$3,$4,$5,$6)", [
        comp,
        keys,
        total,
        pago,
        texto,
        requisicao,
      ]);
    const inspecionarEventos = async () => {
      await db.exec("reset role");
      const quantidade = await scalar("select count(*) from saas_eventos_330");
      await actor(1);
      return quantidade;
    };
    const eventosAntes = await inspecionarEventos();
    await actor(2);
    await assert.rejects(() => quitar(), /proprietário/);
    await assert.rejects(() => q("select * from saas_pagamentos_fatura_344"), /permission denied/);
    await actor(3);
    await assert.rejects(() => quitar(), /proprietário/);
    await actor(1);
    const revisao = painel.contrato.revisao;
    await assert.rejects(() => quitar(competencia, chaves.slice(0, 2)), /Fatura alterada/);
    await assert.rejects(() => quitar(competencia, chaves, 1392.84), /Fatura alterada/);
    await assert.rejects(() => quitar(competencia, [...chaves, chaves[0]]), /repetidos/);
    await assert.rejects(() => quitar(competencia, chaves, valor, "2099-01-01"), /Confira/);
    assert.equal((await scalar("select saas_painel_330()")).contrato.revisao, revisao);
    assert.equal(await inspecionarEventos(), eventosAntes);
    // Provoca falha na escrita dos eventos após inserir o recibo: nada pode ficar parcialmente pago.
    await db.exec("reset role");
    await db.query(
      "insert into saas_eventos_330(requisicao,acao,motivo,autor) values(md5($1||':'||$2)::uuid,'contrato','Colisão controlada de teste',$3)",
      [req, chave(11), id(1)],
    );
    await actor(1);
    await assert.rejects(() => quitar(), /duplicate key/);
    assert.equal(
      (await scalar("select saas_painel_330()")).parcelas.filter(
        (p) => chaves.includes(p.chave) && p.estado === "pago",
      ).length,
      0,
    );
    await db.exec("reset role;select set_config('request.jwt.claim.sub','',false)");
    assert.equal(await scalar("select count(*) from saas_pagamentos_fatura_344"), 0);
    await db.query("delete from saas_eventos_330 where requisicao=md5($1||':'||$2)::uuid", [
      req,
      chave(11),
    ]);
    await actor(1);
    await db.exec("select set_config('request.path','/rpc/saas_quitar_fatura_344',false)");
    await scalar("select saas_pre_request_330()");
    painel = await quitar();
    assert.equal(painel.status.bloqueado, false);
    for (const k of chaves) assert.equal(painel.parcelas.find((p) => p.chave === k).estado, "pago");
    assert.equal(painel.parcelas.find((p) => p.chave === chave(13)).estado, "pago");
    assert.equal(painel.parcelas.find((p) => p.chave === chave(14)).estado, "cancelado");
    assert.equal(painel.parcelas.find((p) => p.chave === chave(15)).estado, "pendente");
    const revisaoPaga = painel.contrato.revisao;
    painel = await quitar(competencia, [...chaves].reverse());
    assert.equal(painel.contrato.revisao, revisaoPaga);
    await assert.rejects(
      () => quitar(competencia, chaves, valor, data, "Outro recebimento"),
      /Identificador/,
    );
    await assert.rejects(
      () => quitar(competencia, chaves, valor, data, motivo, id(103)),
      /já quitada/,
    );
    await db.exec("reset role");
    assert.equal(await scalar("select count(*) from saas_pagamentos_fatura_344"), 1);
    assert.equal(
      await scalar("select count(*) from saas_eventos_330 where detalhe->>'fatura_requisicao'=$1", [
        req,
      ]),
      3,
    );
    assert.equal(
      Number(
        await scalar("select valor from saas_pagamentos_fatura_344 where requisicao=$1", [req]),
      ),
      1392.83,
    );
    await actor(1);
    painel = await scalar(
      "select saas_registrar_pagamento_330($1,'reaberto',null,'Reabertura controlada de teste',$2)",
      [chave(10), id(104)],
    );
    const novos = structuredClone(dados);
    novos.servicos.push({
      id: id(16),
      descricao: "Serviço adicional da competência",
      tipo: "servico",
      valor: 10,
      periodicidade: "unica",
      parcelas: 1,
      primeiro_vencimento: competencia,
    });
    painel = await salvar(novos, painel.contrato.revisao);
    await assert.rejects(
      () => quitar(competencia, [chave(10)], 372.83, data, motivo, id(105)),
      /Fatura alterada/,
    );
    painel = await quitar(competencia, [chave(10), chave(16)], 382.83, data, motivo, id(106));
    assert.equal(painel.parcelas.find((p) => p.chave === chave(16)).estado, "pago");
    assert.equal(painel.parcelas.find((p) => p.chave === chave(11)).pagamento_data, data);
    await db.exec("reset role");
    const antes = await scalar("select count(*) from saas_eventos_330");
    await db.exec(fs.readFileSync("db/fase344_saas_quitacao_fatura_mensal.sql", "utf8"));
    assert.equal(await scalar("select count(*) from saas_eventos_330"), antes);
    await db.exec("set role anon");
    await assert.rejects(() => quitar(), /permission denied/);
    console.log(
      "Fatura344 OK: quitação integral por competência, centavos, vencimentos distintos preservados, pagos/cancelados e outro mês excluídos, histórico por serviço, proprietário exclusivo, idempotência, alteração concorrente, falha de escrita sem quitação parcial, regularização durante bloqueio, nova cobrança no mês, reabertura e migração sem criar pagamentos reais.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
