const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create function decidir_orcamento_base_241(uuid,text,text) returns void language sql as $$select null::void$$;
 create table centros(id uuid primary key default gen_random_uuid(),nome text,cidade text,uf text);alter table centros enable row level security;
 create table empresas(id uuid primary key default gen_random_uuid(),created_at timestamptz default now(),razao_social text,nome_fantasia text,cnpj text,inscricao_estadual text,email text,telefone text,logradouro text,numero text,bairro text,cep text,cidade text,uf text);
 create table auditoria(tabela text,acao text,detalhe jsonb);
 insert into empresas(razao_social,cnpj,telefone) values('Empresa original','123','1111');insert into centros(nome) values('Loja A'),('Loja B');`);
    const sql = fs.readFileSync(
      path.resolve(__dirname, "../db/fase242_identidade_lojas.sql"),
      "utf8",
    );
    await db.exec(sql);
    let rows = (await db.query("select * from centros order by nome")).rows;
    const ids = rows.map((r) => r.id);
    assert.deepEqual(
      rows.map((r) => r.nome_fantasia),
      ["Loja A", "Loja B"],
    );
    assert.ok(rows.every((r) => r.cnpj === "123"));
    await db.exec(
      "update centros set telefone='2222',logo_url='data:image/png;base64,YWJj' where nome='Loja A';update centros set telefone=null where nome='Loja B'",
    );
    await db.exec(sql);
    rows = (await db.query("select * from centros order by nome")).rows;
    assert.deepEqual(
      rows.map((r) => r.id),
      ids,
    );
    assert.equal(rows[0].telefone, "2222");
    assert.equal(rows[1].telefone, null);
    assert.equal(
      (await db.query("select relrowsecurity from pg_class where oid='public.centros'::regclass"))
        .rows[0].relrowsecurity,
      true,
    );
    await assert.rejects(
      db.exec("update centros set logo_url='javascript:alert(1)'"),
      /loja_logo_valida_242/,
    );
    await assert.rejects(
      db.exec("update centros set logo_url='data:image/svg+xml;base64,YWJj'"),
      /loja_logo_valida_242/,
    );
    console.log(
      "Lojas242 OK: dados herdados uma vez, identidade própria por loja, IDs e RLS preservados, logo validada e reexecução sem sobrescrita.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
