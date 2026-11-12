// node scripts/check-sicoob-tarifas-355.cjs --confirmacao
// Funções reais316/351/358/362 em PostgreSQL descartável; nenhuma comunicação com banco externo.
const fs = require("node:fs"),
  assert = require("node:assert/strict");
module.exports = async ({ db, q, scalar, id, hoje }) => {
  await db.exec(
    "update sicoob_config_316 set ativo=true,autenticado_versao=versao where ambiente='producao';update cobranca_centros set ativo=true where banco='sicoob'",
  );
  await q(
    "insert into contas_receber(id,centro_id,cliente_id,status,documento,parcela,valor,vencimento) values($1,$2,$3,'aberto','Antigo',1,25,current_date+3)",
    [id(499), id(10), id(20)],
  );
  const payloadAntigo = {
    numeroCliente: 12345,
    numeroContaCorrente: 67890,
    valor: 25,
    dataVencimento: await scalar("select (current_date+3)::text"),
    pagador: { numeroCpfCnpj: "11122233300" },
  };
  const versaoAntiga = await scalar(
    "select versao from sicoob_config_316 where ambiente='producao'",
  );
  const antes362 = await scalar("select sicoob_reservar_emissao_351($1,$2,$3,$4)", [
    id(1),
    id(499),
    payloadAntigo,
    versaoAntiga,
  ]);
  assert.match(antes362.boleto.seu_numero, /^[a-f0-9]{18}$/);
  await db.exec(fs.readFileSync("db/fase358_sicoob_consulta_automatica.sql", "utf8"));
  const migration = fs.readFileSync("db/fase362_sicoob_confirmacao_emissao.sql", "utf8");
  await db.exec(migration);
  await db.exec(migration);
  const depois362 = await scalar("select sicoob_reservar_emissao_351($1,$2,$3,$4)", [
    id(1),
    id(499),
    payloadAntigo,
    versaoAntiga,
  ]);
  assert.equal(depois362.recuperar, true);
  assert.equal(depois362.boleto.seu_numero, antes362.boleto.seu_numero);

  await db.exec(
    "update sicoob_config_316 set ativo=true,autenticado_versao=versao where ambiente='producao';update cobranca_centros set ativo=true where banco='sicoob'",
  );
  await q(
    "insert into contas_receber(id,centro_id,cliente_id,status,documento,parcela,valor,vencimento) values($1,$2,$3,'aberto','Teste2',1,25,current_date+3)",
    [id(500), id(10), id(20)],
  );
  const payload = {
    numeroCliente: 12345,
    numeroContaCorrente: 67890,
    valor: 25,
    dataVencimento: await scalar("select (current_date+3)::text"),
    pagador: { numeroCpfCnpj: "11122233300" },
  };
  const versao = await scalar("select versao from sicoob_config_316 where ambiente='producao'");
  const reservarEmissao = () =>
    scalar("select sicoob_reservar_emissao_351($1,$2,$3,$4)", [id(1), id(500), payload, versao]);
  const antes = await q("select to_jsonb(t) from contas_receber t order by id");
  const r = await reservarEmissao();
  assert.equal(r.recuperar, false);
  assert.equal(r.boleto.seu_numero, "Teste2/1");
  assert.equal(r.operacao.requisicao.seuNumero, "Teste2/1");
  assert.match(r.operacao.requisicao.identificacaoBoletoEmpresa, /^[a-f0-9]{25}$/);
  assert.equal(
    r.boleto.sicoob_snapshot_316.identificacao_empresa,
    r.operacao.requisicao.identificacaoBoletoEmpresa,
  );
  const novamente = await reservarEmissao();
  assert.equal(novamente.recuperar, true);
  assert.equal(novamente.boleto.id, r.boleto.id);
  const segredo = await scalar("select segredo from sicoob_auto_config_358");
  const reservar = async () => {
    await db.exec("update sicoob_auto_config_358 set bloqueado_ate=null");
    return scalar("select sicoob_auto_reservar_358($1)", [segredo]);
  };
  // Reservado mas não enviado fica fora: não consulta uma cobrança nunca solicitada.
  assert.equal((await reservar()).itens.length, 0);
  assert.equal(await scalar("select sicoob_enviar_316($1,$2)", [id(1), r.operacao.id]), true);
  let lote = await reservar();
  assert.equal(lote.itens.length, 1);
  assert.equal(lote.itens[0].recuperar_emissao, true);
  assert.equal(lote.itens[0].nosso_numero, null);
  assert.equal(lote.itens[0].seu_numero, "Teste2/1");
  assert.equal(lote.itens[0].vencimento_emissao, payload.dataVencimento);
  assert.equal(
    lote.itens[0].identificacao_empresa,
    r.operacao.requisicao.identificacaoBoletoEmpresa,
  );
  const banco = {
    nossoNumero: "3850",
    numeroCliente: 12345,
    codigoModalidade: 1,
    seuNumero: "Teste2/1",
    identificacaoBoletoEmpresa: r.operacao.requisicao.identificacaoBoletoEmpresa,
    valor: 25,
    vencimento: payload.dataVencimento,
    abatimento: 0,
    tipoDesconto: 0,
    descontos: [],
    situacao: "EM ABERTO",
    linhaDigitavel: "756" + "0".repeat(44),
    codigoBarras: "756" + "0".repeat(41),
  };
  const finalizar = (d) =>
    q("select sicoob_auto_finalizar_358($1,$2,$3,null,null)", [lote.lease, r.boleto.id, d]);
  await assert.rejects(() => finalizar({ ...banco, valor: 50 }), /não corresponde/);
  await assert.rejects(() => finalizar({ ...banco, seuNumero: "outro" }), /não corresponde/);
  await assert.rejects(
    () => finalizar({ ...banco, identificacaoBoletoEmpresa: "outro" }),
    /empresa divergente/,
  );
  await assert.rejects(
    () => q("select sicoob_auto_finalizar_358($1,$2,$3,null,null)", [id(999), r.boleto.id, banco]),
    /Reserva expirada/,
  );
  await finalizar(banco);
  const b = (await q("select * from boletos where id=$1", [r.boleto.id]))[0];
  assert.equal(b.status, "registrado");
  assert.equal(b.nosso_numero, "3850");
  assert.equal(b.sicoob_pendente_316, null);
  assert.equal(
    await scalar("select estado from sicoob_operacoes_316 where id=$1", [r.operacao.id]),
    "confirmado",
  );
  assert.deepEqual(await q("select to_jsonb(t) from contas_receber t order by id"), antes);
  assert.equal((await reservar()).itens.length, 0);
  assert.equal(
    Number(
      await scalar("select count(*) from sicoob_operacoes_316 where boleto_id=$1", [r.boleto.id]),
    ),
    1,
  );
  // Reinstalar/recuperar não troca referência dos antigos nem duplica a reserva.
  const antigo = await scalar("select seu_numero from boletos where id=$1", [id(210)]);
  await db.exec(migration);
  assert.equal(await scalar("select seu_numero from boletos where id=$1", [id(210)]), antigo);
  assert.equal((await reservarEmissao()).boleto.seu_numero, "Teste2/1");
  // Outro documento longo falha antes de qualquer envio: não trunca nem inventa outra referência.
  await q(
    "insert into contas_receber(id,centro_id,cliente_id,status,documento,parcela,valor,vencimento) values($1,$2,$3,'aberto','DOCUMENTO-MUITO-LONGO-123',1,25,current_date+3)",
    [id(501), id(10), id(20)],
  );
  await assert.rejects(
    () => q("select sicoob_reservar_emissao_351($1,$2,$3,$4)", [id(1), id(501), payload, versao]),
    /18 caracteres/,
  );
  assert.equal(
    Number(await scalar("select count(*) from boletos where conta_receber_id=$1", [id(501)])),
    0,
  );
  assert.equal(
    await scalar(
      "select has_function_privilege('authenticated','sicoob_auto_reservar_358(text)','execute')",
    ),
    false,
  );
  console.log(
    "OK362: documento/parcela, identificador técnico separado, reservado excluído, envio único, recuperação GET, confirmação estrita real316, valor/identidade/lease protegidos, legado e financeiro preservados.",
  );
};
