const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
create table profiles(id uuid primary key,ativo boolean);create table user_roles(user_id uuid,role text);
create function has_role(uuid,text) returns boolean language sql as $$select exists(select 1 from user_roles where user_id=$1 and role=$2)$$;
create function can_finance(uuid) returns boolean language sql as $$select exists(select 1 from user_roles where user_id=$1 and role in ('admin','gestor','financeiro'))$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select has_role(auth.uid(),'admin') or $1='${id(10)}'::uuid$$;
create function ator_financeiro_pode_acessar_centro(uuid,uuid) returns boolean language sql as $$select can_finance($1) and (has_role($1,'admin') or $2='${id(10)}'::uuid)$$;
create table centros(id uuid primary key);
create table contas_financeiras(id uuid primary key,nome text,centro_id uuid,ativo boolean,created_at timestamptz default now());
create table categorias_financeiras(id uuid primary key,tipo text,grupo_dre text,parent_id uuid,ordem int);
create table contas_receber(id uuid primary key,cliente_id uuid,centro_id uuid,pedido_id uuid,documento text,parcela int,status text,valor numeric(14,2),juros numeric(14,2) default 0,multa numeric(14,2) default 0,acrescimo numeric(14,2) default 0,desconto numeric(14,2) default 0,valor_pago numeric(14,2) default 0,vencimento date,conta_financeira_id uuid,forma_pagamento_id uuid,data_pagamento date,categoria_id uuid,observacao text);
create table boletos(id uuid primary key default gen_random_uuid(),conta_receber_id uuid,cliente_id uuid,centro_id uuid,pedido_id uuid,documento text,parcela int,banco text,seu_numero text,nosso_numero text,valor numeric(14,2),valor_liquidado numeric(14,2),vencimento date,data_liquidacao date,status text,created_by uuid,cooperativa text,posto text,codigo_beneficiario text,ambiente text,tipo_cobranca text,qrcode_pix text,txid text,erro text,created_at timestamptz default now(),tentativas int,enviado_em timestamptz,linha_digitavel text,codigo_barras text,retorno jsonb,canal text not null default 'api');
create unique index boleto_seu_numero on boletos(banco,seu_numero);
create unique index boleto_ativo on boletos(conta_receber_id) where status in ('pendente','registrado','liquidado','em_processamento');
create table movimentos_financeiros(id uuid primary key default gen_random_uuid(),conta_id uuid,data date,tipo text,origem text,valor numeric(14,2),categoria_id uuid,centro_id uuid,descricao text,documento text,created_by uuid,forma_pagamento_id uuid,conta_receber_id uuid);
create table auditoria(tabela text,registro_id uuid,acao text,detalhe jsonb,user_id uuid);
create table sicredi_cnab_arquivos(tipo text,sequencia int);
insert into profiles values('${id(1)}',true),('${id(2)}',true),('${id(3)}',false);
insert into user_roles values('${id(1)}','admin'),('${id(2)}','financeiro'),('${id(3)}','admin');
insert into centros values('${id(10)}'),('${id(11)}');
insert into contas_financeiras values('${id(20)}','Sicredi',null,true,now());
select set_config('request.jwt.claim.role','service_role',false);`);
    const readSql = (f) => fs.readFileSync(path.join(root, "db", f), "utf8");
    const apiSql = readSql("fase18_sicredi_config.sql");
    await db.exec(apiSql.slice(apiSql.indexOf("create table"), apiSql.indexOf("grant select")));
    const cnabSql = readSql("fase204_sicredi_cnab240.sql");
    await db.exec(
      cnabSql.slice(
        cnabSql.indexOf("create table"),
        cnabSql.indexOf("create table if not exists public.sicredi_cnab_arquivos"),
      ),
    );
    await db.exec(
      `create unique index sicredi_single on sicredi_config((true));create unique index cnab_single on sicredi_cnab_config((true));insert into sicredi_config(api_key,username,password,cooperativa,posto,codigo_beneficiario,tipo_cobranca) values('fixture-legacy-key','006230165','fixture-password','0165','02','00623','NORMAL');`,
    );
    const load = async (f, name) => {
      const s = readSql(f),
        start = s.indexOf("create or replace function public." + name + "(");
      assert.ok(start >= 0);
      await db.exec(s.slice(start, s.indexOf("$$;", start) + 3));
    };
    await load("fase208_sicredi_configuracao_compartilhada.sql", "cnab_salvar_config");
    await load("fase131_reserva_emissao_sicredi.sql", "preparar_boleto_sicredi_servidor");
    await load(
      "fase129_idempotencia_persistencia_sicredi.sql",
      "registrar_boleto_sicredi_servidor",
    );
    await load("fase71_perimetro_financeiro_centros.sql", "receber_titulo");
    await db.exec(readSql("fase223_sicredi_convenio_unificado.sql"));
    const migration = readSql("fase224_sicredi_api_manual391.sql");
    await db.exec(migration);
    await db.exec(migration);
    await db.exec("alter table contas_financeiras add column conta text");
    await db.exec(readSql("fase249_correcao_conta_recebimento.sql"));
    await db.exec(readSql("fase249_correcao_conta_recebimento.sql"));
    const row = async (table, key, value) =>
      (
        await db.query(
          `select * from ${table}${key ? " where " + key + "=$1" : ""}`,
          key ? [value] : [],
        )
      ).rows[0];
    assert.equal((await row("sicredi_config")).sandbox_api_key, "fixture-legacy-key");
    assert.equal((await row("sicredi_config")).api_key, "fixture-legacy-key");
    const title = async (n, centro = id(10)) => {
      await db.query(
        `insert into contas_receber(id,centro_id,status,valor,vencimento,documento,parcela,conta_financeira_id) values($1,$2,'aberto',100,'2026-11-30','MANUAL',1,$3)`,
        [id(n), centro, id(20)],
      );
      return id(n);
    };
    // Calling a composite with .* can evaluate repeatedly; use FROM for a single invocation.
    const prepare = async (t, actor = id(1)) =>
      (await db.query("select * from preparar_boleto_sicredi_servidor($1,$2)", [actor, t])).rows[0];

    await db.exec(`create schema cron;create table cron.job(jobname text);
      create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job values($1) returning 1::bigint$$;
      create schema net;create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language sql as $$select 1::bigint$$;
      create function usuario_ativo() returns bool language sql as $$select true$$;create function can_manage(uuid) returns bool language sql as $$select has_role($1,'admin')$$;`);
    const migration247 = readSql("fase247_sicredi_consulta_automatica.sql")
      .replace("create extension if not exists pg_cron;", "")
      .replace("create extension if not exists pg_net with schema extensions;", "");
    await db.exec(migration247);
    await db.exec(`update sicredi_config set ambiente='producao';`);

    await db.exec(readSql("fase277_diagnostico_consulta_sicredi.sql"));
    const fase345 = readSql("fase345_sicredi_consulta_priorizada.sql");
    await db.exec(fase345);
    await db.exec(fase345);
    const scalar = async (sql, args) => Object.values((await db.query(sql, args)).rows[0])[0];
    await db.exec(
      "create table sicredi_tarifas_api_280(boleto_id uuid,data_lancamento date,debitos jsonb,primary key(boleto_id,data_lancamento))",
    );
    const segredo = await scalar("select segredo from sicredi_auto_config_247");
    // O job de tarifas compartilha o mesmo mecanismo de transporte; seu processamento é testado separadamente.
    await db.exec(
      `create function sicredi_tarifas_disparar_280() returns void language plpgsql as $fn$declare c public.sicredi_auto_config_247;begin select * into c from sicredi_auto_config_247 where id;perform net.http_post(url:=c.endpoint,headers:=jsonb_build_object('Authorization','Bearer '||c.segredo),body:='{}'::jsonb,timeout_milliseconds:=60000);end$fn$;`,
    );
    const fase348 = readSql("fase348_sicredi_todos_boletos_executor.sql");
    await db.exec(fase348);
    await db.exec(fase348);
    const fase349 = readSql("fase349_sicredi_autenticacao_agendamento.sql");
    await db.exec(fase349);
    await db.exec(fase349);
    assert.equal(
      await scalar("select endpoint from sicredi_auto_config_247"),
      "https://caparaosystem.com.br/api/sicredi/sincronizar",
    );
    assert.equal(await scalar("select segredo from sicredi_auto_config_247"), segredo);
    assert.equal(
      await scalar(
        "select position('X-Sicredi-Automacao' in pg_get_functiondef('public.sicredi_auto_disparar_247()'::regprocedure))>0",
      ),
      true,
    );
    const boletos = [];
    for (let i = 0; i < 24; i++) {
      const t = await title(100 + i);
      const b = await prepare(t);
      boletos.push(b.id);
      await db.query(
        "update boletos set status='registrado',nosso_numero=$2,vencimento=current_date+$3::integer where id=$1",
        [b.id, String(600000500 + i), i === 23 ? 1 : 365],
      );
      await db.query(
        "insert into sicredi_auto_fila_247(boleto_id,ultima_consulta,proxima_consulta) values($1,now()-interval '2 hours'+$2::integer*interval '1 second',now()-interval '1 hour')",
        [b.id, i],
      );
    }
    await db.query(
      "update sicredi_auto_fila_247 set lease=$2,lease_ate=now()+interval '10 minutes' where boleto_id=$1",
      [boletos[21], id(999)],
    );
    const debitos = JSON.stringify([{ descricao: "TARIFA ENTRADA/LIQUIDACAO", valor: 1.63 }]);
    await db.query("insert into sicredi_tarifas_api_280 values($1,current_date,$2)", [
      boletos[20],
      debitos,
    ]);
    await assert.rejects(
      () => scalar("select sicredi_auto_reservar_348('invalido','1.43.5')"),
      /autorizado/,
    );
    const reservar = () => scalar("select sicredi_auto_reservar_348($1,'1.43.5')", [segredo]);
    const lote = await reservar();
    assert.equal(lote.itens.length, 20);
    assert.equal(lote.itens[0].id, boletos[20]);
    assert.equal(lote.itens[1].id, boletos[0]);
    assert.ok(!lote.itens.some((x) => x.id === boletos[21]));
    assert.ok(!lote.itens.some((x) => x.id === boletos[23]));
    assert.equal(await scalar("select executor_versao_348 from sicredi_auto_config_247"), "1.43.5");
    assert.equal((await reservar()).itens.length, 0);
    for (const b of lote.itens) {
      await scalar("select sicredi_auto_finalizar_247($1,$2,'pendente',null)", [lote.lease, b.id]);
      const espera = Number(
        await scalar(
          "select extract(epoch from proxima_consulta-now()) from sicredi_auto_fila_247 where boleto_id=$1",
          [b.id],
        ),
      );
      assert.ok(espera >= 899 && espera <= 901);
    }
    const proxima = await scalar(
      "select proxima_consulta::text from sicredi_auto_fila_247 where boleto_id=$1",
      [boletos[20]],
    );
    await db.query("update sicredi_tarifas_api_280 set debitos=$2 where boleto_id=$1", [
      boletos[20],
      debitos,
    ]);
    assert.equal(
      await scalar("select proxima_consulta::text from sicredi_auto_fila_247 where boleto_id=$1", [
        boletos[20],
      ]),
      proxima,
    );
    assert.equal(await scalar("select count(*) from movimentos_financeiros"), 0);
    await db.query("update sicredi_tarifas_api_280 set debitos=$2 where boleto_id=$1", [
      boletos[20],
      JSON.stringify([{ descricao: "TARIFA NOVA", valor: 2 }]),
    ]);
    assert.equal(
      await scalar("select proxima_consulta<=now() from sicredi_auto_fila_247 where boleto_id=$1", [
        boletos[20],
      ]),
      true,
    );
    await db.exec("update sicredi_auto_config_247 set bloqueado_ate=null");
    const novo = await reservar();
    assert.equal(novo.itens[0].id, boletos[20]);
    const data = await scalar("select current_date::text");
    assert.equal(
      await scalar("select sicredi_auto_finalizar_247($1,$2,'liquidado',$3)", [
        novo.lease,
        boletos[20],
        JSON.stringify({ data, valor: 100, juros: 0, multa: 0, desconto: 0, abatimento: 0 }),
      ]),
      "liquidado",
    );
    assert.equal(await scalar("select count(*) from movimentos_financeiros"), 1);
    await assert.rejects(
      () =>
        scalar("select sicredi_auto_finalizar_247($1,$2,'liquidado',$3)", [
          novo.lease,
          boletos[20],
          JSON.stringify({ data, valor: 100, juros: 0, multa: 0, desconto: 0, abatimento: 0 }),
        ]),
      /expirada/,
    );
    const ator = async (n) =>
      db.exec(
        `reset role;set role authenticated;select set_config('request.jwt.claim.role','authenticated',false);select set_config('request.jwt.claim.sub','${id(n)}',false)`,
      );
    await ator(1);
    const status = await scalar("select sicredi_auto_status_247(null)");
    assert.equal(status.executor_versao, "1.43.5");
    await assert.rejects(() => reservar(), /permission denied/);
    await db.exec("reset role;set role anon");
    await assert.rejects(() => reservar(), /permission denied/);
    console.log(
      "Sicredi348 OK: destino corrigido sem expor segredo, 20 por lote, todos os vencimentos com espera15min, rotação, movimento prioriza sem provar pagamento, reconsulta igual não antecipa, lease protegido, executor identificado, baixa real idempotente e financeiro sem duplicidade.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
