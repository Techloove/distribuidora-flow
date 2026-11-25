const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;
 create function usuario_ativo() returns boolean language sql as $$select coalesce(current_setting('test.ativo',true),'true')='true'$$;
 create function can_stock(uuid) returns boolean language sql as $$select coalesce(current_setting('test.stock',true),'true')='true'$$;
 create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='${id(10)}'::uuid$$;
 create function loja_produto_estoque_271(uuid) returns uuid language sql as $$select '${id(10)}'::uuid$$;
 create table produtos(id uuid primary key,descricao text,estoque_atual numeric,custo_medio numeric,permite_estoque_negativo boolean);
 create table estoque_saldos(produto_id uuid,centro_id uuid,quantidade numeric default 0,custo_medio numeric default 0,updated_at timestamptz,primary key(produto_id,centro_id));
 create table estoque_reservas(produto_id uuid,centro_id uuid,pedido_id uuid,quantidade numeric);
 create table estoque_movimentos(id uuid default gen_random_uuid(),produto_id uuid,centro_id uuid,tipo text,quantidade numeric,custo_unitario numeric,origem text,documento_id uuid,observacao text,created_by uuid);
 insert into produtos values('${id(20)}','Produto',100,10,false);
 insert into estoque_saldos values('${id(20)}','${id(10)}',100,10,now());`);
    const load = async (file, name) => {
      const s = fs.readFileSync("db/" + file, "utf8");
      const a = s.indexOf("create or replace function public." + name + "(");
      assert.ok(a >= 0);
      await db.exec(s.slice(a, s.indexOf("$$;", a) + 3));
    };
    for (const n of [
      "aplicar_movimento_estoque",
      "validar_estoque_negativo",
      "lancar_movimento_estoque",
    ])
      await load("fase55_estoque_por_centro.sql", n);
    await load("fase271_estoque_proprio_por_loja.sql", "validar_disponivel_212");
    await db.exec(
      `create trigger reserva before insert on estoque_movimentos for each row execute function validar_disponivel_212();create trigger negativo before insert on estoque_movimentos for each row execute function validar_estoque_negativo();create trigger saldo after insert on estoque_movimentos for each row execute function aplicar_movimento_estoque();`,
    );
    const migration = fs.readFileSync("db/fase374_ajuste_saldo_final_estoque.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const saldo = async () =>
      Number((await db.query("select quantidade from estoque_saldos")).rows[0].quantidade);
    const move = async (tipo, q) =>
      db.query("select lancar_movimento_estoque($1,$2,$3,$4)", [id(20), id(10), tipo, q]);
    const adjust = async (q, expected, center = id(10)) =>
      db.query("select ajustar_saldo_estoque_374($1,$2,$3,$4,$5)", [
        id(20),
        center,
        q,
        expected,
        "Conferência",
      ]);
    await move("entrada", 20);
    assert.equal(await saldo(), 120);
    await move("saida", 15);
    assert.equal(await saldo(), 105);
    await adjust(80, 105);
    assert.equal(await saldo(), 80);
    await adjust(150.125, 80);
    assert.equal(await saldo(), 150.125);
    await assert.rejects(() => adjust(90, 80), /saldo mudou/);
    assert.equal(await saldo(), 150.125);
    await db.exec(`insert into estoque_reservas values('${id(20)}','${id(10)}','${id(30)}',50)`);
    await assert.rejects(() => adjust(40, 150.125), /reservado/);
    assert.equal(await saldo(), 150.125);
    await db.exec("delete from estoque_reservas");
    await adjust(0, 150.125);
    assert.equal(await saldo(), 0);
    const n = Number((await db.query("select count(*) n from estoque_movimentos")).rows[0].n);
    await adjust(0, 0);
    assert.equal(
      Number((await db.query("select count(*) n from estoque_movimentos")).rows[0].n),
      n,
    );
    await assert.rejects(() => adjust(-1, 0), /saldo final válido/);
    await assert.rejects(() => adjust(1.2345, 0), /três casas/);
    await assert.rejects(() => adjust(2, 0, id(11)), /sem acesso/);
    await db.exec("set test.stock='false'");
    await assert.rejects(() => adjust(2, 0), /Sem permissão/);
    await db.exec("set test.stock='true';set test.ativo='false'");
    await assert.rejects(() => adjust(2, 0), /Sem permissão/);
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('anon','ajustar_saldo_estoque_374(uuid,uuid,numeric,numeric,text)','execute') ok",
        )
      ).rows[0].ok,
      false,
    );
    console.log(
      "OK: entrada soma, saída subtrai, ajuste define saldo final/zero; conflito de saldo, reservas, precisão e permissões protegidos; sem movimento para saldo igual; migração idempotente.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.message, e.internalQuery || "");
  process.exit(1);
});
