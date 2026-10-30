const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const d = new PGlite();
  try {
    await d.exec(`create role anon;create role authenticated;create role service_role;
 create function usuario_ativo() returns boolean language sql stable as $$select coalesce(current_setting('test.ativo',true),'true')='true'$$;
 create function usuario_pode_acessar_centro(uuid) returns boolean language sql stable as $$select usuario_ativo() and (coalesce(current_setting('test.todas',true),'true')='true' or $1='${id(10)}'::uuid)$$;
 create function norm_txt(text) returns text language sql immutable as $$select lower(trim($1))$$;
 create table produtos(id uuid primary key,categoria text);
 create table cad_categorias(id uuid primary key,nome_norm text);
 create table centros(id uuid primary key,categoria_produtos_id uuid,ativo boolean);
 create table vw_comissoes_detalhe(representante_id uuid,representante text,centro_id uuid,ano int,mes_numero int,mes text,base_calculo numeric,valor numeric,status text);
 create table pedidos(centro_id uuid,representante_id uuid,data_pedido date,total_liquido numeric,status text);
 insert into cad_categorias values('${id(20)}','ferragem'),('${id(21)}','cimento');
 insert into centros values('${id(10)}','${id(20)}',true),('${id(11)}','${id(21)}',true);
 insert into produtos values('${id(30)}','FERRAGEM'),('${id(31)}','Cimento'),('${id(32)}','Sem loja');
 insert into vw_comissoes_detalhe values('${id(40)}','Representante','${id(10)}',2026,10,'2026-10',100,10,'liberada'),('${id(40)}','Representante','${id(11)}',2026,10,'2026-10',200,20,'paga');
 insert into pedidos values('${id(10)}','${id(40)}','2026-10-01',100,'confirmado'),('${id(11)}','${id(40)}','2026-10-01',200,'confirmado'),('${id(10)}','${id(40)}','2026-10-01',999,'rascunho');
 grant select on all tables in schema public to authenticated;
 alter table vw_comissoes_detalhe enable row level security;create policy lojas on vw_comissoes_detalhe for select to authenticated using(usuario_pode_acessar_centro(centro_id));
 alter table pedidos enable row level security;create policy lojas on pedidos for select to authenticated using(usuario_pode_acessar_centro(centro_id));
 `);
    const sql = fs.readFileSync(
      path.join(__dirname, "../db/fase295_vinculos_produtos_lojas.sql"),
      "utf8",
    );
    await d.exec(sql);
    await d.exec(sql);
    await d.exec("set role authenticated");
    let m = (await d.query("select * from vw_produtos_lojas_295 order by centro_id")).rows;
    assert.deepEqual(
      m.map((r) => [r.produto_id, r.centro_id]),
      [
        [id(30), id(10)],
        [id(31), id(11)],
      ],
    );
    for (const [loja, valor, base] of [
      [10, 10, 100],
      [11, 20, 200],
    ]) {
      const r = (await d.query("select resumo_comissoes_loja_295($1) r", [id(loja)])).rows[0].r;
      assert.equal(r.length, 1);
      assert.equal(r[0].total, valor);
      assert.equal(r[0].base_total, base);
      assert.equal(r[0].realizado, base);
      assert.equal(r[0].valor_meta, null);
      assert.equal(r[0].atingimento_percentual, null);
    }
    assert.deepEqual((await d.query("select resumo_comissoes_loja_295(null) r")).rows[0].r, []);
    await d.exec("set test.todas='false'");
    m = (await d.query("select * from vw_produtos_lojas_295")).rows;
    assert.deepEqual(
      m.map((r) => r.produto_id),
      [id(30)],
    );
    assert.deepEqual(
      (await d.query("select resumo_comissoes_loja_295($1) r", [id(11)])).rows[0].r,
      [],
    );
    await d.exec("set test.ativo='false'");
    assert.equal((await d.query("select count(*)::int n from vw_produtos_lojas_295")).rows[0].n, 0);
    assert.deepEqual(
      (await d.query("select resumo_comissoes_loja_295($1) r", [id(10)])).rows[0].r,
      [],
    );
    await assert.rejects(
      () => d.exec("delete from vw_produtos_lojas_295"),
      /permission denied|cannot delete/,
    );
    await d.exec("reset role;set role anon");
    await assert.rejects(() => d.exec("select * from vw_produtos_lojas_295"), /permission denied/);
    await assert.rejects(
      () => d.query("select resumo_comissoes_loja_295($1)", [id(10)]),
      /permission denied/,
    );
    console.log(
      "OK: fase295 repetível e somente leitura; categoria/loja, sem loja, comissões e vendas sem misturar centros; metas globais não rateadas; RLS/ativo/anon e centro sem acesso.",
    );
  } finally {
    await d.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
