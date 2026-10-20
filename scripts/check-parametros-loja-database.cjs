const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table profiles(id uuid primary key);insert into profiles values('${id(1)}'),('${id(2)}');
 create function usuario_ativo() returns bool language sql stable as $$select auth.uid() is not null$$;
 create function can_manage(uuid) returns bool language sql stable as $$select $1='${id(1)}'::uuid$$;
 create function pode_rotina(text) returns bool language sql stable as $$select coalesce(current_setting('test.permission',true),'true')<>'false'$$;
 create function usuario_pode_acessar_centro(uuid) returns bool language sql stable as $$select can_manage(auth.uid()) or $1='${id(10)}'::uuid$$;
 create table centros(id uuid primary key,nome text,ativo bool default true,logo_url text);
 insert into centros(id,nome) values('${id(10)}','A'),('${id(11)}','B');
 create table parametros(chave text primary key,valor text,descricao text,updated_at timestamptz default now());
 insert into parametros(chave,valor) values('desconto_maximo_percentual','15'),('margem_minima','10'),('comissao_fato_gerador','venda'),('aprovacao_limite_credito','true');
 create table auditoria(tabela text,registro_id uuid,acao text,user_id uuid,detalhe jsonb);
 create table permissoes(codigo text,modulo text,grupo text,nome text);insert into permissoes(codigo) values('configuracao_rotinas_editar');
 create table pedidos(id uuid primary key,centro_id uuid);insert into pedidos values('${id(20)}','${id(10)}'),('${id(21)}','${id(11)}');
 create table cargas(id uuid primary key,centro_id uuid);insert into cargas values('${id(30)}','${id(11)}');
 create function validar_pedido(_pedido_id uuid) returns numeric language plpgsql security definer as $$declare n numeric:=(select valor::numeric from public.parametros where chave='desconto_maximo');begin return n;end$$;
 create function margem_inadequada_215(_pedido uuid) returns text language sql security definer as $$select valor from parametros where chave='margem_minima'$$;
 create function despachar_carga_233(_carga uuid) returns text language sql security definer as $$select p.valor from public.parametros p where chave='comissao_fato_gerador'$$;
 create function admin_limpar_dados_interno_f130(text) returns text[] language sql security definer as $$select array['centros','parametros']$$;
 revoke all on function validar_pedido(uuid) from public,anon;grant execute on function validar_pedido(uuid) to authenticated;
 grant usage on schema public,auth to authenticated;grant execute on function auth.uid(),usuario_ativo(),usuario_pode_acessar_centro(uuid) to authenticated;
 `);
    const sql = fs.readFileSync("db/fase243_parametros_por_loja.sql", "utf8");
    const before = (
      await db.query(
        "select oid,proacl::text from pg_proc where oid='validar_pedido(uuid)'::regprocedure",
      )
    ).rows[0];
    await db.exec(sql);
    assert.deepEqual(
      (
        await db.query(
          "select oid,proacl::text from pg_proc where oid='validar_pedido(uuid)'::regprocedure",
        )
      ).rows[0],
      before,
    );
    await db.exec(
      `select set_config('test.actor','${id(1)}',false);select salvar_parametros_loja_243('${id(10)}','{"desconto_maximo":"5","margem_minima":"25"}');select salvar_parametros_loja_243('${id(11)}','{"comissao_fato_gerador":"recebimento"}');`,
    );
    assert.equal((await db.query(`select validar_pedido('${id(20)}') n`)).rows[0].n, "5");
    assert.equal((await db.query(`select validar_pedido('${id(21)}') n`)).rows[0].n, "15");
    assert.equal((await db.query(`select margem_inadequada_215('${id(20)}') n`)).rows[0].n, "25");
    assert.equal(
      (await db.query(`select despachar_carga_233('${id(30)}') n`)).rows[0].n,
      "recebimento",
    );
    assert.equal(
      (
        await db.query(
          `select valor from parametros_da_loja_243('${id(10)}') where chave='desconto_maximo_percentual'`,
        )
      ).rows[0].valor,
      "5",
    );
    assert(
      (await db.query("select admin_limpar_dados_interno_f130('') n")).rows[0].n.includes(
        "loja_parametros",
      ),
    );
    for (const payload of [
      '{"desconto_maximo":"101"}',
      '{"aprovacao_limite_credito":"yes"}',
      '{"desconto_maximo":5}',
      '{"xyz":"5"}',
      '{"comissao_fato_gerador":"pix"}',
    ])
      await assert.rejects(db.query(`select salvar_parametros_loja_243($1,$2)`, [id(10), payload]));
    await db.exec("select set_config('test.permission','false',false)");
    await assert.rejects(
      db.query("select salvar_parametros_loja_243($1,$2)", [id(10), '{"desconto_maximo":"8"}']),
      /permissão/,
    );
    await db.exec(
      `select set_config('test.permission','true',false);select set_config('test.actor','${id(2)}',false);set role authenticated;`,
    );
    assert.equal(
      (await db.query("select count(*)::int n from loja_parametros where centro_id=$1", [id(11)]))
        .rows[0].n,
      0,
    );
    await assert.rejects(
      db.query("select * from listar_parametros_loja_243($1)", [id(11)]),
      /acesso/,
    );
    await assert.rejects(
      db.query("select salvar_parametros_loja_243($1,$2)", [id(10), '{"desconto_maximo":"8"}']),
      /permissão/,
    );
    await assert.rejects(
      db.exec("select * from parametros_da_loja_243(null)"),
      /permission denied/,
    );
    await assert.rejects(db.exec("update loja_parametros set valor='8'"), /permission denied/);
    await db.exec("reset role");
    await assert.rejects(db.exec("update parametros set valor='8'"), /Lojas/);
    await db.exec("select set_config('test.actor','',false)");
    await db.exec(sql);
    assert.equal((await db.query(`select validar_pedido('${id(20)}') n`)).rows[0].n, "5");
    await db.exec(`insert into centros(id,nome) values('${id(12)}','Nova');`);
    assert.equal(
      (
        await db.query("select valor from loja_parametros where centro_id=$1 and chave=$2", [
          id(12),
          "desconto_maximo",
        ])
      ).rows[0].valor,
      "15",
    );
    // Falha fechada caso exista uma rotina não mapeada, sem alteração parcial.
    await db.exec(
      "create function leitor_nao_mapeado() returns text language sql as $$select valor from parametros limit 1$$",
    );
    await assert.rejects(db.exec(sql), /não mapeada/);
    await db.exec("rollback");
    console.log(
      "Lojas243 OK: isolamento, consumidores por documento/carga, inicialização, alias, RLS, permissões, validação, manutenção, ACLs e reexecução.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
