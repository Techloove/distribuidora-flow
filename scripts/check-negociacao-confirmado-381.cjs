const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const d = new PGlite();
  try {
    await d.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;
create function usuario_ativo() returns boolean language sql as $$select current_setting('t.ativo',true)='true'$$;
create function complemento_pendente_238() returns boolean language sql as $$select false$$;
create function saas_acesso_330() returns boolean language sql as $$select true$$;
create function has_role(uuid,text) returns boolean language sql as $$select current_setting('t.admin',true)='true' and $2='admin'$$;
create function can_operate(uuid) returns boolean language sql as $$select true$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='${id(50)}'::uuid$$;
create table profiles(id uuid primary key);insert into profiles values('${id(1)}');
create table centros(id uuid primary key);insert into centros values('${id(50)}'),('${id(51)}');
create table produtos(id uuid primary key,preco_venda numeric);insert into produtos values('${id(20)}',9.95);
create table pedidos(id uuid primary key,centro_id uuid,status text,modalidade_venda text,tipo_documento text,total_itens numeric);insert into pedidos values('${id(10)}','${id(50)}','rascunho','estoque','pedido',3582);
create table pedido_itens(id uuid primary key,pedido_id uuid,produto_id uuid,quantidade numeric,preco_unitario numeric,desconto_percentual numeric);
insert into pedido_itens values('${id(30)}','${id(10)}','${id(20)}',400,9.95,10);
create table auditoria(tabela text,registro_id uuid,acao text,user_id uuid,detalhe jsonb);
create function recalcular_pedido(uuid) returns void language sql as $$update pedidos set total_itens=(select round(sum(quantidade*preco_unitario*(1-desconto_percentual/100)),2) from pedido_itens where pedido_id=pedidos.id) where id=$1$$;
set t.ativo='true';set t.admin='true';`);
    const legado = fs.readFileSync("db/fase81_hardening_crud_pedidos.sql", "utf8");
    const inicio = legado.indexOf("create or replace function public.atualizar_item_pedido(");
    await d.exec(
      legado
        .slice(inicio, legado.indexOf("$$;", inicio) + 3)
        .replace("round(_preco_unitario,2)", "round(_preco_unitario,4)"),
    );
    await d.exec(
      "alter table pedidos add column orcamento_situacao text;alter table pedidos add column orcamento_validade date",
    );

    await d.exec(`
      alter table pedidos add column total_liquido numeric default 3582,add column desconto_valor numeric default 0,add column comissao_valor numeric default 179.10,add column comissao_percentual numeric default 5;
      create table contas_receber(id uuid primary key,pedido_id uuid,valor numeric,valor_pago numeric default 0,status text default 'aberto',juros numeric default 0,multa numeric default 0,acrescimo numeric default 0,desconto numeric default 0,acordo_id uuid,parcela int,vencimento date,documento text);
      create table boletos(id uuid,pedido_id uuid,conta_receber_id uuid,status text);
      create table cargas(id uuid,status text);create table carga_pedidos(carga_id uuid,pedido_id uuid);
      create table expedicoes(pedido_id uuid,status text,data_saida date);
      create table movimentos_financeiros(conta_receber_id uuid,status text);
      create table renegociacao_origens(titulo_id uuid);
      create table devolucoes(pedido_id uuid,status text);
      create table notas_saida(pedido_id uuid,status text);
      create table comissoes(id uuid primary key,pedido_id uuid,status text,base_calculo numeric,base_original numeric,valor_original numeric,valor numeric,percentual numeric);
      create table comissao_parcelas(comissao_id uuid,conta_pagar_id uuid);
      create table contas_pagar(id uuid,status text,valor_pago numeric);
      create table comissao_pagamento_itens(comissao_id uuid,pagamento_id uuid);
      create table comissao_pagamentos(id uuid,conta_pagar_id uuid,status text);
      create table creditos_clientes_aplicacoes(pedido_id uuid,status text);
      create function exigir_admin_pedido_285(uuid,text) returns void language sql as $$select$$;
      create function apurar_comissao_pedido(uuid) returns void language sql as $$select$$;
      create or replace function recalcular_pedido(uuid) returns void language plpgsql as $$declare soma numeric;begin select round(sum(quantidade*preco_unitario*(1-desconto_percentual/100)),2) into soma from pedido_itens where pedido_id=$1;update pedidos set total_itens=soma,total_liquido=soma,comissao_valor=round(soma*.05,2),comissao_percentual=5 where id=$1;end$$;
    `);
    const helper = (file, name) => {
      const text = fs.readFileSync(file, "utf8"),
        start = text.indexOf("create or replace function public." + name + "(");
      assert.ok(start >= 0);
      return text.slice(start, text.indexOf("$$;", start) + 3);
    };
    await d.exec(helper("db/fase289_reabertura_pedido_digitacao.sql", "validar_reabertura_289"));
    await d.exec(helper("db/fase373_comissao_novo_ciclo.sql", "comissao_comprometida_373"));
    await d.exec(helper("db/fase2_vendas_estoque_financeiro.sql", "pedido_itens_after"));
    await d.exec(
      "create trigger total_item_teste after update on pedido_itens for each row execute function pedido_itens_after()",
    );
    const migration = fs.readFileSync("db/fase381_negociacao_preco_item.sql", "utf8");
    await d.exec(migration);
    await d.exec(migration);
    await d.exec(
      `update pedidos set status='confirmado';insert into comissoes values('${id(90)}','${id(10)}','prevista',3582,3582,179.10,179.10,5)`,
    );
    for (const [i, valor] of [1000, 1000, 1582].entries())
      await d.query(
        "insert into contas_receber(id,pedido_id,valor,parcela,vencimento,documento) values($1,$2,$3,$4,'2026-12-01'::date+$4::int,'DOC')",
        [id(100 + i), id(10), valor, i + 1],
      );
    const before = (
      await d.query("select id,vencimento,parcela,documento from contas_receber order by parcela")
    ).rows;
    const save = (old, novo) =>
      d.query("select negociar_preco_item_381($1,$2,$3,400,10,$4)", [
        id(30),
        old,
        novo,
        "Negociação confirmada",
      ]);
    async function bloqueio(insert, cleanup, pattern) {
      await d.exec(insert);
      await assert.rejects(save(9.95, 9.5), pattern);
      assert.equal(
        Number((await d.query("select preco_unitario from pedido_itens")).rows[0].preco_unitario),
        9.95,
      );
      await d.exec(cleanup);
    }
    await bloqueio(
      `insert into boletos values('${id(800)}','${id(10)}',null,'registrado')`,
      "delete from boletos",
      /boleto/,
    );
    await bloqueio(
      `insert into boletos values('${id(800)}','${id(10)}',null,'cancelado')`,
      "delete from boletos",
      /boleto/,
    );
    await bloqueio(
      `insert into cargas values('${id(801)}','aberta');insert into carga_pedidos values('${id(801)}','${id(10)}')`,
      "delete from carga_pedidos;delete from cargas",
      /carga/,
    );
    await bloqueio(
      "update contas_receber set valor_pago=1 where parcela=1",
      "update contas_receber set valor_pago=0",
      /recebimentos/,
    );
    await bloqueio(
      `insert into notas_saida values('${id(10)}','autorizada')`,
      "delete from notas_saida",
      /fiscal/,
    );
    await bloqueio(
      "update comissoes set status='paga'",
      "update comissoes set status='prevista'",
      /comissão/,
    );
    await bloqueio(
      `insert into comissao_pagamentos values('${id(850)}',null,'gerado');insert into comissao_pagamento_itens values('${id(90)}','${id(850)}')`,
      "delete from comissao_pagamento_itens;delete from comissao_pagamentos",
      /Comissão paga ou agendada/,
    );
    await bloqueio(
      `insert into creditos_clientes_aplicacoes values('${id(10)}','aplicado')`,
      "delete from creditos_clientes_aplicacoes",
      /crédito aplicado/,
    );
    await bloqueio(
      "update contas_receber set desconto=1 where parcela=1",
      "update contas_receber set desconto=0",
      /ajustes/,
    );
    await d.exec(
      "create function falha_auditoria() returns trigger language plpgsql as $$begin raise exception 'Falha sintética';end$$;create trigger falha_auditoria before insert on auditoria for each row execute function falha_auditoria()",
    );
    await assert.rejects(save(9.95, 9.5), /Falha sintética/);
    assert.equal(
      Number((await d.query("select total_liquido from pedidos")).rows[0].total_liquido),
      3582,
    );
    assert.equal(
      Number((await d.query("select sum(valor) n from contas_receber")).rows[0].n),
      3582,
    );
    assert.equal(Number((await d.query("select valor from comissoes")).rows[0].valor), 179.1);
    await d.exec("drop trigger falha_auditoria on auditoria");
    await d.exec("set role authenticated");
    await save(9.95, 9.5);
    await d.exec("reset role");
    const p = (await d.query("select * from pedidos")).rows[0];
    assert.equal(p.status, "confirmado");
    assert.equal(Number(p.total_liquido), 3420);
    assert.deepEqual(
      (await d.query("select valor from contas_receber order by parcela")).rows.map((r) =>
        Number(r.valor),
      ),
      [954.77, 954.77, 1510.46],
    );
    assert.deepEqual(
      (await d.query("select id,vencimento,parcela,documento from contas_receber order by parcela"))
        .rows,
      before,
    );
    const c = (await d.query("select * from comissoes")).rows[0];
    assert.equal(Number(c.valor), 171);
    assert.equal(Number(c.base_original), 3420);
    assert.equal(c.status, "prevista");
    const i = (await d.query("select * from pedido_itens")).rows[0];
    assert.equal(Number(i.quantidade), 400);
    assert.equal(Number(i.desconto_percentual), 10);
    assert.equal(Number(i.preco_unitario), 9.5);
    assert.equal(
      Number((await d.query("select preco_venda from produtos")).rows[0].preco_venda),
      9.95,
    );
    await assert.rejects(
      d.query("select atualizar_item_pedido_parcial_381($1,300,null,null)", [id(30)]),
      /nao pode ser alterado/,
    );
    console.log(
      "OK: confirmado381 sem boleto/carga negocia mantendo status, quantidade, desconto e catálogo; parcelas proporcionais com centavos/datas/IDs preservados; comissão reapurada; recebimento/fiscal/crédito/comissão/carga bloqueiam; falha reverte tudo.",
    );
  } finally {
    await d.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
