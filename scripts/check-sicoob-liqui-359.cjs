const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.role() returns text language sql as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')$$;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create schema cron;create table cron.job(jobname text);create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
create schema net;create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language sql as $$select 1::bigint$$;
create table centros(id uuid primary key);insert into centros values('${id(2)}');
create table profiles(id uuid primary key,ativo bool,precisa_completar_cadastro bool);insert into profiles values('${id(1)}',true,false);
create function has_role(uuid,text) returns bool language sql as $$select true$$;
create function ator_financeiro_pode_acessar_centro(uuid,uuid) returns bool language sql as $$select true$$;
create function can_finance(uuid) returns bool language sql as $$select $1='${id(1)}'::uuid$$;
create function usuario_pode_acessar_centro(uuid) returns bool language sql as $$select $1='${id(2)}'::uuid$$;
create function validar_sicoob_316(uuid,uuid,boolean default false) returns void language plpgsql as $$begin if $1 is null or $2 is distinct from '${id(2)}'::uuid then raise exception 'ator';end if;end$$;
create table contas_financeiras(id uuid primary key,centro_id uuid,ativo bool,created_at timestamptz default now());insert into contas_financeiras(id,centro_id,ativo) values('${id(7)}','${id(2)}',true);
create table sicoob_config_316(centro_id uuid,ambiente text,ativo bool,autenticado_versao int,versao int,numero_cliente bigint,numero_conta bigint,numero_contrato bigint);
insert into sicoob_config_316 values('${id(2)}','producao',true,1,1,123,456,null);
create table cobranca_centros(centro_id uuid,banco text,canal text,ativo bool,conta_financeira_id uuid);insert into cobranca_centros values('${id(2)}','sicoob','api',true,'${id(7)}');
create table sicoob_auto_config_358(id bool,ativo bool,segredo text);insert into sicoob_auto_config_358 values(true,true,'fixture');
create table sicoob_auto_fila_358(boleto_id uuid,ultima_consulta timestamptz,erros int);
create table categorias_financeiras(id uuid,tipo text,grupo_dre text,parent_id uuid,ordem int);insert into categorias_financeiras values('${id(8)}','receita','receita_bruta',null,1);
create table contas_receber(id uuid primary key,centro_id uuid,valor numeric,valor_pago numeric default 0,juros numeric default 0,multa numeric default 0,acrescimo numeric default 0,desconto numeric default 0,status text default 'aberto',conta_financeira_id uuid,forma_pagamento_id uuid,data_pagamento date,categoria_id uuid,observacao text,documento text,parcela int);
create table movimentos_financeiros(id uuid default gen_random_uuid(),conta_id uuid,data date,tipo text,origem text,valor numeric,centro_id uuid,forma_pagamento_id uuid,conta_receber_id uuid,categoria_id uuid,descricao text,documento text,created_by uuid);
create table auditoria(tabela text,registro_id uuid,acao text,user_id uuid,detalhe jsonb);
create table boletos(id uuid primary key,centro_id uuid,banco text,canal text,ambiente text,status text,nosso_numero text,seu_numero text,codigo_barras text,valor numeric,data_emissao date,conta_receber_id uuid,conta_cobranca_id uuid,sicoob_snapshot_316 jsonb,sicoob_pendente_316 uuid,erro text,valor_liquidado numeric default 0,data_liquidacao date,created_at timestamptz default now());
create table sicoob_operacoes_316(id uuid default gen_random_uuid(),boleto_id uuid references boletos(id),tipo text,estado text,nota text,updated_at timestamptz);
insert into contas_receber(id,centro_id,valor,documento,parcela) values('${id(3)}','${id(2)}',50,'Teste1',1);
insert into boletos(id,centro_id,banco,canal,ambiente,status,nosso_numero,seu_numero,codigo_barras,valor,data_emissao,conta_receber_id,conta_cobranca_id,sicoob_snapshot_316) values('${id(4)}','${id(2)}','sicoob','api','producao','liquidado','3849','origem','756${"0".repeat(41)}',50,(now() at time zone 'America/Sao_Paulo')::date-1,'${id(3)}','${id(7)}','{"numero_cliente":123,"numero_conta":456}');
insert into sicoob_operacoes_316(boleto_id,tipo,estado) values('${id(4)}','emissao','confirmado');`);
    await db.exec(
      `insert into contas_financeiras(id,centro_id,ativo) values('${id(9)}','${id(2)}',true);update contas_receber set conta_financeira_id='${id(9)}';`,
    );
    const receiver = fs
      .readFileSync("db/fase71_perimetro_financeiro_centros.sql", "utf8")
      .match(/create or replace function public\.receber_titulo\([\s\S]*?\$\$;/)[0];
    await db.exec(receiver);
    await db.exec(fs.readFileSync("db/fase359_sicoob_liqui_financeiro.sql", "utf8"));
    await db.exec(fs.readFileSync("db/fase360_sicoob_referencias_liqui.sql", "utf8"));
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('authenticated','sicoob_liqui_reservar_359(text)','EXECUTE') as ok",
        )
      ).rows[0].ok,
      false,
    );
    await assert.rejects(
      () => db.query("select sicoob_liqui_reservar_359('errado')"),
      /não autorizado/,
    );
    const reserve = async () =>
      (await db.query("select sicoob_liqui_reservar_359('fixture') as j")).rows[0].j;
    const step = (j, a, d = {}) =>
      db.query("select sicoob_liqui_etapa_359($1,$2,$3,$4)", [j.id, j.lease, a, d]);
    let j = await reserve();
    assert.equal(j.estado, "solicitar");
    assert.ok(j.fim >= j.inicio);
    assert.equal((await reserve()).id, undefined);
    await step(j, "solicitacao", { codigo: 99 });
    await db.exec("update sicoob_liqui_jobs_359 set proxima=now()");
    j = await reserve();
    assert.equal(j.estado, "aguardar");
    await step(j, "aguardar");
    await db.exec("update sicoob_liqui_jobs_359 set proxima=now()");
    j = await reserve();
    await step(j, "arquivos", { ids: [101, 102] });
    j = await reserve();
    assert.equal(j.estado, "baixar");
    const event = {
      numeroCliente: "123",
      numeroConta: "456",
      nossoNumero: "3849",
      seuNumero: "origem",
      codigoBarras: "756" + "0".repeat(41),
      contratoCobranca: null,
      data: j.inicio,
      dataMovimento: j.inicio,
      nominal: 50,
      valor: 50,
      mora: 0,
      desconto: 0,
      abatimento: 0,
      tarifa: 1.63,
      chave: "a".repeat(64),
    };
    const apply = (job, file, reg) =>
      db.query("select sicoob_liqui_arquivo_359($1,$2,$3,$4) as r", [job.id, job.lease, file, reg]);
    await assert.rejects(() => apply({ ...j, lease: id(99) }, 101, [event]), /inválido/);
    const r = await apply(j, 101, [
      { ...event, numeroConta: "999", chave: "f".repeat(64) },
      event,
      event,
    ]);
    assert.equal(r.rows[0].r.baixados, 1);
    assert.equal(r.rows[0].r.ignorados, 1);
    assert.equal(
      Number((await db.query("select valor_pago,status from contas_receber")).rows[0].valor_pago),
      50,
    );
    assert.equal((await db.query("select * from movimentos_financeiros")).rows.length, 1);
    assert.equal(
      (await db.query("select conta_id from movimentos_financeiros")).rows[0].conta_id,
      id(7),
    );
    assert.equal(
      (await db.query("select estado from sicoob_liqui_jobs_359")).rows[0].estado,
      "baixar",
    );
    j = await reserve();
    await apply(j, 102, [event]);
    assert.equal((await db.query("select * from movimentos_financeiros")).rows.length, 1);
    assert.equal(
      (await db.query("select estado from sicoob_liqui_jobs_359")).rows[0].estado,
      "concluido",
    );
    assert.equal(
      Number((await db.query("select valor_liquidado from boletos")).rows[0].valor_liquidado),
      50,
    );
    assert.equal((await db.query("select auth.role() as r")).rows[0].r, "service_role");
    // Nova janela: valor corrigido ou baixa manual nunca cria outra entrada.
    await db.exec(
      `update sicoob_liqui_config_359 set proxima_consulta=now();update boletos set sicoob_recebimento_359=null;`,
    );
    j = await reserve();
    await step(j, "solicitacao", { codigo: 100 });
    await db.exec("update sicoob_liqui_jobs_359 set proxima=now()");
    j = await reserve();
    await step(j, "arquivos", { ids: [103] });
    j = await reserve();
    const hold = await apply(j, 103, [{ ...event, chave: "b".repeat(64), data: j.inicio }]);
    assert.equal(hold.rows[0].r.conferir, 1);
    assert.equal((await db.query("select * from movimentos_financeiros")).rows.length, 1);
    // Novo título com mora agregada, desconto e abatimento: tarifa não reduz o recebido.
    await db.exec(`insert into contas_receber(id,centro_id,valor,documento,parcela) values('${id(10)}','${id(2)}',100,'Encargos',1);
  insert into boletos(id,centro_id,banco,canal,ambiente,status,nosso_numero,seu_numero,codigo_barras,valor,data_emissao,conta_receber_id,conta_cobranca_id,sicoob_snapshot_316)
  select '${id(11)}',centro_id,banco,canal,ambiente,'registrado','3850','encargos','756${"0".repeat(40)}1',100,data_emissao,'${id(10)}',conta_cobranca_id,sicoob_snapshot_316 from boletos where id='${id(4)}';
  insert into sicoob_operacoes_316(boleto_id,tipo,estado) values('${id(11)}','emissao','confirmado');
  update sicoob_liqui_config_359 set proxima_consulta=now();`);
    j = await reserve();
    await db.exec("update sicoob_config_316 set versao=2");
    await assert.rejects(() => step(j, "solicitacao", { codigo: 101 }), /CONFIG_ALTERADA/);
    await step(j, "erro", { codigo: "CONFIG_ALTERADA" });
    assert.equal(
      (await db.query("select estado from sicoob_liqui_jobs_359 where id=$1", [j.id])).rows[0]
        .estado,
      "conferir",
    );
    await db.exec(
      "update sicoob_config_316 set versao=1;update sicoob_liqui_config_359 set proxima_consulta=now()",
    );
    j = await reserve();
    await step(j, "solicitacao", { codigo: 102 });
    await db.exec("update sicoob_liqui_jobs_359 set proxima=now()");
    j = await reserve();
    await step(j, "arquivos", { ids: [104] });
    j = await reserve();
    const refs = (
      await db.query("select sicoob_liqui_identificar_359($1,$2,$3) as r", [
        j.id,
        j.lease,
        [
          {
            numeroCliente: "123",
            numeroConta: "456",
            nossoNumero: "3850",
            seuNumero: "encargos",
            modalidade: "1",
          },
          {
            numeroCliente: "123",
            numeroConta: "456",
            nossoNumero: "9999",
            seuNumero: "externo",
            modalidade: "1",
          },
        ],
      ])
    ).rows[0].r;
    assert.equal(refs.length, 1);
    assert.equal(refs[0].nossoNumero, "3850");
    const novosRefs = (
      await db.query("select sicoob_liqui_identificar_360($1,$2,$3) as r", [
        j.id,
        j.lease,
        [
          { seuNumero: "NF antiga – venda 123", codigoBarras: "756" + "9".repeat(41) },
          { seuNumero: "encargos", codigoBarras: null },
          { seuNumero: null, codigoBarras: "756" + "0".repeat(40) + "1" },
        ],
      ])
    ).rows[0].r;
    assert.equal(novosRefs.length, 1);
    assert.equal(novosRefs[0].nossoNumero, "3850");
    assert.equal(novosRefs[0].codigoBarras, "756" + "0".repeat(40) + "1");
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('authenticated','sicoob_liqui_identificar_360(uuid,uuid,jsonb)','EXECUTE') as ok",
        )
      ).rows[0].ok,
      false,
    );

    const comEncargos = {
      ...event,
      nossoNumero: "3850",
      seuNumero: "encargos",
      codigoBarras: "756" + "0".repeat(40) + "1",
      nominal: 100,
      valor: 110,
      mora: 15,
      desconto: 3,
      abatimento: 2,
      tarifa: 1.94,
      data: j.inicio,
      dataMovimento: j.inicio,
      chave: "c".repeat(64),
    };
    await apply(j, 104, [comEncargos]);
    const titulo = (await db.query("select * from contas_receber where id=$1", [id(10)])).rows[0];
    assert.equal(Number(titulo.valor_pago), 110);
    assert.equal(Number(titulo.acrescimo), 15);
    assert.equal(Number(titulo.desconto), 5);
    assert.equal(Number(titulo.juros), 0);
    assert.equal(Number(titulo.multa), 0);
    assert.equal((await db.query("select * from movimentos_financeiros")).rows.length, 2);
    assert.equal(
      (await db.query("select * from movimentos_financeiros where tipo='saida'")).rows.length,
      0,
    );
    await db.exec("update sicoob_liqui_config_359 set ativo=false");
    await assert.rejects(
      () =>
        db.query("select sicoob_liqui_validar_359(j) from sicoob_liqui_jobs_359 j where id=$1", [
          j.id,
        ]),
      /CONFIG_ALTERADA/,
    );
    assert.equal((await db.query("select * from movimentos_financeiros")).rows.length, 2);
    console.log(
      "LIQUI359: ciclo assíncrono, janelas de dois dias, lease, privilégios, múltiplos arquivos, baixa real pelo receber_titulo, repetição e baixa manual protegidas.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
