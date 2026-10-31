// Banco descartável com os contratos e motores já usados nas regressões de modalidade.
const { PGlite } = require("@electric-sql/pglite"),
  fs = require("node:fs");
module.exports = async () => {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql as $$select '00000000-0000-4000-8000-000000000001'::uuid$$;
create function usuario_ativo() returns boolean language sql as $$select coalesce(current_setting('test.ativo',true),'true')='true'$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='00000000-0000-4000-8000-000000000010'::uuid$$;
create function escopo_representante() returns boolean language sql as $$select false$$;
create function documento_na_minha_carteira(text,uuid) returns boolean language sql as $$select true$$;
create function pode_rotina(text) returns boolean language sql as $$select true$$;
create function norm_cidade(text) returns text language sql immutable as $$select lower(coalesce($1,''))$$;
create function norm_txt(text) returns text language sql immutable as $$select lower(coalesce($1,''))$$;
create function vencimento_util(date) returns date language sql as $$select $1$$;
create function can_manage(uuid) returns boolean language sql as $$select true$$;
create function can_operate(uuid) returns boolean language sql as $$select true$$;
create function can_finance(uuid) returns boolean language sql as $$select true$$;
create type app_role as enum('admin','gestor','financeiro','comercial','representante','estoque','expedicao');
create function has_role(uuid,app_role) returns boolean language sql as $$select true$$;
create function intermediacao_ativa_296(uuid) returns boolean language sql as $$select true$$;
create function vendedor_intermediacao_autorizado_298(uuid) returns boolean language sql as $$select true$$;
create function contexto_modalidade_298(uuid) returns boolean language sql as $$select false$$;`);
  await db.exec(fs.readFileSync("scripts/fixtures/modalidade-contratos-300.sql", "utf8"));
  const base = JSON.parse(fs.readFileSync("scripts/fixtures/modalidade-motores-300.json", "utf8"));
  const pending = [
    ...base.rpcs.map((d, i) => ["rpc_" + i, d]),
    ...base.helpers.map((d, i) => ["helper_" + i, d]),
    ...Object.entries(base.views).map(([n, d]) => [
      n,
      `create view ${n} with(security_invoker=true) as ${d}`,
    ]),
  ];
  while (pending.length) {
    let ok = 0,
      last;
    for (let i = pending.length - 1; i >= 0; i--) {
      const [n, d] = pending[i];
      try {
        await db.exec(d);
        pending.splice(i, 1);
        ok++;
      } catch (e) {
        last = { n, message: e.message };
      }
    }
    if (!ok) throw Error(JSON.stringify(last));
  }
  await db.exec(
    "grant usage on schema public to authenticated;grant select on all tables in schema public to authenticated;",
  );
  await db.exec(fs.readFileSync("db/fase300_filtro_modalidade_analitico.sql", "utf8"));
  return db;
};
