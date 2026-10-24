const { readFileSync } = require("node:fs");
const assert = require("node:assert/strict");
module.exports = async function testar266(db, id) {
  const snapshot = async () =>
    (
      await db.query(
        `select (select jsonb_agg(to_jsonb(n)) from notas_saida n) notas,(select jsonb_agg(to_jsonb(p)) from pedidos p) pedidos,(select jsonb_agg(to_jsonb(i)) from pedido_itens i) itens,(select jsonb_agg(to_jsonb(c)) from contas_receber c) contas`,
      )
    ).rows[0];
  const operacaoAntes = await snapshot();
  const sql = readFileSync("db/fase266_envio_homologacao_forecast.sql", "utf8");
  await db.exec(sql);
  await db.exec(sql);
  await db.exec(`create or replace function auth.uid() returns uuid language sql as $$select case when auth.role()='service_role' then null::uuid else '${id(1)}'::uuid end$$;
 create or replace function usuario_ativo() returns boolean language sql as $$select auth.uid() is not null$$;
 create or replace function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select auth.uid() is not null and $1='${id(2)}'::uuid$$;`);
  const loja = id(2),
    nota = id(7),
    actor = id(1),
    ref = "CPRHML" + nota.replaceAll("-", "");
  const user = () =>
    db.exec("reset role;set teste.jwt_role='authenticated';set role authenticated");
  const service = () =>
    db.exec("reset role;set teste.jwt_role='service_role';set role service_role");
  const owner = () => db.exec("reset role");
  const liberar = (v = true) =>
    db.query("select liberar_homologacao_forecast_266($1,$2)", [loja, v]);
  const estado = async () =>
    (await db.query("select estado_homologacao_forecast_266($1) e", [loja])).rows[0].e;
  await user();
  assert.equal((await estado()).liberado, false);
  await db.exec(
    "reset role;create or replace function has_role(uuid,text) returns boolean language sql as $$select false$$;",
  );
  await assert.rejects(liberar(), /Somente administrador/);
  await db.exec(
    "create or replace function has_role(uuid,text) returns boolean language sql as $$select $2='admin'$$;",
  );
  await user();
  await liberar();
  assert.equal((await estado()).liberado, true);
  await owner();
  await db.exec("update forecast_credenciais_262 set updated_at=clock_timestamp()");
  await user();
  assert.equal((await estado()).liberado, false);
  await liberar();
  await owner();
  await db.exec("update forecast_credenciais_262 set ambiente_declarado='producao'");
  await user();
  await assert.rejects(liberar(), /token de homologação/);
  await owner();
  await db.exec(
    "update forecast_credenciais_262 set ambiente_declarado='homologacao';update loja_fiscal_256 set regime='3'",
  );
  await user();
  assert.equal((await estado()).liberado, false);
  await owner();
  await db.exec("update loja_fiscal_256 set regime='1'");
  await user();
  await liberar();
  const ctx = (await db.query("select contexto_envio_forecast_266($1) c", [nota])).rows[0].c;
  const payload = {
    ref,
    cnpj_emitente: "12345678000195",
    ambiente: "HOMOLOGACAO",
    serie: "1",
    items: [{ codigo_produto: "TESTE" }],
  };
  const reservar = (hash = ctx.versao, p = payload) =>
    db.query("select reservar_hml_forecast_266($1,$2,$3,$4)", [
      actor,
      nota,
      hash,
      JSON.stringify(p),
    ]);
  await assert.rejects(reservar(), /permission denied/);
  await assert.rejects(
    db.query("select contexto_forecast_actor_266($1,$2)", [nota, actor]),
    /permission denied/,
  );
  await service();
  assert.deepEqual(
    (await db.query("select contexto_forecast_actor_266($1,$2) c", [nota, actor])).rows[0].c,
    ctx.contexto,
  );
  await assert.rejects(reservar("hash-antigo"), /Dados da nota alterados/);
  await assert.rejects(
    reservar(ctx.versao, { ...payload, ambiente: "PRODUCAO" }),
    /fora do vínculo/,
  );
  await assert.rejects(
    reservar(ctx.versao, { ...payload, cnpj_emitente: "99999999000199" }),
    /fora do vínculo/,
  );
  await reservar();
  const assumir = async (acao = "enviar", p = payload) =>
    (
      await db.query("select assumir_hml_forecast_266($1,$2,$3,$4) j", [
        actor,
        nota,
        acao,
        p ? JSON.stringify(p) : null,
      ])
    ).rows[0].j;
  await assert.rejects(assumir("enviar", { ...payload, serie: "2" }), /Preparação alterada/);
  await owner();
  await db.query("update notas_saida set valor_total=valor_total+1 where id=$1", [nota]);
  await service();
  await assert.rejects(assumir(), /Preparação alterada/);
  await owner();
  await db.query("update notas_saida set valor_total=valor_total-1 where id=$1", [nota]);
  await service();
  let job = await assumir();
  assert.ok(job.lease);
  assert.ok(job.token);
  assert.equal(job.ref, ref);
  assert.equal(await assumir(), null);
  const registrar = (lease, r) =>
    db.query("select registrar_hml_forecast_266($1,$2,$3)", [nota, lease, JSON.stringify(r)]);
  await assert.rejects(
    registrar(job.lease, { estado: "autorizada", mensagem: "Sem prova" }),
    /Prova fiscal/,
  );
  await registrar(job.lease, { estado: "incerta", mensagem: "Timeout simulado" });
  await reservar();
  assert.equal(await assumir(), null);
  assert.equal(await assumir("consultar", null), null);
  await owner();
  await db.exec("update forecast_homologacoes_266 set lease_ate=now()-interval '1 minute'");
  await service();
  job = await assumir("consultar", null);
  assert.ok(job.lease);
  assert.equal(await assumir("consultar", null), null);
  await assert.rejects(
    registrar(id(99), { estado: "processando", mensagem: "Atrasado" }),
    /Consulta substituída/,
  );
  let base = "3226101234567800019555001000000001112345678";
  assert.equal(base.length, 43);
  let soma = 0;
  for (let i = 42, peso = 2; i >= 0; i--, peso = peso === 9 ? 2 : peso + 1)
    soma += Number(base[i]) * peso;
  const dv = 11 - (soma % 11),
    chave = base + (dv >= 10 ? 0 : dv);
  await registrar(job.lease, {
    estado: "autorizada",
    mensagem: "Homologação simulada",
    chave,
    protocolo: "123456789012345",
    numero: "1",
    serie: "1",
  });
  await owner();
  await assert.rejects(
    db.query("update notas_saida set chave_acesso=$1 where id=$2", [chave, nota]),
    /Chave de homologação/,
  );
  await db.exec("update forecast_homologacoes_266 set lease_ate=now()-interval '1 minute'");
  await service();
  job = await assumir("consultar", null);
  await registrar(job.lease, { estado: "incerta", mensagem: "Falha temporária" });
  await user();
  let status = (await db.query("select status_hml_forecast_266($1) s", [nota])).rows[0].s;
  assert.equal(status.estado, "autorizada");
  assert.equal(status.envio_iniciado, true);
  assert.equal(status.resultado.chave, chave);
  assert.equal(JSON.stringify(status).includes("FICTICIO"), false);
  assert.equal(status.payload, undefined);
  assert.equal(status.token, undefined);
  await assert.rejects(db.exec("select * from forecast_homologacoes_266"), /permission denied/);
  await liberar(false);
  await owner();
  await db.exec("update forecast_homologacoes_266 set lease_ate=now()-interval '1 minute'");
  await service();
  job = await assumir("consultar", null);
  assert.ok(job.lease);
  await registrar(job.lease, { estado: "processando", mensagem: "Repetido" });
  await owner();
  const oldToken = (await db.query("select token from forecast_credenciais_262")).rows[0].token;
  await db.query("update forecast_credenciais_262 set token=$1", ["OUTRO-TOKEN-FICTICIO"]);
  await db.exec("update forecast_homologacoes_266 set lease_ate=now()-interval '1 minute'");
  await service();
  await assert.rejects(assumir("consultar", null), /Credencial ou CNPJ divergente/);
  await owner();
  await db.query("update forecast_credenciais_262 set token=$1", [oldToken]);
  await owner();
  await db.exec(
    `create or replace function has_role(uuid,text) returns boolean language sql as $$select $2='representante'$$;`,
  );
  await service();
  await assert.rejects(assumir("consultar", null), /fora da carteira/);
  await owner();
  await db.exec(
    `create or replace function has_role(uuid,text) returns boolean language sql as $$select $2='admin'$$;`,
  );
  await owner();
  const notaReal = (
    await db.query("select status,chave_acesso from notas_saida where id=$1", [nota])
  ).rows[0];
  assert.notEqual(notaReal.chave_acesso, chave);
  assert.equal(
    (await db.query("select count(*)::int n from forecast_homologacoes_266")).rows[0].n,
    1,
  );
  for (const role of ["anon", "authenticated"]) {
    await db.exec("set role " + role);
    await assert.rejects(
      db.query("select registrar_hml_forecast_266($1,$2,$3)", [nota, id(99), "{}"]),
      /permission denied/,
    );
    await owner();
  }
  await user();
  await liberar();
  await owner();
  await db.query(
    `insert into notas_saida(id,pedido_id,cliente_id,centro_id,status,serie,valor_total) select $1,pedido_id,cliente_id,centro_id,'pendente',serie,valor_total from notas_saida where id=$2`,
    [id(88), nota],
  );
  await service();
  const h88 = (
    await db.query("select md5(contexto_forecast_actor_266($1,$2)::text) h", [id(88), actor])
  ).rows[0].h;
  await assert.rejects(
    db.query("select reservar_hml_forecast_266($1,$2,$3,$4)", [
      actor,
      id(88),
      h88,
      JSON.stringify({ ...payload, ref: "CPRHML" + id(88).replaceAll("-", "") }),
    ]),
    /duplicate key|unique constraint/,
  );
  await owner();
  await db.query("delete from notas_saida where id=$1", [id(88)]);
  assert.deepEqual(await snapshot(), operacaoAntes);
  console.log(
    "Forecast266: reaplicação, liberação por configuração/CNPJ, produção bloqueada, reserva única, reivindicação única, lease, retorno monotônico, sigilo, carteira e chave de homologação separada da nota real verificados sem API real.",
  );
};
