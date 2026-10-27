const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
module.exports = async (db, id) => {
  const root = path.resolve(__dirname, "../..");
  const load = async (file, name) => {
    const text = fs.readFileSync(path.join(root, "db", file), "utf8");
    const start = text.indexOf("create or replace function public." + name + "(");
    assert(start >= 0, name);
    const tail = text.slice(start),
      tag = tail.match(/\bas\s+(\$\w*\$)/i)[1];
    const begin = tail.indexOf(tag) + tag.length,
      end = tail.indexOf(tag, begin) + tag.length + 1;
    await db.exec(tail.slice(0, end));
  };
  await db.exec(`create or replace function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select true$$;
 alter table produtos add column preco_venda numeric(14,4) not null default 10;
 alter table loja_produtos add column updated_at timestamptz default now(),add column updated_by uuid;
 alter table pedidos add column desconto_valor numeric default 0,add column frete_valor numeric default 0,add column forma_pagamento_id uuid,add column forma_acrescimo_valor numeric default 0,add column forma_desconto_valor numeric default 0;
 alter table pedido_itens add column preco_unitario numeric(14,4) default 10,add column total numeric generated always as(round(quantidade*preco_unitario,2)) stored;
 create table formas_pagamento(id uuid primary key,nome text,parcelas_padrao int,dias_primeira_parcela int,intervalo_dias int,taxa_percentual numeric default 0,desconto_percentual numeric default 0);
 insert into formas_pagamento values('${id(9010)}','20/40 dias',2,20,20,0,0);
 create function resolver_comissao(uuid,uuid,date,uuid,numeric) returns numeric language sql as $$select 0::numeric$$;
 create function apurar_comissao_pedido(uuid) returns void language sql as $$select null::void$$;
 create function can_stock(uuid) returns boolean language sql as $$select true$$;
 create function can_finance(uuid) returns boolean language sql as $$select true$$;
 alter table compras add column numero int,add column fornecedor_id uuid,add column data_entrada date,add column parcelas int default 1,add column total_itens numeric default 0,add column total_liquido numeric default 0,add column desconto_valor numeric default 0,add column frete_valor numeric default 0,add column nf_numero text;
 alter table compra_itens add column custo_unitario numeric,add column total numeric generated always as(round(quantidade*custo_unitario,2)) stored;
 create table contas_pagar(id uuid default gen_random_uuid(),fornecedor_id uuid,compra_id uuid,documento text,parcela int,valor numeric,vencimento date,centro_id uuid,data_emissao date,status text);
 alter table comissoes add column status text default 'prevista';
 create table tabela_preco_itens(id uuid,preco numeric);insert into tabela_preco_itens values('${id(9011)}',8);
 `);
  await load("fase246_catalogo_categoria_loja.sql", "produto_categoria_loja_246");
  await db.exec(fs.readFileSync(path.join(root, "db/fase23_markup_fixo.sql"), "utf8"));
  await load("fase41_forma_pagamento_desconto_acrescimo.sql", "recalcular_pedido");
  await load("fase2_vendas_estoque_financeiro.sql", "recalcular_compra");
  await load("fase70_integridade_compras_financeiro.sql", "receber_compra");
  await db.exec(
    fs.readFileSync(path.join(root, "db/fase227_prazos_forma_pagamento_pedido.sql"), "utf8"),
  );
  await db.exec(
    fs.readFileSync(path.join(root, "db/fase88_idempotencia_faturamento_pedido.sql"), "utf8"),
  );
  await db.query(
    "update produtos set permite_estoque_negativo=false,custo_medio=5,preco_venda=10,markup_percentual=100 where id=$1",
    [id(20)],
  );
  await db.query("update estoque_saldos set custo_medio=5 where produto_id=$1 and centro_id=$2", [
    id(20),
    id(10),
  ]);
  await db.exec(
    fs.readFileSync(path.join(root, "db/fase275_preco_produto_sincronizado.sql"), "utf8"),
  );
  const physical = async (product) =>
    Number(
      (await db.query("select estoque_atual from produtos where id=$1", [product])).rows[0]
        .estoque_atual,
    );
  const other = await physical(id(21));
  assert.equal(await physical(id(20)), 10);
  // Recebimento real: estoque físico + saldo da loja + depósito + contas a pagar + markup/preço.
  await db.query(
    "insert into compras(id,centro_id,status,numero,fornecedor_id,data_entrada,parcelas) values($1,$2,'comprado',9000,$3,current_date,2)",
    [id(9000), id(10), id(50)],
  );
  await db.query(
    "insert into compra_itens(compra_id,produto_id,quantidade,custo_unitario) values($1,$2,10,7)",
    [id(9000), id(20)],
  );
  await db.query("select receber_compra($1)", [id(9000)]);
  await db.query("select receber_compra($1)", [id(9000)]);
  assert.equal(await physical(id(20)), 20);
  assert.equal(
    Number(
      (await db.query("select preco_venda from produtos where id=$1", [id(20)])).rows[0]
        .preco_venda,
    ),
    12,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select preco_venda from loja_produtos where produto_id=$1 and centro_id=$2",
          [id(20), id(10)],
        )
      ).rows[0].preco_venda,
    ),
    12,
  );
  const payable = (
    await db.query(
      "select count(*)::int n,sum(valor)::float valor from contas_pagar where compra_id=$1",
      [id(9000)],
    )
  ).rows[0];
  assert.deepEqual(payable, { n: 2, valor: 70 });
  // Confirmação real: total de itens -> parcelas com prazos20/40 -> baixa única no depósito próprio.
  await db.query(
    "insert into pedidos(id,numero,centro_id,cliente_id,status,data_pedido,parcelas,forma_pagamento_id) values($1,9001,$2,$3,'rascunho',current_date,2,$4)",
    [id(9001), id(10), id(50), id(9010)],
  );
  await db.query(
    "insert into pedido_itens(pedido_id,produto_id,quantidade,preco_unitario) values($1,$2,3,12)",
    [id(9001), id(20)],
  );
  await db.query("select confirmar_pedido($1)", [id(9001)]);
  await db.query("select confirmar_pedido($1)", [id(9001)]);
  assert.equal(await physical(id(20)), 17);
  assert.equal(await physical(id(21)), other);
  const receivable = (
    await db.query(
      "select count(*)::int n,sum(valor)::float valor from contas_receber where pedido_id=$1",
      [id(9001)],
    )
  ).rows[0];
  assert.deepEqual(receivable, { n: 2, valor: 36 });
  const terms = (
    await db.query(
      "select vencimento-(select data_pedido from pedidos where id=$1) dias from contas_receber where pedido_id=$1 order by parcela",
      [id(9001)],
    )
  ).rows;
  assert.deepEqual(
    terms.map((r) => r.dias),
    [20, 40],
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select quantidade from estoque_saldos where produto_id=$1 and centro_id=$2",
          [id(20), id(10)],
        )
      ).rows[0].quantidade,
    ),
    17,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select sum(s.quantidade) q from deposito_saldos s join depositos d on d.id=s.deposito_id where s.produto_id=$1 and d.centro_id=$2",
          [id(20), id(10)],
        )
      ).rows[0].q,
    ),
    17,
  );
  // Alterar o catálogo depois da venda não reprecifica itens já gravados, parcelas ou promoção.
  await db.query("select salvar_produto_loja_244($1,$2,true,14,null)", [id(10), id(20)]);
  assert.equal(
    Number(
      (await db.query("select preco_venda from produtos where id=$1", [id(20)])).rows[0]
        .preco_venda,
    ),
    14,
  );
  assert.equal(
    Number(
      (await db.query("select preco_unitario from pedido_itens where pedido_id=$1", [id(9001)]))
        .rows[0].preco_unitario,
    ),
    12,
  );
  assert.equal(
    Number(
      (await db.query("select sum(valor) v from contas_receber where pedido_id=$1", [id(9001)]))
        .rows[0].v,
    ),
    36,
  );
  assert.equal(Number((await db.query("select preco from tabela_preco_itens")).rows[0].preco), 8);
  // Falha de saldo reverte confirmação e não cria recebível nem movimento.
  await db.query(
    "insert into pedidos(id,numero,centro_id,cliente_id,status,data_pedido,parcelas) values($1,9002,$2,$3,'rascunho',current_date,1)",
    [id(9002), id(10), id(50)],
  );
  await db.query(
    "insert into pedido_itens(pedido_id,produto_id,quantidade,preco_unitario) values($1,$2,1000,14)",
    [id(9002), id(20)],
  );
  await assert.rejects(db.query("select confirmar_pedido($1)", [id(9002)]), /Estoque insuficiente/);
  assert.equal(
    (await db.query("select status from pedidos where id=$1", [id(9002)])).rows[0].status,
    "rascunho",
  );
  assert.equal(
    (await db.query("select count(*)::int n from contas_receber where pedido_id=$1", [id(9002)]))
      .rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query("select count(*)::int n from estoque_movimentos where documento_id=$1", [
        id(9002),
      ])
    ).rows[0].n,
    0,
  );
  assert.equal(await physical(id(20)), 17);
  console.log(
    "Fluxo integrado276 OK: compra recebida→estoque/depósito→custo/markup/preço sincronizado→pedido calculado→baixa→recebíveis20/40, repetição sem duplicidade e rollback por saldo insuficiente. Resolvedor de comissão simulado neste cenário; comissões reais cobertas nas suítes próprias.",
  );
};
