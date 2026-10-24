const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const assert = require("node:assert/strict");
module.exports = async (db, id) => {
  const nota = id(7),
    actor = id(1);
  const owner = () => db.exec("reset role");
  const user = () =>
    db.exec("reset role;set teste.jwt_role='authenticated';set role authenticated");
  const service = () =>
    db.exec("reset role;set teste.jwt_role='service_role';set role service_role");
  const sql = readFileSync("db/fase267_documentos_homologacao_forecast.sql", "utf8");
  await db.exec(sql);
  await db.exec(sql);
  await db.query(
    `update forecast_homologacoes_266 set payload=payload||'{"valor_total":"100.00"}'::jsonb where nota_id=$1`,
    [nota],
  );
  const job = (await db.query("select * from forecast_homologacoes_266 where nota_id=$1", [nota]))
    .rows[0];
  const proof = {
    chave: job.resultado.chave,
    protocolo: job.resultado.protocolo,
    numero: "1",
    serie: job.serie,
    cnpj: job.cnpj,
    valor_total: "100.00",
    ambiente: "homologacao",
    validacao: "estrutura_identidade_sem_assinatura",
  };
  assert.ok(proof.chave);
  assert.ok(proof.protocolo);
  const snapshot = async () =>
    (
      await db.query(
        `select (select jsonb_agg(to_jsonb(n)) from notas_saida n) notas,(select jsonb_agg(to_jsonb(p)) from pedidos p) pedidos,(select jsonb_agg(to_jsonb(i)) from pedido_itens i) itens,(select jsonb_agg(to_jsonb(c)) from contas_receber c) contas,(select jsonb_agg(jsonb_build_object('estado',h.estado,'resultado',h.resultado)) from forecast_homologacoes_266 h) tentativas`,
      )
    ).rows[0];
  const before = await snapshot();
  // SQL checks server-supplied proof; full XML parsing is independently unit-tested.
  const xml = Buffer.from("<fixture>XML conferido na camada de servidor</fixture>");
  const pdf = Buffer.from("%PDF-1.7\nfixture da camada SQL");
  const register = (type, bytes, p = proof) =>
    db.query("select registrar_documento_hml_267($1,$2,$3,$4,$5)", [
      actor,
      nota,
      type,
      bytes.toString("base64"),
      JSON.stringify(p),
    ]);
  const metadata = async () =>
    (await db.query("select documentos_hml_forecast_267($1) d", [nota])).rows[0].d;
  const read = async (type) =>
    (await db.query("select ler_documento_hml_267($1,$2) d", [nota, type])).rows[0].d;
  for (const role of ["anon", "authenticated"]) {
    await db.exec("set role " + role);
    await assert.rejects(
      db.query("select * from forecast_documentos_hml_267"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select contexto_documento_hml_267($1,$2)", [actor, nota]),
      /permission denied/,
    );
    await assert.rejects(register("xml", xml), /permission denied/);
    await owner();
  }
  await service();
  await assert.rejects(metadata(), /permission denied/);
  await assert.rejects(register("pdf", pdf), /XML antes/);
  await assert.rejects(register("xml", xml, { ...proof, cnpj: "99999999000199" }), /Identidade/);
  await assert.rejects(register("xml", xml, { ...proof, valor_total: "99.00" }), /Identidade/);
  await assert.rejects(register("xml", xml, { ...proof, chave: "1".repeat(44) }), /diverge/);
  await register("xml", xml);
  await owner();
  const audits = async () =>
    (
      await db.query(
        "select count(*)::int n from auditoria where acao like 'forecast_hml_documento_%'",
      )
    ).rows[0].n;
  const first = await audits();
  await service();
  await register("xml", xml);
  await assert.rejects(register("xml", Buffer.from("mudou")), /original foi preservado/);
  await register("pdf", pdf);
  await owner();
  assert.equal(await audits(), first + 1);
  await user();
  const meta = await metadata();
  assert.equal(meta.documentos.length, 2);
  assert.equal(JSON.stringify(meta).includes("base64"), false);
  assert.equal(JSON.stringify(meta).includes("token"), false);
  for (const [type, bytes] of [
    ["xml", xml],
    ["pdf", pdf],
  ]) {
    const file = await read(type);
    assert.deepEqual(Buffer.from(file.base64, "base64"), bytes);
    assert.equal(file.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(file.nome, job.ref + "-HOMOLOGACAO." + type);
  }
  await owner();
  await assert.rejects(
    db.query(
      `update forecast_homologacoes_266 set resultado=resultado||$2::jsonb where nota_id=$1`,
      [nota, JSON.stringify({ chave: "1".repeat(44) })],
    ),
    /divergente do XML/,
  );
  const token = (await db.query("select token from forecast_credenciais_262")).rows[0].token;
  await db.query("update forecast_credenciais_262 set token=$1", ["TOKEN-ROTACIONADO-FICTICIO"]);
  await user();
  assert.ok(await read("xml"));
  await service();
  await assert.rejects(
    db.query("select contexto_documento_hml_267($1,$2)", [actor, nota]),
    /Credencial ou CNPJ divergente/,
  );
  await owner();
  await db.query("update forecast_credenciais_262 set token=$1", [token]);
  await user();
  await db.exec("set teste.carteira='true';set teste.fora_carteira='true'");
  await assert.rejects(read("xml"), /fora da carteira/);
  await db.exec(
    "set teste.carteira='false';set teste.fora_carteira='false';set teste.negado='true'",
  );
  await assert.rejects(read("pdf"), /Sem permissão/);
  await db.exec("set teste.negado='false'");
  await owner();
  assert.deepEqual(await snapshot(), before);
  console.log(
    "Forecast267: reaplicação, sigilo, loja/carteira, arquivos imutáveis, SHA256, XML antes do PDF, credencial original e histórico sem efeitos operacionais verificados localmente.",
  );
};
