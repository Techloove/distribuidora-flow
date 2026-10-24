const { PGlite } = require("@electric-sql/pglite");
const { readFileSync } = require("node:fs");
const assert = require("node:assert/strict");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;
 create table profiles(id uuid primary key);insert into profiles values('${id(1)}');
 create table centros(id uuid primary key,cnpj text,ativo boolean);
 insert into centros values('${id(2)}','12345678000195',true),('${id(3)}','99999999000199',true);
 create table auditoria(tabela text,registro_id uuid,acao text,detalhe jsonb,user_id uuid);
 create function usuario_ativo() returns boolean language sql as $$select current_setting('teste.inativo',true) is distinct from 'true'$$;
 create function can_manage(uuid) returns boolean language sql as $$select current_setting('teste.representante',true) is distinct from 'true'$$;
 create function pode_rotina(text) returns boolean language sql as $$select current_setting('teste.sem_rotina',true) is distinct from 'true'$$;
 create function has_role(uuid,text) returns boolean language sql as $$select current_setting('teste.gestor',true) is distinct from 'true'$$;
 create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='${id(2)}'::uuid$$;
 create function assumir_nfe_259(uuid,uuid,boolean) returns void language sql as $$select$$;
 create table faznotas_emissoes_259(id uuid,estado text,recibo text);
 create table faznotas_liberacao_259(liberado boolean);
 insert into faznotas_emissoes_259 values('${id(4)}','autorizada','HISTORICO');
 `);
  for (const f of [
    "fase261_preparacao_forecast_fiscal.sql",
    "fase262_conexao_forecast_fiscal.sql",
    "fase262_conexao_forecast_fiscal.sql",
  ])
    await db.exec(readFileSync("db/" + f, "utf8"));
  const estado = async () =>
    (await db.query("select estado_conexao_forecast_262($1) e", [id(2)])).rows[0].e;
  const salvar = (
    cnpj = "12345678000195",
    token = "FICTICIO",
    ambiente = "homologacao",
    loja = id(2),
  ) => db.query("select salvar_conexao_forecast_262($1,$2,$3,$4)", [loja, cnpj, token, ambiente]);
  assert.equal((await estado()).token_configurado, false);
  await assert.rejects(salvar(), /Salve o provedor/);
  await db.query("select salvar_provedor_fiscal_261($1,$2)", [id(2), "forecastfiscal"]);
  await salvar();
  await salvar("12345678000195", "");
  assert.equal((await estado()).vinculo_atual, true);
  assert.equal((await estado()).emissao_disponivel, false);
  assert.ok(!JSON.stringify(await estado()).includes("FICTICIO"));
  assert.ok(
    !(await db.query("select detalhe::text from auditoria")).rows.some((r) =>
      r.detalhe.includes("FICTICIO"),
    ),
  );
  await assert.rejects(salvar("12345678000195", "", "producao"), /token válido/);
  await assert.rejects(salvar("99999999000199"), /CNPJ deve/);
  await assert.rejects(salvar("12345678000195", "Token:senha"), /token válido/);
  await assert.rejects(salvar("99999999000199", "FICTICIO", "homologacao", id(3)), /Sem acesso/);
  for (const flag of ["inativo", "sem_rotina", "representante"]) {
    await db.exec(`set teste.${flag}='true'`);
    await assert.rejects(estado(), /Sem acesso/);
    await assert.rejects(salvar(), /Sem acesso/);
    await db.exec(`set teste.${flag}='false'`);
  }
  await db.exec(`set teste.gestor='true'`);
  await estado();
  await assert.rejects(salvar(), /Somente administrador/);
  await db.exec(`set teste.gestor='false'`);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.exec("select * from forecast_credenciais_262"), /permission denied/);
    await assert.rejects(
      db.exec(`update forecast_credenciais_262 set token='OUTRO'`),
      /permission denied/,
    );
    if (role === "anon") await assert.rejects(estado(), /permission denied/);
    await db.exec("reset role");
  }
  await db.exec(`update centros set cnpj='99999999000199' where id='${id(2)}'`);
  assert.equal((await estado()).vinculo_atual, false);
  await db.query("select salvar_provedor_fiscal_261($1,$2)", [id(2), "forecastfiscal"]);
  await assert.rejects(salvar("99999999000199", ""), /token válido/);
  await salvar("99999999000199", "NOVO-FICTICIO");
  await db.query("select salvar_provedor_fiscal_261($1,$2)", [id(2), "suspenso"]);
  assert.equal((await estado()).vinculo_atual, false);
  await assert.rejects(salvar("99999999000199"), /Salve o provedor/);
  assert.equal(
    (await db.query("select recibo from faznotas_emissoes_259")).rows[0].recibo,
    "HISTORICO",
  );
  await assert.rejects(
    db.exec(`insert into faznotas_emissoes_259 values('${id(5)}','preparada',null)`),
    /Novas emissões FAZNOTAS/,
  );
  await db.close();
  console.log(
    "Forecast262: reaplicação, sigilo, auditoria sem token, papéis, loja, CNPJ, ambiente e histórico verificados em PGlite; nenhuma API real.",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
