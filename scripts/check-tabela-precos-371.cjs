const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  criar = require("./fixtures/banco-relatorios-302.cjs");
(async () => {
  const db = await criar();
  try {
    await db.exec(
      `create or replace function usuario_ativo() returns boolean language sql as $$select coalesce(current_setting('test.ativo',true),'true')='true'$$;create or replace function complemento_pendente_238() returns boolean language sql as $$select coalesce(current_setting('test.pendente',true),'false')='true'$$;create or replace function has_role(uuid,app_role) returns boolean language sql as $$select coalesce(current_setting('test.admin',true),'true')='true' and $2='admin'$$;create or replace function produto_categoria_loja_246(uuid,uuid) returns boolean language sql as $$select true$$;`,
    );
    await db.exec(
      `alter table auditoria alter column id set default gen_random_uuid();insert into papeis(codigo,nome) values('admin','Administrador'),('representante','Representante');`,
    );
    const helper = fs
      .readFileSync("db/fase246_catalogo_categoria_loja.sql", "utf8")
      .match(/create or replace function public\.produto_categoria_loja_246[\s\S]*?\$\$;/)[0];
    await db.exec(helper);
    const mig = fs.readFileSync("db/fase371_relatorio_tabela_precos.sql", "utf8");
    await db.exec(mig);
    await db.exec(mig);
    const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      loja = id(10),
      outra = id(11),
      produto = id(20),
      inativo = id(21),
      bloqueado = id(22),
      estranho = id(23);
    await db.query(
      `insert into centros(id,nome,ativo) values($1,'Ferragens',true),($2,'Cimentos',true)`,
      [loja, outra],
    );
    for (const [pid, nome, ativo, disp, centro] of [
      [produto, "Ferro", true, true, loja],
      [inativo, "Inativo", false, true, loja],
      [bloqueado, "Indisponível", true, false, loja],
      [estranho, "Cimento", true, true, outra],
      [id(24), "Outra categoria", true, true, loja],
    ]) {
      await db.query(
        `insert into produtos(id,codigo,descricao,unidade,categoria,preco_venda,ativo,preco_custo) values($1,'P','Produto '||$2,'UN',$2,100,$3,40)`,
        [pid, nome, ativo],
      );
      await db.query(
        `insert into loja_produtos(centro_id,produto_id,disponivel,preco_venda) values($1,$2,$3,999)`,
        [centro, pid, disp],
      );
    }
    await db.query(
      `insert into cad_categorias(id,nome,nome_norm,ativo) values($1,'Ferro','ferro',true)`,
      [id(25)],
    );
    await db.query(`update centros set categoria_produtos_id=$1 where id=$2`, [id(25), loja]);
    for (let i = 0; i < 7; i++)
      await db.query(
        `insert into desconto_faixas_peso(id,centro_id,nome,ativo,ordem,peso_min,percentual) values($1,$2,$3,true,$4,$4*1000,$4+1)`,
        [id(30 + i), loja, "Faixa " + i, i],
      );
    await db.query(
      `insert into desconto_faixas_peso(id,centro_id,nome,ativo) values($1,$2,'Outra loja',true),($3,$4,'Inativa',false)`,
      [id(40), outra, id(41), loja],
    );
    const ler = async () =>
      (await db.query("select tabela_precos_loja_371($1) r", [loja])).rows[0].r;
    const r = await ler();
    assert.equal(r.loja.nome, "Ferragens");
    assert.equal(r.itens.length, 1);
    assert.equal(
      r.itens[0].preco_normal,
      100,
      "Fonte normal é produto, não preço antigo do catálogo",
    );
    assert.equal(r.faixas.length, 7);
    assert.ok(!JSON.stringify(r).includes("preco_custo"));
    assert.ok(!JSON.stringify(r).includes("custo_medio"));
    await assert.rejects(db.query("select tabela_precos_loja_371($1)", [outra]), /Sem acesso/);
    await db.exec(`set test.ativo='false'`);
    await assert.rejects(ler, /Sem acesso/);
    await db.exec(`set test.ativo='true';set test.pendente='true'`);
    await assert.rejects(ler, /Sem acesso/);
    await db.exec(`set test.pendente='false';set test.admin='false'`);
    const uid = id(1);
    await db.query(
      `insert into user_roles(id,user_id,role) values(gen_random_uuid(),$1,'representante') on conflict do nothing`,
      [uid],
    );
    await ler();
    await db.exec(`delete from role_menus where path='/tabela-precos'`);
    await assert.rejects(ler, /Sem acesso/);
    await db.exec(mig);
    await assert.rejects(ler, /Sem acesso/, "Reaplicar não restaura menu revogado");
    assert.equal(
      (
        await db.query(
          `select has_function_privilege('anon','public.tabela_precos_loja_371(uuid)','execute') a`,
        )
      ).rows[0].a,
      false,
    );
    console.log(
      "Tabela371: preços comerciais, 7 faixas, isolamento por loja, representante, usuário inativo, menu e anonimato OK.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
