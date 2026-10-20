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
    const t = await title(31);
    const b = await prepare(t);
    await db.query(`update boletos set status='registrado',nosso_numero='262000020' where id=$1`, [
      b.id,
    ]);
    const segredo = (await db.query("select segredo from sicredi_auto_config_247")).rows[0].segredo;
    await assert.rejects(
      db.query("select sicredi_auto_reservar_247($1)", ["errado"]),
      /autorizado/,
    );
    const reserva = (await db.query("select sicredi_auto_reservar_247($1) r", [segredo])).rows[0].r;
    assert.equal(reserva.itens.length, 1);
    assert.equal(reserva.itens[0].responsavel, id(1));
    assert.equal(
      (await db.query("select sicredi_auto_reservar_247($1) r", [segredo])).rows[0].r.itens.length,
      0,
    );
    const paid = { data: "2026-10-20", valor: 107, juros: 5, multa: 2, desconto: 0, abatimento: 0 };
    const finish = () =>
      db.query("select sicredi_auto_finalizar_247($1,$2,$3,$4) r", [
        reserva.lease,
        b.id,
        "liquidado",
        JSON.stringify(paid),
      ]);
    assert.equal((await finish()).rows[0].r, "liquidado");
    assert.equal(
      (await db.query("select count(*)::int n from movimentos_financeiros")).rows[0].n,
      1,
    );
    await assert.rejects(finish(), /expirada/);
    assert.equal(
      (await db.query("select status from contas_receber where id=$1", [t])).rows[0].status,
      "pago",
    );
    // Simula pagamento manual entre a reserva e a confirmação automática.
    const t2 = await title(32);
    const b2 = await prepare(t2);
    await db.query(`update boletos set status='registrado',nosso_numero='262000021' where id=$1`, [
      b2.id,
    ]);
    await db.exec("update sicredi_auto_config_247 set bloqueado_ate=null");
    const r2 = (await db.query("select sicredi_auto_reservar_247($1) r", [segredo])).rows[0].r;
    await db.query("select sicredi_liquidar_api_224($1,$2,$3)", [
      id(1),
      b2.id,
      JSON.stringify(paid),
    ]);
    assert.equal(
      (
        await db.query("select sicredi_auto_finalizar_247($1,$2,$3,$4) r", [
          r2.lease,
          b2.id,
          "liquidado",
          JSON.stringify(paid),
        ])
      ).rows[0].r,
      "ja_processado",
    );
    assert.equal(
      (await db.query("select count(*)::int n from movimentos_financeiros")).rows[0].n,
      2,
    );
    const t3 = await title(33);
    const b3 = await prepare(t3);
    await db.query(`update boletos set status='registrado',nosso_numero='262000022' where id=$1`, [
      b3.id,
    ]);
    await db.exec("update sicredi_auto_config_247 set bloqueado_ate=null");
    const r3 = (await db.query("select sicredi_auto_reservar_247($1) r", [segredo])).rows[0].r;
    assert.equal(
      (
        await db.query("select sicredi_auto_finalizar_247($1,$2,$3,$4) r", [
          r3.lease,
          b3.id,
          "liquidado",
          JSON.stringify({ ...paid, valor: 50 }),
        ])
      ).rows[0].r,
      "conferencia",
    );
    assert.equal(
      (await db.query("select status from contas_receber where id=$1", [t3])).rows[0].status,
      "aberto",
    );
    assert.equal(
      (await db.query("select count(*)::int n from movimentos_financeiros")).rows[0].n,
      2,
    );
    await db.exec(migration247);
    assert.equal((await db.query("select count(*)::int n from cron.job")).rows[0].n, 1);
    await db.exec(
      `set role authenticated;select set_config('request.jwt.claim.role','authenticated',false)`,
    );
    await assert.rejects(db.exec("select * from sicredi_auto_config_247"), /permission denied/);
    await assert.rejects(
      db.query("select sicredi_auto_reservar_247($1)", [segredo]),
      /permission denied/,
    );
    console.log(
      "Sicredi247 OK: agendamento único, segredo privado, reserva concorrente, baixa224 real, idempotência, concorrência manual e divergência financeira sem baixa.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
