const { PGlite } = require("@electric-sql/pglite"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated;create role anon;create table centros(id int primary key,nome text);create table clientes(id int primary key,pessoa_id int);create table pedidos(id int primary key,numero int);
create table contas_receber(id int primary key,cliente_id int,pedido_id int,documento text,parcela int,descricao text,data_emissao date,vencimento date,data_pagamento date,valor numeric,valor_pago numeric,juros numeric,multa numeric,acrescimo numeric,desconto numeric,status text,centro_id int,modalidade text);
insert into centros values(1,'Visível'),(2,'Outra loja');insert into clientes values(1,1);
insert into contas_receber(id,cliente_id,documento,valor,valor_pago,desconto,status,centro_id,vencimento,data_pagamento,modalidade) values
(1,1,'Abatimento',25,20,5,'pago',1,'2099-01-01','2026-11-12','estoque'),
(2,1,'Parcial',25,10,5,'parcial',1,'2099-01-01','2026-11-11','estoque'),
(3,1,'Com encargos',25,25,0,'parcial',1,'2099-01-01','2026-11-11','estoque'),
(4,1,'Cancelado',25,25,0,'cancelado',1,'2099-01-01','2026-11-11','estoque'),
(5,1,'Outra modalidade',25,20,5,'pago',1,'2099-01-01','2026-11-12','intermediacao'),
(6,1,'Outra loja',25,20,5,'pago',2,'2099-01-01','2026-11-12','estoque'),
(7,1,'Quitado líquido',25,20,5,'parcial',1,'2099-01-01','2026-11-12','estoque');
update contas_receber set juros=5 where id=3;
alter table contas_receber enable row level security;create policy loja on contas_receber for select to authenticated using(centro_id=1);
grant select on contas_receber,clientes,pedidos,centros to authenticated;
create view contas_receber_mod_300 with(security_invoker=true) as select * from contas_receber where modalidade='estoque';grant select on contas_receber_mod_300 to authenticated;`);
    const src = fs.readFileSync("db/fase45_comissoes_relatorio_vendas.sql", "utf8"),
      start = src.indexOf("create view public.vw_cliente_titulos"),
      end = src.indexOf("grant select on public.vw_cliente_titulos", start);
    await db.exec(src.slice(start, end));
    const def = (await db.query("select pg_get_viewdef('vw_cliente_titulos'::regclass,true) d"))
      .rows[0].d;
    await db.exec(
      "create view vw_cliente_titulos_mod_300 with(security_invoker=true) as " +
        def
          .replace("public.contas_receber cr", "public.contas_receber_mod_300 cr")
          .replace("FROM contas_receber cr", "FROM contas_receber_mod_300 cr"),
    );
    await db.exec("grant select on vw_cliente_titulos,vw_cliente_titulos_mod_300 to authenticated");
    const before = (await db.query("select * from contas_receber order by id")).rows;
    assert.equal(
      (await db.query("select status_efetivo from vw_cliente_titulos where titulo_id=1")).rows[0]
        .status_efetivo,
      "parcial",
    );
    const sql = fs.readFileSync("db/fase367_historico_cliente_quitacao.sql", "utf8");
    await db.exec(sql);
    await db.exec(sql);
    assert.deepEqual((await db.query("select * from contas_receber order by id")).rows, before);
    await db.exec("set role authenticated");
    for (const view of ["vw_cliente_titulos", "vw_cliente_titulos_mod_300"]) {
      const rows = (await db.query("select * from " + view + " order by titulo_id")).rows;
      assert.equal(rows.find((r) => r.titulo_id === 1).status_efetivo, "pago");
      assert.equal(rows.find((r) => r.titulo_id === 7).status_efetivo, "pago");
      assert.equal(rows.find((r) => r.titulo_id === 2).status_efetivo, "parcial");
      assert.equal(rows.find((r) => r.titulo_id === 3).status_efetivo, "parcial");
      assert.equal(rows.find((r) => r.titulo_id === 4).status_efetivo, "cancelado");
      assert.equal(
        rows.some((r) => r.titulo_id === 6),
        false,
      );
      assert.equal(
        new Date(rows.find((r) => r.titulo_id === 1).data_pagamento).toISOString().slice(0, 10),
        "2026-11-12",
      );
      if (view.endsWith("300"))
        assert.equal(
          rows.some((r) => r.titulo_id === 5),
          false,
        );
    }
    console.log(
      "OK367: R$25 menos R$5 quitado por R$20; encargos, parcial, cancelado, data, modalidades, RLS, ACL e dados preservados; migração reaplicável.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
