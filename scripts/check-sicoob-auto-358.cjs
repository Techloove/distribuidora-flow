const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.role() returns text language sql as $$select 'service_role'::text$$;
create schema cron;create table cron.job(jobname text);create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
create schema net;create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language sql as $$select 1::bigint$$;
create table profiles(id uuid primary key,ativo bool,precisa_completar_cadastro bool);insert into profiles values('${id(1)}',true,false);
create function has_role(uuid,text) returns bool language sql as $$select true$$;create function ator_financeiro_pode_acessar_centro(uuid,uuid) returns bool language sql as $$select true$$;
create function validar_sicoob_316(uuid,uuid) returns void language plpgsql as $$begin if $1 is null then raise exception 'ator';end if;end$$;
create table sicoob_config_316(centro_id uuid,ambiente text,ativo bool,autenticado_versao int,versao int,numero_cliente bigint,numero_conta bigint,numero_contrato bigint);
insert into sicoob_config_316 values('${id(2)}','producao',true,1,1,4163036,2016001,null);
create table cobranca_centros(centro_id uuid,banco text,canal text,ativo bool);insert into cobranca_centros values('${id(2)}','sicoob','api',true);
create table boletos(id uuid primary key,centro_id uuid,banco text,canal text,ambiente text,status text,nosso_numero text,sicoob_snapshot_316 jsonb,retorno jsonb,sicoob_pendente_316 uuid,vencimento date);
create table sicoob_operacoes_316(boleto_id uuid references boletos(id),tipo text,estado text);
create table chamadas(id uuid);create function sicoob_sincronizar_316(uuid,uuid,jsonb) returns jsonb language plpgsql as $$begin insert into chamadas values($2);update boletos set status=case when $3->>'situacao'='LIQUIDADO' then 'liquidado' else 'registrado' end,retorno=$3 where id=$2;return '{}';end$$;
insert into boletos values('${id(3)}','${id(2)}','sicoob','api','producao','registrado','3849','{"numero_cliente":4163036,"numero_conta":2016001}',null,null,'2028-12-31');
insert into sicoob_operacoes_316 values('${id(3)}','emissao','confirmado');
insert into boletos select '${id(4)}',centro_id,'sicredi',canal,ambiente,status,'4',sicoob_snapshot_316,null,null,vencimento from boletos where id='${id(3)}';
insert into boletos select '${id(5)}',centro_id,banco,canal,'homologacao',status,'5',sicoob_snapshot_316,null,null,vencimento from boletos where id='${id(3)}';
insert into boletos select '${id(6)}',centro_id,banco,canal,ambiente,status,'6',sicoob_snapshot_316,null,null,vencimento from boletos where id='${id(3)}';`);
    await db.exec(fs.readFileSync("db/fase358_sicoob_consulta_automatica.sql", "utf8"));
    await assert.rejects(
      () => db.query("select sicoob_auto_reservar_358('errado')"),
      /não autorizado/,
    );
    const secret = (await db.query("select segredo from sicoob_auto_config_358")).rows[0].segredo;
    const reserva = async () => {
      await db.exec("update sicoob_auto_config_358 set bloqueado_ate=null");
      return (await db.query("select sicoob_auto_reservar_358($1) as r", [secret])).rows[0].r;
    };
    let r = await reserva();
    assert.equal(r.itens.length, 1);
    assert.equal(r.itens[0].nosso_numero, "3849");
    assert.equal((await reserva()).itens.length, 0);
    await db.query("select sicoob_auto_finalizar_358($1,$2,null,null,$3)", [
      r.lease,
      id(3),
      "HTTP_403",
    ]);
    assert.equal(
      (await db.query("select status from boletos where id=$1", [id(3)])).rows[0].status,
      "registrado",
    );
    assert.equal((await db.query("select * from chamadas")).rows.length, 0);
    await db.exec("update sicoob_auto_fila_358 set proxima_consulta=now()");
    r = await reserva();
    await assert.rejects(
      () =>
        db.query("select sicoob_auto_finalizar_358($1,$2,$3,null,null)", [
          id(99),
          id(3),
          { nossoNumero: "3849", situacao: "LIQUIDADO" },
        ]),
      /expirada/,
    );
    const banco = { nossoNumero: "3849", situacao: "LIQUIDADO" };
    await db.query("select sicoob_auto_finalizar_358($1,$2,$3,$4,null)", [
      r.lease,
      id(3),
      banco,
      { valores: { valorPago: 50 } },
    ]);
    assert.equal(
      (await db.query("select status from boletos where id=$1", [id(3)])).rows[0].status,
      "liquidado",
    );
    assert.equal((await db.query("select * from chamadas")).rows.length, 1);
    await db.exec("update sicoob_auto_fila_358 set proxima_consulta=now()");
    r = await reserva();
    await db.query("select sicoob_auto_finalizar_358($1,$2,$3,null,null)", [r.lease, id(3), banco]);
    assert.equal((await db.query("select * from chamadas")).rows.length, 1);
    await db.exec("update sicoob_auto_fila_358 set proxima_consulta=now()");
    r = await reserva();
    await db.exec("update sicoob_config_316 set versao=2");
    await assert.rejects(
      () =>
        db.query("select sicoob_auto_finalizar_358($1,$2,$3,null,null)", [r.lease, id(3), banco]),
      /mudou/,
    );
    console.log(
      "Sicoob358: futuro incluído; outros bancos, sandbox e emissões externas excluídos; segredo/lease/versão validados; 403 preserva estado; repetição não sincroniza outra vez.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
