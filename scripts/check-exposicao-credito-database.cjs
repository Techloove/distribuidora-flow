const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const path = require("node:path");
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table parametros(chave text,valor text);
 create table clientes(id uuid,status text,limite_credito numeric);
 create table pedidos(id uuid,cliente_id uuid,total_liquido numeric,forma_pagamento_id uuid,centro_id uuid,ciclo_reabertura_289 int);
 create table contas_receber(pedido_id uuid,cliente_id uuid,status text,valor numeric,valor_pago numeric,vencimento date,ciclo_pedido_289 int);
 create table produtos(id uuid,descricao text,estoque_atual numeric,custo_medio numeric,margem_minima numeric);
 create table pedido_itens(pedido_id uuid,produto_id uuid,quantidade numeric,preco_unitario numeric,desconto_percentual numeric);
 create function vencimento_util(date) returns date language sql as $$select $1$$;
 insert into clientes values('00000000-0000-4000-8000-000000000001','ativo',5000);
 insert into pedidos values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',4076.80,null,null,1);`);
    const source = fs.readFileSync(
      path.join(__dirname, "../db/fase201_regras_aprovacao_credito.sql"),
      "utf8",
    );
    const start = source.indexOf("create or replace function public.validar_pedido(");
    await db.exec(source.slice(start, source.indexOf("end $function$;", start) + 16));
    await db.exec(`insert into contas_receber select id,cliente_id,'cancelado',4076.80,0,current_date+10,0 from pedidos;
 insert into contas_receber select id,cliente_id,'aberto',v,0,current_date+10,1 from pedidos cross join (values(1358.93),(1358.93),(1358.94)) x(v);`);
    const credit = async () =>
      (await db.query("select validar_pedido(id) r from pedidos")).rows[0].r.filter((x) =>
        x.mensagem.startsWith("Limite de crédito"),
      );
    assert.equal((await credit()).length, 1, "reproduz duplicação original");
    const migration = fs.readFileSync(
      path.join(__dirname, "../db/fase291_exposicao_credito_sem_duplicar_pedido.sql"),
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration);
    assert.equal((await credit()).length, 0, "parcelas atuais contadas uma vez");
    await db.exec(
      `insert into contas_receber select null,cliente_id,'aberto',1000,0,current_date+10,0 from pedidos;`,
    );
    assert.match((await credit())[0].mensagem, /5076.80/, "outro débito permanece no limite");
    await db.exec(`update contas_receber set valor_pago=500 where pedido_id is null;`);
    assert.equal((await credit()).length, 0, "usa saldo parcial de outros títulos");
    await db.exec(
      `update contas_receber set status='pago',valor_pago=valor where pedido_id is not null and status='aberto';`,
    );
    assert.equal((await credit()).length, 0, "pedido já pago não soma novamente seu total");
    await db.exec(`update pedidos set ciclo_reabertura_289=2,total_liquido=4600;`);
    assert.match(
      (await credit())[0].mensagem,
      /5100.00/,
      "novo ciclo sem parcelas usa total mais outros saldos",
    );
    await db.exec(`update pedidos set total_liquido=4500;`);
    assert.equal((await credit()).length, 0, "igual ao limite não bloqueia");
    console.log(
      "OK: exposição sem duplicação, parcelas, cancelados, pagamentos, outros débitos, novo ciclo e migração repetível.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
