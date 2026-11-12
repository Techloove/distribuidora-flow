// Chamado pela fixture LIQUI359 com --rapido. Não faz chamadas bancárias.
const fs = require("node:fs"),
  assert = require("node:assert/strict");
module.exports = async ({ db, id }) => {
  await db.exec(`alter table boletos add column retorno jsonb;
 create table sicoob_confirmacao_instalada_362(id boolean);
 alter table cron.job add column jobid bigint,add column schedule text,add column active boolean;
 insert into cron.job values('sicoob-liqui-359',1,'*/5 * * * *',false);
 create function cron.alter_job(job_id bigint,schedule text) returns void language sql as $$update cron.job set schedule=$2 where jobid=$1$$;
 alter table sicoob_auto_fila_358 add column proxima_consulta timestamptz default now(),add column lease uuid,add column lease_ate timestamptz,add column actor uuid,add column config_versao int,add column resultado text,add column diagnostico jsonb;`);
  const sql = fs.readFileSync("db/fase363_sicoob_consulta_rapida.sql", "utf8");
  await db.exec(sql);
  await db.exec(sql);
  const job = (await db.query("select schedule,active from cron.job where jobid=1")).rows[0];
  assert.equal(job.schedule, "* * * * *");
  assert.equal(job.active, false);
  const lease = id(80);
  const banco = { nossoNumero: "3849", situacao: "EM ABERTO" };
  await db.query(
    "insert into sicoob_auto_fila_358(boleto_id,lease,lease_ate,actor,config_versao,erros) values($1,$2,now()+interval '3 minutes',$3,1,0)",
    [id(4), lease, id(1)],
  );
  await db.query("update boletos set retorno=$1 where id=$2", [banco, id(4)]);
  await db.query("select sicoob_auto_finalizar_358($1,$2,$3)", [lease, id(4), banco]);
  assert.equal(
    (
      await db.query(
        "select proxima_consulta=date_trunc('minute',ultima_consulta)+interval '5 minutes' as ok from sicoob_auto_fila_358",
      )
    ).rows[0].ok,
    true,
  );
  const liquidado = { ...banco, situacao: "LIQUIDADO" };
  await db.query("update boletos set retorno=$1 where id=$2", [liquidado, id(4)]);
  await db.query("update sicoob_auto_fila_358 set lease=$1,lease_ate=now()+interval '3 minutes'", [
    lease,
  ]);
  await db.query("select sicoob_auto_finalizar_358($1,$2,$3)", [lease, id(4), liquidado]);
  assert.equal(
    (
      await db.query(
        "select proxima_consulta=date_trunc('minute',ultima_consulta)+interval '6 hours' as ok from sicoob_auto_fila_358",
      )
    ).rows[0].ok,
    true,
  );
  await db.exec("delete from sicoob_auto_fila_358;update boletos set retorno=null");
  console.log(
    "OK363: cron LIQUI por minuto, ativação preservada, abertos em cinco minutos, já liquidados em seis horas; validações originais preservadas.",
  );
};
