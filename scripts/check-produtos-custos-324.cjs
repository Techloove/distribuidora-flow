const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs");
const assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table perfis(id uuid,role text,ativo boolean default true,centro_id uuid);
 create function has_role(uuid,text) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from perfis where id=$1 and role=$2)$$;
 create function usuario_ativo() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from perfis where id=auth.uid() and ativo)$$;
 create function complemento_pendente_238() returns boolean language sql stable as $$select false$$;
 create function usuario_pode_acessar_centro(uuid) returns boolean language sql stable security definer set search_path=public as $$select has_role(auth.uid(),'admin') or exists(select 1 from perfis where id=auth.uid() and centro_id=$1)$$;
 create table produtos(id uuid primary key,descricao text,centro_id uuid,custo_medio numeric,ultimo_custo numeric,preco_custo numeric,custo_reposicao numeric,markup_percentual numeric,margem_minima numeric,preco_venda numeric);
 alter table produtos enable row level security;
 create policy leitura on produtos for select to authenticated using(usuario_ativo() and usuario_pode_acessar_centro(centro_id));
 create policy escrita on produtos for all to authenticated using(has_role(auth.uid(),'admin')) with check(has_role(auth.uid(),'admin'));
 grant all on produtos to authenticated;
 create view vw_estoque_teste with(security_invoker=true,security_barrier=true) as select p.id,p.custo_medio,p.preco_venda from produtos p;
 create view vw_margem_teste with(security_invoker=true) as select id,custo_medio,preco_venda-custo_medio lucro from produtos p;
 create table historicos(produto_id uuid,tipo text,valor numeric);
 create view vw_historico_produto with(security_invoker=true) as select * from historicos;
 create function listar_catalogo_loja_244(_loja uuid,_busca text default '',_somente_disponiveis boolean default true) returns table(id uuid,custo_medio numeric) language sql stable security definer set search_path=public as $$select p.id,p.custo_medio from produtos p where usuario_ativo() and usuario_pode_acessar_centro(_loja) and p.centro_id=_loja$$;
 grant select on vw_estoque_teste,vw_margem_teste,historicos,vw_historico_produto to authenticated;
 insert into perfis values('00000000-0000-4000-8000-000000000001','representante',true,'00000000-0000-4000-8000-000000000010'),('00000000-0000-4000-8000-000000000002','admin',true,null),('00000000-0000-4000-8000-000000000002','representante',true,null),('00000000-0000-4000-8000-000000000003','gestor',true,'00000000-0000-4000-8000-000000000010'),('00000000-0000-4000-8000-000000000004','gestor',true,'00000000-0000-4000-8000-000000000010'),('00000000-0000-4000-8000-000000000004','representante',true,'00000000-0000-4000-8000-000000000010');
 insert into produtos values('00000000-0000-4000-8000-000000000020','Produto A','00000000-0000-4000-8000-000000000010',40,39,38,41,50,10,60),('00000000-0000-4000-8000-000000000021','Outra loja','00000000-0000-4000-8000-000000000011',90,89,88,91,20,10,120);
 insert into historicos values('00000000-0000-4000-8000-000000000020','compra',40),('00000000-0000-4000-8000-000000000020','venda',60);`);
    const q = async (s) => (await db.query(s)).rows;
    const before = await q("select * from produtos order by id");
    const sql = fs.readFileSync("db/fase324_produtos_custos_representantes.sql", "utf8");
    await db.exec(sql);
    await db.exec(sql);
    assert.deepEqual(
      await q("select * from produtos order by id"),
      before,
      "Instalação não modifica preços ou custos",
    );
    const actor = async (n) =>
      db.exec(
        `reset role;set test.actor='00000000-0000-4000-8000-${String(n).padStart(12, "0")}';set role authenticated;`,
      );
    for (const n of [1, 4]) {
      await actor(n);
      const rows = await q("select * from produtos_consulta_324");
      assert.equal(rows.length, 1);
      for (const c of [
        "custo_medio",
        "ultimo_custo",
        "preco_custo",
        "custo_reposicao",
        "markup_percentual",
        "margem_minima",
      ])
        assert.equal(rows[0][c], null, `Campo ${c} exposto`);
      assert.equal(rows[0].preco_venda, "60");
      await assert.rejects(() => q("select custo_medio from produtos"), /permission denied/);
      await assert.rejects(
        () => q("select id from produtos where custo_medio>30"),
        /permission denied/,
      );
      assert.equal((await q("select * from vw_estoque_teste"))[0].custo_medio, null);
      assert.equal((await q("select * from vw_margem_teste"))[0].lucro, null);
      assert.deepEqual(
        (await q("select tipo from vw_historico_produto")).map((r) => r.tipo),
        ["venda"],
      );
      assert.equal(
        (
          await q("select * from listar_catalogo_loja_244('00000000-0000-4000-8000-000000000010')")
        )[0].custo_medio,
        null,
      );
    }
    for (const n of [2, 3]) {
      await actor(n);
      assert.equal(
        (await q("select * from produtos_consulta_324 where descricao='Produto A'"))[0].custo_medio,
        "40",
      );
      assert.equal((await q("select * from vw_estoque_teste order by id"))[0].custo_medio, "40");
      assert.equal(
        (
          await q("select * from listar_catalogo_loja_244('00000000-0000-4000-8000-000000000010')")
        )[0].custo_medio,
        "40",
      );
      assert.equal((await q("select * from vw_historico_produto")).length, 2);
    }
    await actor(2);
    await q("update produtos set custo_medio=42 where descricao='Produto A' returning id");
    assert.equal(
      (await q("select custo_medio from produtos_consulta_324 where descricao='Produto A'"))[0]
        .custo_medio,
      "42",
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(() => q("select * from produtos_consulta_324"), /permission denied/);
    console.log(
      "OK: representante e representante+gestor sem custos; representante+admin e gestor preservados; consulta direta bloqueada, views/catálogo/histórico protegidos, escopo por loja e escrita administrativa mantidos; instalação repetível sem alterar dados.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
