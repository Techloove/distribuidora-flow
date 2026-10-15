const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
(async () => {
  const d = new PGlite();
  try {
    await d.exec(
      `create schema auth;create function auth.uid() returns uuid language sql as $$select null::uuid$$;
create function vencimento_pedido_227(uuid,int) returns date language sql as $$select current_date$$;
create table pedidos(id uuid default gen_random_uuid(),numero int,status text,data_pedido date,forma_pagamento_id uuid,parcelas int);
create table formas_pagamento(id uuid default gen_random_uuid(),tipo text,parcelas_padrao int,dias_primeira_parcela int,intervalo_dias int);
create table contas_receber(id uuid default gen_random_uuid(),pedido_id uuid,parcela int,valor numeric,valor_pago numeric default0,status text,vencimento date);
create table boletos(conta_receber_id uuid);create table movimentos_financeiros(conta_receber_id uuid);
create table auditoria(tabela text,registro_id uuid,acao text,user_id uuid,detalhe jsonb);
insert into formas_pagamento(tipo,parcelas_padrao,dias_primeira_parcela,intervalo_dias) values('boleto',3,20,20);
insert into pedidos(numero,status,data_pedido,forma_pagamento_id,parcelas) select1,'confirmado','2026-10-15',id,3 from formas_pagamento;
insert into contas_receber(pedido_id,parcela,valor,status,vencimento) select id,n,100,'aberto',data_pedido+(n-1)*30 from pedidos cross join generate_series(1,3)n;
`
        .replaceAll("default0", "default 0")
        .replaceAll("select1", "select 1"),
    );
    const sql = fs.readFileSync(
      require("node:path").join(__dirname, "../db/correcao_pedido1_vencimentos_20_40_60.sql"),
      "utf8",
    );
    const dates = async () =>
      (
        await d.query(
          "select to_char(vencimento,'YYYY-MM-DD') v from contas_receber order by parcela",
        )
      ).rows.map((r) => r.v);
    for (const [setup, pattern, reset] of [
      [
        "update contas_receber set valor_pago=10 where parcela=1",
        /parcela paga/,
        "update contas_receber set valor_pago=0",
      ],
      [
        "insert into boletos select id from contas_receber where parcela=1",
        /registro de boleto/,
        "delete from boletos",
      ],
      [
        "insert into movimentos_financeiros select id from contas_receber where parcela=1",
        /movimentação financeira/,
        "delete from movimentos_financeiros",
      ],
      [
        "update formas_pagamento set intervalo_dias=30",
        /Confira a forma/,
        "update formas_pagamento set intervalo_dias=20",
      ],
    ]) {
      await d.exec(setup);
      await assert.rejects(d.exec(sql), pattern);
      await d.exec("rollback");
      assert.deepEqual(await dates(), ["2026-10-15", "2026-11-14", "2026-12-14"]);
      await d.exec(reset);
    }
    await d.exec(sql);
    await d.exec(sql);
    assert.deepEqual(await dates(), ["2026-11-04", "2026-11-24", "2026-12-14"]);
    assert.equal(Number((await d.query("select count(*) n from auditoria")).rows[0].n), 1);
    console.log(
      "OK reparo pedido1: datas20/40/60, auditoria única, idempotência e rollback por baixa/boleto/movimento/configuração divergente.",
    );
  } finally {
    await d.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
