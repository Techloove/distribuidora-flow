// Invocar: node scripts/check-sicoob-tarifas-355.cjs --liqui
// Usa a fixture355 com o lançador financeiro real; nenhum banco externo é acessado.
const fs = require("node:fs"),
  assert = require("node:assert/strict");
module.exports = async ({ db, q, scalar, id, finalizar, fee, hoje }) => {
  await db.exec(`alter table boletos add column sicoob_recebimento_359 jsonb, add column valor_liquidado numeric,add column data_liquidacao date;
 alter table contas_receber add column conta_financeira_id uuid;
 create table sicoob_liqui_eventos_359(centro_id uuid,chave text,boleto_id uuid,dados jsonb,estado text);
 update sicoob_config_316 set ativo=true,autenticado_versao=versao where ambiente='producao';
 update cobranca_centros set ativo=true where banco='sicoob';`);
  const sql = fs.readFileSync("db/fase361_sicoob_tarifa_liqui.sql", "utf8");
  await db.exec(sql);
  await db.exec(sql);

  const antes = Number(await scalar("select count(*) from movimentos_financeiros"));
  const processar = () => scalar("select sicoob_tarifas_liqui_processar_361()");
  const criar = async (n, changes = {}) => {
    const dados = {
      numeroConta: "67890",
      numeroCliente: "12345",
      nossoNumero: String(n),
      seuNumero: "erp-" + n,
      codigoBarras: "756" + String(n).padStart(41, "0"),
      data: hoje,
      dataMovimento: hoje,
      valor: 50,
      nominal: 50,
      tarifa: 1.44,
      chave: String(n).padStart(64, "0"),
    };
    Object.assign(dados, changes);
    await q(
      "insert into contas_receber(id,centro_id,status,valor,valor_pago,conta_financeira_id) values($1,$2,'pago',50,50,$3)",
      [id(n + 1000), id(10), id(70)],
    );
    await q(
      "insert into boletos(id,conta_receber_id,centro_id,banco,canal,ambiente,status,nosso_numero,seu_numero,codigo_barras,valor,data_emissao,conta_cobranca_id,sicoob_snapshot_316,sicoob_recebimento_359,valor_liquidado,data_liquidacao) values($1,$2,$3,'sicoob','api','producao','liquidado',$4,$5,$6,50,current_date,$7,$8,$9,50,current_date)",
      [
        id(n),
        id(n + 1000),
        id(10),
        String(n),
        dados.seuNumero,
        dados.codigoBarras,
        id(70),
        { numero_conta: 67890, numero_cliente: 12345 },
        dados,
      ],
    );
    await q(
      "insert into sicoob_operacoes_316(boleto_id,centro_id,tipo,estado,chave,esperado,requisicao,motivo,created_by) values($1,$2,'emissao','confirmado',gen_random_uuid(),'{}','{}','Fixture ERP',$3)",
      [id(n), id(10), id(1)],
    );
    await q("insert into sicoob_liqui_eventos_359 values($1,$2,$3,$4,'baixado')", [
      id(10),
      dados.chave,
      id(n),
      dados,
    ]);
    return dados;
  };
  const estado = (n) =>
    scalar(
      "select estado from sicoob_tarifas_financeiro_355 where boleto_id=$1 and fonte_361='liqui'",
      [id(n)],
    );
  await criar(300);
  const tituloAntes = await q("select to_jsonb(t) from contas_receber t order by id");
  assert.equal(
    (await processar()).lancados,
    1,
    JSON.stringify(await q("select erro_liqui_361 from sicoob_tarifas_config_355")),
  );
  assert.equal(Number(await scalar("select count(*) from movimentos_financeiros")), antes + 1);
  assert.deepEqual(await q("select to_jsonb(t) from contas_receber t order by id"), tituloAntes);
  const m = (
    await q(
      "select m.*,t.fonte_361 from movimentos_financeiros m join sicoob_tarifas_financeiro_355 t on t.movimento_id=m.id where t.boleto_id=$1",
      [id(300)],
    )
  )[0];
  assert.equal(Number(m.valor), 1.44);
  assert.equal(m.conta_id, id(70));
  assert.equal(m.categoria_id, id(201));
  assert.equal(m.tipo, "saida");
  assert.equal(m.origem, "despesa");
  assert.equal(m.fonte_361, "liqui");
  assert.equal(m.data.toISOString().slice(0, 10), hoje);
  assert.equal((await processar()).lancados, 0);
  assert.equal(
    (await finalizar([{ ...fee("generic-pos-liqui", "300", 1.44), descricao: "TARIFA COBRANÇA" }]))
      .conferir,
    1,
  );
  assert.equal(Number(await scalar("select count(*) from movimentos_financeiros")), antes + 1);
  // Débito agrupado sem nosso número permanece excluído; não reparte 2,88.
  assert.equal(
    (await finalizar([{ ...fee("agrupado-288", "", 2.88), descricao: "TARIFA COBRANÇA" }]))
      .lancados,
    0,
  );
  for (const [i, descricao] of [
    "TARIFA ALTERAÇÃO VENCIMENTO",
    "TARIFA ABATIMENTO",
    "TARIFA BAIXA / CANCELAMENTO",
  ].entries()) {
    assert.equal(
      (await finalizar([{ ...fee("outra-operacao-" + i, "300", 0.11 + i / 100), descricao }]))
        .lancados,
      1,
    );
  }
  // Também protege a ordem inversa: extrato primeiro, LIQUI depois.
  const dados301 = await criar(301);
  await q("update boletos set sicoob_recebimento_359=null where id=$1", [id(301)]);
  assert.equal(
    (
      await finalizar([
        { ...fee("extrato-antes-liqui", "301", 1.44), descricao: "TARIFA LIQUIDAÇÃO" },
      ])
    ).lancados,
    1,
  );
  await q("update boletos set sicoob_recebimento_359=$2 where id=$1", [id(301), dados301]);
  assert.equal((await processar()).lancados, 0);
  assert.equal(await estado(301), "conferir_liqui");
  // Despesa manual de mesmo valor, data, conta exige conferência, sem reaproveitá-la por suposição.
  await criar(302, { tarifa: 2.22 });
  await q(
    "insert into movimentos_financeiros(conta_id,data,tipo,valor,centro_id) values($1,current_date,'saida',2.22,$2)",
    [id(70), id(10)],
  );
  assert.equal((await processar()).lancados, 0);
  assert.equal(await estado(302), "conferir_liqui");
  // Mudança posterior no retorno ou estorno não autoriza relançar.
  await q(
    "update boletos set sicoob_recebimento_359=jsonb_set(sicoob_recebimento_359,'{tarifa}','1.55') where id=$1",
    [id(300)],
  );
  assert.equal((await processar()).lancados, 0);
  assert.equal(await estado(300), "retorno_divergente");
  await q("update movimentos_financeiros set status='estornado' where id=$1", [m.id]);
  assert.equal((await processar()).lancados, 0);
  // Pausa e categoria inativa impedem criação; retomar recupera o recebimento anterior.
  await criar(303);
  await db.exec("update sicoob_tarifas_config_355 set ativo=false");
  assert.equal((await processar()).lancados, 0);
  await db.exec(
    "update sicoob_tarifas_config_355 set ativo=true;update categorias_financeiras set ativo=false",
  );
  assert.equal((await processar()).lancados, 0);
  assert.match(
    await scalar("select erro_liqui_361 from sicoob_tarifas_config_355"),
    /NAO_CONCLUIDA/,
  );
  await db.exec("update categorias_financeiras set ativo=true");
  assert.equal((await processar()).lancados, 1);
  // Sem emissão confirmada, sandbox, Sicredi, data antiga e conta divergente não geram despesa.
  for (const n of [304, 305, 306, 307, 308, 309, 310]) await criar(n);
  await q("update sicoob_operacoes_316 set estado='recusado' where boleto_id=$1", [id(304)]);
  await q("update boletos set ambiente='homologacao' where id=$1", [id(305)]);
  await q("update boletos set banco='sicredi' where id=$1", [id(306)]);
  await q("update boletos set data_emissao=current_date-1 where id=$1", [id(307)]);
  await q("update boletos set conta_cobranca_id=$2 where id=$1", [id(308), id(71)]);
  await q("delete from sicoob_liqui_eventos_359 where boleto_id=$1", [id(309)]);
  await q("update sicoob_liqui_eventos_359 set estado='conferir' where boleto_id=$1", [id(310)]);
  assert.equal((await processar()).lancados, 0);
  assert.equal(
    Number(
      await scalar(
        "select count(*) from sicoob_tarifas_financeiro_355 where fonte_361='liqui' and movimento_id is not null",
      ),
    ),
    2,
  );
  assert.equal(
    await scalar(
      "select has_function_privilege('authenticated','sicoob_tarifas_liqui_processar_361(uuid,int)','execute')",
    ),
    false,
  );
  assert.equal(
    await scalar(
      "select has_function_privilege('authenticated','sicoob_tarifas_liqui_cron_361()','execute')",
    ),
    false,
  );
  assert.equal(
    await scalar(
      "select has_table_privilege('authenticated','sicoob_tarifas_financeiro_355','insert')",
    ),
    false,
  );
  assert.equal(
    await scalar("select count(*)::int from cron.job where jobname='sicoob-tarifa-liqui-361'"),
    1,
  );
  // O job usa as mesmas regras e a leitura financeira respeita a loja pelo RLS.
  await q("select set_config('test.jwtrole','authenticated',false)");
  await assert.rejects(processar, /exclusiva do servidor/);
  await q("select set_config('test.jwtrole','',false)");
  await db.exec("select sicoob_tarifas_liqui_cron_361()");
  for (const [ator, esperado] of [
    [id(2), true],
    [id(3), false],
  ]) {
    await q("select set_config('test.actor',$1,false)", [ator]);
    await db.exec("set role authenticated");
    assert.equal(
      Number(await scalar("select count(*) from sicoob_tarifas_financeiro_355")) > 0,
      esperado,
    );
    await db.exec("reset role");
  }
  await q("select set_config('test.actor','',false)");
  if (process.argv.includes("--posterior")) {
    await db.exec(`create table sicoob_liqui_jobs_359(id uuid,centro_id uuid,actor uuid,numero_cliente bigint,numero_conta bigint,contrato bigint,conta_id uuid,inicio date,fim date);
      create function sicoob_liqui_validar_359(sicoob_liqui_jobs_359) returns void language plpgsql as $$begin return;end$$;
      insert into sicoob_liqui_jobs_359 values('${id(900)}','${id(10)}','${id(1)}',12345,67890,null,'${id(70)}',current_date,current_date);`);
    const migration = fs.readFileSync("db/fase366_sicoob_tarifa_posterior.sql", "utf8");
    const start = migration.indexOf(
      "create or replace function public.sicoob_atualizar_tarifa_366(",
    );
    await db.exec(migration.slice(start, migration.indexOf("end $$;", start) + 7));
    const zero = await criar(320, { tarifa: 0 });
    const antesPosterior = Number(await scalar("select count(*) from movimentos_financeiros"));
    const receberAntes = await q("select to_jsonb(t) from contas_receber t order by id");
    assert.equal((await processar()).lancados, 0);
    assert.equal(
      await scalar("select sicoob_atualizar_tarifa_366(j,$1) from sicoob_liqui_jobs_359 j", [
        { ...zero, tarifa: 1.44 },
      ]),
      true,
    );
    assert.equal((await processar()).lancados, 1);
    assert.equal(
      Number(await scalar("select count(*) from movimentos_financeiros")),
      antesPosterior + 1,
    );
    assert.equal((await processar()).lancados, 0);
    assert.deepEqual(await q("select to_jsonb(t) from contas_receber t order by id"), receberAntes);
    assert.equal(await estado(320), "lancado");
    const ausente = await criar(321, { tarifa: null });
    assert.equal((await processar()).lancados, 0);
    assert.equal(
      await scalar("select sicoob_atualizar_tarifa_366(j,$1) from sicoob_liqui_jobs_359 j", [
        { ...ausente, tarifa: 1.44 },
      ]),
      true,
    );
    assert.equal((await processar()).lancados, 1);
    assert.equal((await processar()).lancados, 0);
    console.log(
      "OK366/361: tarifa posterior gera uma única saída com o lançador real e conserva os recebimentos.",
    );
  }
  console.log(
    "OK361: LIQUI individual, recuperação, conta/categoria/data, idempotência, extrato nas duas ordens, agrupados excluídos, outras operações preservadas, manual/estorno/divergência/pausa/legado/Sicredi protegidos.",
  );
};
