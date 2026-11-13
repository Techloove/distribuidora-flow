// Usa o coletor, o receber_titulo e as validações reais da fixture359. Nenhuma chamada externa.
const fs = require("node:fs"),
  assert = require("node:assert/strict");
module.exports = async ({ db, id, reserve, step, apply, seguinte }) => {
  await db.exec("update sicoob_liqui_config_359 set ativo=true");
  let job = seguinte;
  const continuar = async (j, arquivo) => {
    await step(j, "solicitacao", { codigo: 200 });
    await db.exec("update sicoob_liqui_jobs_359 set proxima=now()");
    j = await reserve();
    await step(j, "arquivos", { ids: [arquivo] });
    return reserve();
  };
  job = await continuar(job, 201);
  const recebido = {
    numeroCliente: "123",
    numeroConta: "456",
    nossoNumero: "3851",
    seuNumero: "Teste3/1",
    codigoBarras: "756" + "1".repeat(41),
    contratoCobranca: null,
    data: job.inicio,
    dataMovimento: job.inicio,
    nominal: 11,
    valor: 11,
    mora: 0,
    desconto: 0,
    abatimento: 0,
    tarifa: 0,
    chave: "d".repeat(64),
  };
  await apply(job, 201, [recebido]);
  const entradas = (await db.query("select * from movimentos_financeiros")).rows;
  await db.exec("update sicoob_liqui_config_359 set proxima_consulta=now()");
  assert.deepEqual(await reserve(), {}); // reproduz a lacuna: todos os recebimentos encerrados.
  await db.exec(`create table sicoob_tarifas_config_355(centro_id uuid,ativo boolean,inicio date);
 insert into sicoob_tarifas_config_355 values('${id(2)}',true,current_date-30);
 create function sicoob_tarifas_liqui_processar_361(uuid default null,integer default 100) returns jsonb language sql as $$select '{}'::jsonb$$;`);
  const sql = fs.readFileSync("db/fase366_sicoob_tarifa_posterior.sql", "utf8");
  await db.exec(sql);
  await db.exec(sql);
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('authenticated','sicoob_liqui_reservar_359(text)','execute') ok",
      )
    ).rows[0].ok,
    false,
  );
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('authenticated','sicoob_atualizar_tarifa_366(sicoob_liqui_jobs_359,jsonb)','execute') ok",
      )
    ).rows[0].ok,
    false,
  );
  await db.exec(`create table disparos366(id bigint generated always as identity);
    create or replace function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language plpgsql as $$begin insert into disparos366 default values; return 1;end$$;
    select sicoob_liqui_disparar_359();`);
  assert.equal((await db.query("select count(*)::int n from disparos366")).rows[0].n, 1);
  job = await reserve();
  assert.equal(job.estado, "solicitar");
  assert.equal(job.revisao_tarifas_366, true);
  job = await continuar(job, 202);
  assert.equal(
    (await apply(job, 202, [{ ...recebido, tarifa: 1.44 }])).rows[0].r.tarifasAtualizadas,
    1,
  );
  assert.deepEqual((await db.query("select * from movimentos_financeiros")).rows, entradas);
  assert.equal(
    Number(
      (await db.query("select valor_pago from contas_receber where id=$1", [id(20)])).rows[0]
        .valor_pago,
    ),
    11,
  );
  const salvo = (
    await db.query("select sicoob_recebimento_359 d from boletos where id=$1", [id(21)])
  ).rows[0].d;
  assert.equal(salvo.tarifa, 1.44);
  assert.deepEqual(
    (await db.query("select dados from sicoob_liqui_eventos_359 where chave=$1", [recebido.chave]))
      .rows[0].dados,
    salvo,
  );
  // Novo arquivo do mesmo pagamento não duplica nem o recebimento nem a complementação.
  await db.query(
    "update sicoob_liqui_jobs_359 set estado='baixar',arquivos='{203}',feitos='{}',lease=gen_random_uuid(),lease_ate=now()+interval '3 minutes' where id=$1",
    [job.id],
  );
  job = (await db.query("select * from sicoob_liqui_jobs_359 where id=$1", [job.id])).rows[0];
  assert.equal(
    (await apply(job, 203, [{ ...recebido, tarifa: 1.44 }, recebido])).rows[0].r.tarifasAtualizadas,
    0,
  );
  assert.equal(
    (await db.query("select sicoob_recebimento_359 d from boletos where id=$1", [id(21)])).rows[0].d
      .tarifa,
    1.44,
  );
  assert.deepEqual((await db.query("select * from movimentos_financeiros")).rows, entradas);
  // Mudança de tarifa positiva exige conferência; preserva a tarifa e o recebimento anteriores.
  await db.query(
    "update sicoob_liqui_jobs_359 set estado='baixar',arquivos='{204}',feitos='{}',lease=gen_random_uuid(),lease_ate=now()+interval '3 minutes' where id=$1",
    [job.id],
  );
  job = (await db.query("select * from sicoob_liqui_jobs_359 where id=$1", [job.id])).rows[0];
  assert.equal((await apply(job, 204, [{ ...recebido, tarifa: 2.88 }])).rows[0].r.conferir, 1);
  assert.equal(
    (await db.query("select sicoob_recebimento_359 d from boletos where id=$1", [id(21)])).rows[0].d
      .tarifa,
    1.44,
  );
  // Revisões de zero são limitadas e só nas emissões ERP/lojas configuradas.
  await db.query(
    "update boletos set sicoob_recebimento_359=$1,sicoob_tarifa_consultada_366=now() where id=$2",
    [recebido, id(21)],
  );
  assert.equal(
    (await db.query("select sicoob_revisar_tarifa_366(b) ok from boletos b where id=$1", [id(21)]))
      .rows[0].ok,
    false,
  );
  await db.query(
    "update boletos set sicoob_tarifa_consultada_366=now()-interval '7 hours' where id=$1",
    [id(21)],
  );
  assert.equal(
    (await db.query("select sicoob_revisar_tarifa_366(b) ok from boletos b where id=$1", [id(21)]))
      .rows[0].ok,
    true,
  );
  await db.exec("update sicoob_tarifas_config_355 set ativo=false");
  assert.equal(
    (await db.query("select sicoob_revisar_tarifa_366(b) ok from boletos b where id=$1", [id(21)]))
      .rows[0].ok,
    false,
  );
  console.log(
    "OK366: reproduz parada após liquidação; reconsulta zero, tarifa posterior sem nova entrada, idempotência, divergência e intervalo de seis horas.",
  );
};
