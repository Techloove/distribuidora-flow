const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated;create role anon;create schema auth;
 create function usuario_ativo() returns boolean language sql stable as $$select coalesce(current_setting('test.ativo',true),'true')='true'$$;
 create function saas_acesso_330() returns boolean language sql stable as $$select coalesce(current_setting('test.saas',true),'true')='true'$$;
 create function escopo_representante() returns boolean language sql stable as $$select coalesce(current_setting('test.admin',true),'false')<>'true'$$;
 create function meu_representante_id() returns integer language sql stable as $$select 10$$;
 create function meus_centros() returns setof integer language sql stable as $$select 1 where coalesce(current_setting('test.loja',true),'true')='true'$$;
 create function usuario_pode_acessar_centro(integer) returns boolean language sql stable as $$select usuario_ativo() and (not escopo_representante() or $1 in(select meus_centros()))$$;
 create table pessoas(id integer primary key,representante_id integer,centro_id integer,loja_pendente boolean default false,is_cliente boolean default true,nome text);
 create table clientes(like pessoas including all);
 insert into pessoas values(1,10,null,false,true,'Próprio compartilhado'),(2,20,null,false,true,'Outra carteira'),(3,10,null,true,true,'Sem loja pendente'),(4,10,2,false,true,'Outra loja'),(5,10,1,false,true,'Loja permitida'),(6,10,null,false,false,'Sem papel cliente');
 insert into clientes select * from pessoas where is_cliente;
 `);
    for (const t of ["pessoas", "clientes"])
      await db.exec(`alter table ${t} enable row level security;grant all on ${t} to authenticated;
 create policy leitura on ${t} for all to authenticated using(true) with check(true);
 create policy acesso_centro_restrito on ${t} as restrictive for all to authenticated using(usuario_pode_acessar_centro(centro_id));
 create policy carteira on ${t} as restrictive for all to authenticated using(not escopo_representante() or representante_id=meu_representante_id());
 create policy ativo on ${t} as restrictive for all to authenticated using(usuario_ativo() and saas_acesso_330());`);
    const q = async (s) => (await db.query(s)).rows;
    await db.exec("set role authenticated");
    assert.deepEqual(
      (await q("select id from pessoas order by id")).map((x) => x.id),
      [5],
    );
    await db.exec("reset role");
    const before = await q("select jsonb_agg(to_jsonb(p) order by id) pessoas from pessoas p");
    const sql = fs.readFileSync("db/fase338_carteira_clientes_compartilhados.sql", "utf8");
    await db.exec(sql);
    await db.exec(sql);
    assert.deepEqual(
      await q("select jsonb_agg(to_jsonb(p) order by id) pessoas from pessoas p"),
      before,
    );
    await db.exec("set role authenticated");
    for (const t of ["pessoas", "clientes"]) {
      assert.deepEqual(
        (await q(`select id from ${t} order by id`)).map((x) => x.id),
        [1, 5],
      );
      assert.equal((await q(`update ${t} set nome='Alterado' where id=1 returning id`)).length, 0);
      assert.equal((await q(`delete from ${t} where id=1 returning id`)).length, 0);
      await assert.rejects(
        () =>
          q(
            `insert into ${t}(id,representante_id,centro_id,nome) values(9,10,null,'Novo compartilhado')`,
          ),
        /row-level security/,
      );
    }
    await db.exec("select set_config('test.loja','false',false)");
    assert.equal((await q("select * from pessoas")).length, 0);
    await db.exec(
      "select set_config('test.loja','true',false),set_config('test.ativo','false',false)",
    );
    assert.equal((await q("select * from pessoas")).length, 0);
    await db.exec(
      "select set_config('test.ativo','true',false),set_config('test.saas','false',false)",
    );
    assert.equal((await q("select * from pessoas")).length, 0);
    await db.exec(
      "select set_config('test.saas','true',false),set_config('test.admin','true',false)",
    );
    assert.equal((await q("select * from pessoas")).length, 6);
    console.log(
      "Carteira338 OK: compartilhado da própria carteira visível; outra carteira, loja alheia, sem loja, sem papel cliente, usuário inativo/licença bloqueada isolados; escrita não ampliada; dados e reaplicação preservados.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
