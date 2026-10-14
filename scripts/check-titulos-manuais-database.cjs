const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated;create role anon;create schema auth;create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;create function can_finance(uuid) returns boolean language sql as $$select true$$;create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='${id(10)}'::uuid$$;
create table pedidos(id uuid primary key,centro_id uuid);create table compras(id uuid primary key,centro_id uuid);
create table contas_receber(id uuid primary key default gen_random_uuid(),pedido_id uuid,cliente_id uuid,documento text,parcela int,valor numeric,vencimento date,data_emissao date,status text,centro_id uuid,categoria_id uuid,forma_pagamento_id uuid,conta_financeira_id uuid,descricao text,observacao text);
create table contas_pagar(id uuid primary key default gen_random_uuid(),compra_id uuid,fornecedor_id uuid,documento text,parcela int,valor numeric,vencimento date,data_emissao date,status text,centro_id uuid,categoria_id uuid,forma_pagamento_id uuid,conta_financeira_id uuid,descricao text,observacao text);
create table auditoria(tabela text,registro_id uuid,acao text,detalhe jsonb,user_id uuid);
insert into pedidos values('${id(20)}','${id(10)}'),('${id(21)}','${id(11)}');insert into compras values('${id(30)}','${id(10)}'),('${id(31)}','${id(11)}');`);
    const load = async (f, name) => {
      const s = fs.readFileSync(path.join(root, "db", f), "utf8"),
        start = s.indexOf("create or replace function public." + name + "(");
      await db.exec(s.slice(start, s.indexOf("$$;", start) + 3));
    };
    await load("fase63_hardening_escopo_mutacoes.sql", "validar_escopo_titulo_financeiro");
    await db.exec(
      "create trigger escopo_receber before insert or update on contas_receber for each row execute function validar_escopo_titulo_financeiro();create trigger escopo_pagar before insert or update on contas_pagar for each row execute function validar_escopo_titulo_financeiro();",
    );
    await load("fase37_titulos_manuais_desconto_peso.sql", "criar_receita");
    await load("fase33_titulos_financeiros.sql", "criar_despesa");
    const criar = (fn) =>
      db.query(`select ${fn}(null,null,$1,'Manual','1010',100,3,current_date,30,null,null)`, [
        id(10),
      ]);
    await assert.rejects(criar("criar_receita"), /record "new" has no field "compra_id"/);
    await assert.rejects(criar("criar_despesa"), /record "new" has no field "pedido_id"/);
    const sql = fs.readFileSync(
      path.join(root, "db/fase222_correcao_gatilho_titulos_manuais.sql"),
      "utf8",
    );
    await db.exec(sql);
    await db.exec(sql);
    for (const fn of ["criar_receita", "criar_despesa"]) await criar(fn);
    for (const table of ["contas_receber", "contas_pagar"]) {
      const r = (await db.query(`select count(*) n,sum(valor) total from ${table}`)).rows[0];
      assert.equal(r.n, 3);
      assert.equal(Number(r.total), 100);
      await db.query(`update ${table} set descricao='Editado'`);
    }
    await db.query("insert into contas_receber(pedido_id,centro_id) values($1,$2)", [
      id(20),
      id(10),
    ]);
    await db.query("insert into contas_pagar(compra_id,centro_id) values($1,$2)", [id(30), id(10)]);
    await assert.rejects(
      db.query("insert into contas_receber(pedido_id,centro_id) values($1,$2)", [id(21), id(10)]),
      /outro centro/,
    );
    await assert.rejects(
      db.query("insert into contas_pagar(compra_id,centro_id) values($1,$2)", [id(31), id(10)]),
      /outro centro/,
    );
    await assert.rejects(
      db.query("insert into contas_receber(pedido_id) values($1)", [id(999)]),
      /sem centro valido/,
    );
    console.log(
      "Títulos manuais OK: erro original reproduzido nas duas tabelas, receitas/despesas parceladas e edição corrigidas, escopo de documentos vinculados preservado, migração reaplicável.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
