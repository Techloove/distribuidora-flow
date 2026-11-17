// Testa as funções SQL reais em banco descartável; não conecta ao Supabase.
const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated;create role anon;create schema auth;
create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;
create function can_finance(uuid) returns boolean language sql as $$select coalesce(current_setting('test.finance',true),'true')='true'$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='${id(10)}'::uuid$$;
create function usuario_pode_acessar_conta_financeira(uuid) returns boolean language sql as $$select true$$;
create table centros(id uuid primary key);insert into centros values('${id(10)}');
create table clientes(id uuid primary key);insert into clientes values('${id(20)}');
create table fornecedores(id uuid primary key);insert into fornecedores values('${id(21)}');
create table contas_financeiras(id uuid primary key,centro_id uuid,ativo boolean);
create table pedidos(id uuid primary key,centro_id uuid);create table compras(id uuid primary key,centro_id uuid);
create table contas_receber(id uuid primary key default gen_random_uuid(),pedido_id uuid,cliente_id uuid references clientes(id),documento text,parcela int,valor numeric check(valor>0),vencimento date,data_emissao date,status text,centro_id uuid references centros(id),categoria_id uuid,forma_pagamento_id uuid,conta_financeira_id uuid,descricao text,observacao text);
create table contas_pagar(id uuid primary key default gen_random_uuid(),compra_id uuid,fornecedor_id uuid references fornecedores(id),documento text,parcela int,valor numeric check(valor>0),vencimento date,data_emissao date,status text,centro_id uuid references centros(id),categoria_id uuid,forma_pagamento_id uuid,conta_financeira_id uuid,descricao text,observacao text);
create table auditoria(tabela text,registro_id uuid,acao text,detalhe jsonb,user_id uuid);`);
    const load = async (file, fn) => {
      const s = fs.readFileSync("db/" + file, "utf8"),
        start = s.indexOf("create or replace function public." + fn + "(");
      assert.ok(start >= 0);
      await db.exec(s.slice(start, s.indexOf("$$;", start) + 3));
    };
    await load("fase37_titulos_manuais_desconto_peso.sql", "criar_receita");
    await load("fase76_hardening_referencias_centro.sql", "criar_despesa");
    await db.exec(fs.readFileSync("db/fase222_correcao_gatilho_titulos_manuais.sql", "utf8"));
    await db.exec(
      `create trigger escopo_receber before insert or update on contas_receber for each row execute function validar_escopo_titulo_financeiro();create trigger escopo_pagar before insert or update on contas_pagar for each row execute function validar_escopo_titulo_financeiro();`,
    );
    const criar = (fn, parceiro, doc, valor, n, data, intervalo) =>
      db.query(`select ${fn}($1,null,$2,'Teste de parcelamento',$3,$4,$5,$6,$7,null,null) n`, [
        parceiro,
        id(10),
        doc,
        valor,
        n,
        data,
        intervalo,
      ]);
    for (const [fn, tabela, parceiro] of [
      ["criar_receita", "contas_receber", id(20)],
      ["criar_despesa", "contas_pagar", id(21)],
    ]) {
      const r = await criar(fn, parceiro, "SN10", 5000, 4, "2026-11-18", 7);
      assert.equal(r.rows[0].n, 4);
      const rows = (
        await db.query(
          `select documento,parcela,valor,vencimento::text,status,centro_id from ${tabela} where documento='SN10' order by parcela`,
        )
      ).rows;
      assert.equal(rows.length, 4);
      assert.deepEqual(
        rows.map((r) => r.documento + "/" + r.parcela),
        ["SN10/1", "SN10/2", "SN10/3", "SN10/4"],
      );
      assert.deepEqual(
        rows.map((r) => r.vencimento),
        ["2026-11-18", "2026-11-25", "2026-12-02", "2026-12-09"],
      );
      assert.deepEqual(
        rows.map((r) => Number(r.valor)),
        [1250, 1250, 1250, 1250],
      );
      assert.ok(rows.every((r) => r.status === "aberto" && r.centro_id === id(10)));
      await criar(fn, parceiro, "CENTAVOS", 100, 6, "2026-12-31", 7);
      const cent = (
        await db.query(`select valor from ${tabela} where documento='CENTAVOS' order by parcela`)
      ).rows.map((r) => Number(r.valor));
      assert.deepEqual(cent, [16.67, 16.67, 16.67, 16.67, 16.67, 16.65]);
      assert.equal(
        cent.reduce((s, v) => s + Math.round(v * 100), 0),
        10000,
      );
      // Simula erro na segunda parcela e comprova rollback de todos os títulos e da auditoria.
      await db.exec(
        `create or replace function falhar_parcela_teste() returns trigger language plpgsql as $$begin if new.documento='FALHA' and new.parcela=2 then raise exception 'Falha simulada';end if;return new;end$$;create trigger falha_teste before insert on ${tabela} for each row execute function falhar_parcela_teste();`,
      );
      const antes = (await db.query("select count(*) n from auditoria")).rows[0].n;
      await assert.rejects(
        criar(fn, parceiro, "FALHA", 5000, 4, "2026-11-18", 7),
        /Falha simulada/,
      );
      assert.equal(
        (await db.query(`select count(*) n from ${tabela} where documento='FALHA'`)).rows[0].n,
        0,
      );
      assert.equal((await db.query("select count(*) n from auditoria")).rows[0].n, antes);
      await db.exec("select set_config('test.finance','false',false)");
      await assert.rejects(criar(fn, parceiro, "SEM-ACESSO", 100, 1, "2026-11-18", 7), /permiss/i);
      await db.exec("select set_config('test.finance','true',false)");
    }
    console.log(
      "Parcelamento OK: receitas/despesas, 4 títulos semanais, documento/parcela, centavos, permissões e rollback integral em falha.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
