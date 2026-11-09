const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`set timezone='America/Sao_Paulo';create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;
create function auth.role() returns text language sql as $$select coalesce(current_setting('test.role',true),'service_role')$$;
create function usuario_ativo() returns boolean language sql as $$select coalesce(current_setting('test.active',true),'true')='true'$$;
create function can_finance(uuid) returns boolean language sql as $$select true$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='${id(10)}'::uuid$$;
create function escopo_representante() returns boolean language sql as $$select coalesce(current_setting('test.rep',true),'false')='true'$$;
create function documento_na_minha_carteira(text,uuid) returns boolean language sql as $$select coalesce(current_setting('test.portfolio',true),'true')='true'$$;
create function ator_financeiro_pode_acessar_centro(uuid,uuid) returns boolean language sql as $$select $1='${id(1)}'::uuid$$;
create function has_role(uuid,text) returns boolean language sql as $$select $1='${id(1)}'::uuid and $2='admin'$$;
create table profiles(id uuid primary key,ativo boolean);insert into profiles values('${id(1)}',true);
create table centros(id uuid primary key);insert into centros values('${id(10)}'),('${id(11)}');
create table sicredi_config(ambiente text,cooperativa text,posto text,codigo_beneficiario text);insert into sicredi_config values('producao','0165','02','00623');
create table sicredi_auto_config_247(id bool primary key,ativo boolean,segredo text,endpoint text);insert into sicredi_auto_config_247 values(true,true,'secret','https://erp/api/sicredi/sincronizar');
create table boletos(id uuid primary key,centro_id uuid,banco text,canal text,ambiente text,nosso_numero text,cooperativa text,posto text,codigo_beneficiario text,data_emissao date,status text,valor numeric,valor_liquidado numeric);
insert into boletos values('${id(40)}','${id(10)}','sicredi','api','producao','600000228','0165','02','00623',current_date-2,'liquidado',100,100),('${id(41)}','${id(11)}','sicredi','api','producao','600000229','0165','02','00623',current_date-2,'registrado',200,0);
create table movimentos_financeiros(id uuid,valor numeric);insert into movimentos_financeiros values('${id(50)}',100);
create table contas_receber(id uuid,status text,valor_pago numeric);insert into contas_receber values('${id(60)}','pago',100);
create schema cron;create table cron.job(jobname text);create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin insert into cron.job values($1);return 1;end$$;
create schema net;create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;
grant usage on schema public,auth to authenticated;`);
    const sql = fs.readFileSync(path.join(root, "db/fase280_tarifas_api_sicredi.sql"), "utf8");
    await db.exec(sql);
    await db.exec(sql);
    // Processador financeiro exercitado no teste próprio; aqui validamos o cache real do banco.
    await db.exec(
      `create function sicredi_contabilizar_tarifa_282(uuid,date) returns text language plpgsql as $fn$declare v jsonb;begin if upper(v->>'descricao') ~ '\\mTARIFA\\M' then return 'despesa';end if;return 'outro';end$fn$;`,
    );
    const despesas347 = fs.readFileSync(
      path.join(root, "db/fase347_despesas_bancarias_boletos.sql"),
      "utf8",
    );
    await db.exec(despesas347);
    await db.exec(despesas347);

    await db.exec(`alter table cron.job add column jobid bigserial,add column schedule text default '*/15 * * * *';
      create function cron.alter_job(job_id bigint,schedule text) returns void language sql as $$update cron.job set schedule=$2 where jobid=$1$$;
      update boletos set data_emissao=current_date-120 where id='${id(40)}';
      insert into boletos select '${id(42)}',centro_id,banco,canal,ambiente,'600000230',cooperativa,posto,codigo_beneficiario,data_emissao,'baixado',valor,valor_liquidado from boletos where id='${id(40)}';
      insert into boletos select '${id(43)}',centro_id,banco,canal,ambiente,'600000231',cooperativa,posto,codigo_beneficiario,data_emissao,'cancelado',valor,valor_liquidado from boletos where id='${id(40)}';`);
    const fase350 = fs.readFileSync(
      path.join(root, "db/fase350_tarifas_boletos_ciclo_completo.sql"),
      "utf8",
    );
    await db.exec(fase350);
    await db.exec(fase350);
    const scalar = async (sql, args) => Object.values((await db.query(sql, args)).rows[0])[0];
    assert.equal(
      await scalar("select schedule from cron.job where jobname='sicredi-tarifas-api-280'"),
      "*/5 * * * *",
    );
    const reserva = () => scalar("select sicredi_tarifas_reservar_280('secret')");
    const hoje = await scalar("select current_date::text");
    const bAntes = (await db.query("select * from boletos order by id")).rows;
    let r = await reserva();
    assert.equal(r.dia, hoje);
    assert.equal(await scalar("select count(*) from sicredi_tarifas_fila_280"), 121);
    assert.deepEqual(await reserva(), {});
    const item = (numero, descricao, valor) => ({
      cooperativa: "0165",
      posto: "02",
      beneficiario: "00623",
      dia: r.dia,
      nosso_numero: numero,
      descricao,
      valor,
    });
    const itens = [
      item("600000228", "TARIFA LIQUIDACAO", 1.63),
      item("600000229", "TARIFA ALTERACAO", 0.25),
      item("600000230", "TARIFA DE BAIXA", 1.02),
      item("600000231", "TARIFA CONCESSAO DESCONTO", 0.53),
    ];
    assert.equal(
      await scalar("select sicredi_tarifas_finalizar_280($1,$2,null)", [
        r.lease,
        JSON.stringify(itens),
      ]),
      4,
    );
    assert.equal(
      Number(
        await scalar(
          "select tarifa_total from sicredi_tarifas_api_280 where boleto_id=$1 and data_lancamento=current_date",
          [id(43)],
        ),
      ),
      0.53,
    );
    assert.equal(
      Number(
        await scalar(
          "select tarifa_total from sicredi_tarifas_api_280 where boleto_id=$1 and data_lancamento=current_date",
          [id(42)],
        ),
      ),
      1.02,
    );
    const espera = Number(
      await scalar(
        "select extract(epoch from proxima_consulta-now()) from sicredi_tarifas_fila_280 where dia=current_date",
      ),
    );
    assert.ok(espera >= 598 && espera <= 602);
    await assert.rejects(
      () =>
        scalar("select sicredi_tarifas_finalizar_280($1,$2,null)", [
          r.lease,
          JSON.stringify(itens),
        ]),
      /expirada/,
    );
    r = await reserva();
    assert.equal(r.dia, await scalar("select (current_date-1)::text"));
    await scalar("select sicredi_tarifas_finalizar_280($1,'[]',null)", [r.lease]);
    assert.ok(
      Number(
        await scalar(
          "select extract(epoch from proxima_consulta-now()) from sicredi_tarifas_fila_280 where dia=current_date-1",
        ),
      ) >= 1798,
    );
    await db.exec(
      "update sicredi_tarifas_fila_280 set proxima_consulta=now()+interval '1 day' where dia<>current_date-120",
    );
    r = await reserva();
    assert.equal(r.dia, await scalar("select (current_date-120)::text"));
    await scalar("select sicredi_tarifas_finalizar_280($1,'[]',null)", [r.lease]);
    assert.equal(Number(await scalar("select valor from movimentos_financeiros")), 100);
    assert.deepEqual((await db.query("select * from boletos order by id")).rows, bAntes);
    assert.equal(
      await scalar("select sicredi_despesa_identificada_347('TARIFA CANCELAMENTO ABATIMENTO')"),
      true,
    );
    assert.equal(
      await scalar("select sicredi_despesa_identificada_347('ESTORNO DE TARIFA')"),
      false,
    );
    console.log(
      "Tarifas350 OK: emissão/liquidação/alteração/baixa/cancelamento/desconto, boleto baixado/cancelado incluído, hoje prioritário, ciclos5min, intervalos10/30min, histórico120dias sem truncar, lease, snapshots completos e financeiro preservado.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
