const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 create table formas_pagamento(id uuid primary key default gen_random_uuid(),nome text,tipo text,parcelas_padrao int,dias_primeira_parcela int,intervalo_dias int);
 create table pedidos(id uuid primary key default gen_random_uuid(),numero int,status text,data_pedido date,forma_pagamento_id uuid,parcelas int);
 create table contas_receber(id uuid primary key default gen_random_uuid(),pedido_id uuid,parcela int,valor numeric,vencimento date,status text default 'aberto',valor_pago numeric default 0,acordo_id uuid);
 create table boletos(conta_receber_id uuid);create table movimentos_financeiros(conta_receber_id uuid);
 create table auditoria(tabela text,registro_id uuid,acao text,user_id uuid,detalhe jsonb);
 create function confirmar_pedido(uuid) returns void language plpgsql as $$begin -- public.vencimento_pedido_227(ped.id,n)
 return;end$$;
 insert into formas_pagamento(nome,tipo,parcelas_padrao,dias_primeira_parcela,intervalo_dias) values('Boleto20/40/60','boleto',3,20,20),('Prazo10/25','prazo',2,10,15),('Boleto30','boleto',1,30,30);
 insert into pedidos(numero,status,data_pedido,forma_pagamento_id,parcelas)
 select n,'separacao','2026-10-15',f.id,f.parcelas_padrao from (values(3,'Boleto20/40/60'),(4,'Prazo10/25'),(5,'Boleto30'),(6,'Boleto30')) x(n,nome) join formas_pagamento f using(nome);
 insert into contas_receber(pedido_id,parcela,valor,vencimento) select p.id,n,100,p.data_pedido+(n-1)*30 from pedidos p cross join lateral generate_series(1,p.parcelas) n;
 `);
    const source = fs.readFileSync(
      path.join(root, "db/fase227_prazos_forma_pagamento_pedido.sql"),
      "utf8",
    );
    await db.exec(
      source.slice(source.indexOf("create or replace function"), source.indexOf("do $migration$")),
    );
    const repair = fs.readFileSync(
      path.join(root, "db/correcao_pedidos3_4_5_vencimentos.sql"),
      "utf8",
    );
    const q = async (s, args = []) => (await db.query(s, args)).rows;
    const dates = () =>
      q(
        "select p.numero,t.parcela,t.vencimento::text d from pedidos p join contas_receber t on t.pedido_id=p.id order by p.numero,t.parcela",
      );
    const before = await dates();
    for (const bad of [
      "update contas_receber set valor_pago=1 where pedido_id=(select id from pedidos where numero=5)",
      "insert into boletos select t.id from contas_receber t join pedidos p on p.id=t.pedido_id where p.numero=5",
      "insert into movimentos_financeiros select t.id from contas_receber t join pedidos p on p.id=t.pedido_id where p.numero=5",
      "update contas_receber set vencimento='2026-10-18' where pedido_id=(select id from pedidos where numero=5)",
      "delete from contas_receber where pedido_id=(select id from pedidos where numero=5)",
      "update contas_receber set acordo_id=gen_random_uuid() where pedido_id=(select id from pedidos where numero=5)",
    ]) {
      await db.exec("begin");
      await db.exec(bad);
      await db.exec("commit");
      const seeded = await dates();
      await assert.rejects(db.exec(repair));
      await db.exec("rollback");
      assert.deepEqual(
        await dates(),
        seeded,
        "A falha no pedido5 precisa reverter correções anteriores nos pedidos3/4",
      );
      assert.equal((await q("select count(*) n from auditoria"))[0].n, 0);
      await db.exec(
        "delete from boletos;delete from movimentos_financeiros;delete from contas_receber where pedido_id=(select id from pedidos where numero=5);insert into contas_receber(pedido_id,parcela,valor,vencimento) select id,1,100,data_pedido from pedidos where numero=5",
      );
    }
    assert.deepEqual(await dates(), before);
    await db.exec(repair);
    assert.deepEqual(
      (await dates()).map((r) => r.d),
      [
        "2026-11-04",
        "2026-11-24",
        "2026-12-14",
        "2026-10-25",
        "2026-11-09",
        "2026-11-14",
        "2026-10-15",
      ],
    );
    assert.equal((await q("select count(*) n from auditoria"))[0].n, 3);
    assert.equal(Number((await q("select sum(valor) total from contas_receber"))[0].total), 700);
    await db.exec(repair);
    assert.equal((await q("select count(*) n from auditoria"))[0].n, 3);
    assert.equal((await q("select count(*) n from contas_receber"))[0].n, 7);
    console.log(
      "OK correção345: prazos individuais, primeira+intervalos, títulos fora do alvo preservados, valores/quantidade mantidos, auditoria idempotente e rollback integral com pagamento, boleto, movimento, negociação ou parcelas inconsistentes.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
