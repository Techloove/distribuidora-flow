// PGlite: valida a baixa real com encargos e títulos parcialmente pagos, sem rede.
const { PGlite } = require("@electric-sql/pglite"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;
create function can_finance(uuid) returns boolean language sql as $$select true$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select true$$;
create table contas_financeiras(id uuid primary key,centro_id uuid,ativo boolean,conta text,created_at timestamptz default now());
create table categorias_financeiras(id uuid,tipo text,grupo_dre text,parent_id uuid,ordem int);
create table contas_receber(id uuid primary key,centro_id uuid,status text,valor numeric(14,2),juros numeric(14,2),multa numeric(14,2),acrescimo numeric(14,2),desconto numeric(14,2),valor_pago numeric(14,2),conta_financeira_id uuid,forma_pagamento_id uuid,data_pagamento date,categoria_id uuid,observacao text,documento text,parcela int);
create table contas_pagar(like contas_receber including all);
create table movimentos_financeiros(id uuid default gen_random_uuid(),conta_id uuid,data date,tipo text,origem text,valor numeric(14,2),centro_id uuid,forma_pagamento_id uuid,conta_receber_id uuid,conta_pagar_id uuid,categoria_id uuid,descricao text,documento text,created_by uuid);
create table auditoria(tabela text,registro_id uuid,acao text,detalhe jsonb,user_id uuid);
insert into contas_financeiras(id,centro_id,ativo,conta) values('${id(10)}','${id(20)}',true,'12345');`);
    await db.exec(fs.readFileSync("scripts/fixtures/baixa-titulos-motores.sql", "utf8"));
    // Reproduz a ambiguidade com a coluna bancária real antes de aplicar a correção.
    await db.exec(
      `insert into contas_pagar(id,centro_id,status,valor,juros,multa,acrescimo,desconto,valor_pago) values('${id(99)}','${id(20)}','aberto',100,0,0,0,0,0)`,
    );
    await assert.rejects(
      () => db.query("select pagar_titulo($1,100,'2026-10-31',$2)", [id(99), id(10)]),
      /ambiguous/,
    );
    const migration = fs.readFileSync("db/fase301_baixa_pagar_conta_explicita.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    for (const [t, fn] of [
      ["contas_receber", "receber_titulo"],
      ["contas_pagar", "pagar_titulo"],
    ]) {
      await db.exec(
        `insert into ${t}(id,centro_id,status,valor,juros,multa,acrescimo,desconto,valor_pago) values('${id(30)}','${id(20)}','parcial',100,10,2,0,3,9)`,
      );
      const args = [id(30), 52, "2026-10-31", id(10), null, 15, 2, 5];
      const r = (await db.query(`select * from ${fn}($1,$2,$3,$4,$5,$6,$7,$8)`, args)).rows[0];
      assert.equal(Number(r.valor_pago), 61);
      assert.equal(Number(r.juros), 25);
      assert.equal(Number(r.multa), 4);
      assert.equal(Number(r.desconto), 8);
      assert.equal(r.status, "parcial");
      const final = (
        await db.query(`select * from ${fn}($1,60,'2026-10-31',$2,null,0,0,0)`, [id(30), id(10)])
      ).rows[0];
      assert.equal(final.status, "pago");
      assert.equal(Number(final.valor_pago), 121);
      assert.equal(Number(final.juros), 25, "Não reaplica os ajustes da baixa anterior");
    }
    assert.equal(
      Number((await db.query("select sum(valor) v from movimentos_financeiros")).rows[0].v),
      224,
    );
    console.log(
      "OK: recebimentos e pagamentos parciais/finais com encargos incrementais e movimentos de caixa exatos.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
