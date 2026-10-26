const fs = require("node:fs");
const assert = require("node:assert/strict");
module.exports = async (db, id) => {
  await db.exec(`set test.routine='true';set test.active='true';
 create table cad_categorias(id uuid primary key,nome_norm text);
 insert into cad_categorias values('${id(200)}','ferragens'),('${id(201)}','cimento');
 create function norm_txt(text) returns text language sql immutable as $$select lower(trim($1))$$;
 alter table produtos add column categoria text;
 update produtos set categoria=case when id='${id(20)}' then 'Ferragens' else 'Cimento' end;
 alter table centros add column categoria_produtos_id uuid;
 update centros set categoria_produtos_id='${id(200)}';
 create function produto_categoria_loja_246(uuid,uuid) returns boolean language sql as $$select true$$;
 `);
  // Catálogo real da fase244 com o filtro adicionado pela fase246.
  await db.exec(
    "alter table produtos add column peso_kg numeric;create table loja_produtos(centro_id uuid,produto_id uuid,preco_venda numeric,disponivel boolean,desconto_maximo numeric)",
  );
  await db.exec(
    "insert into loja_produtos select c.id,p.id,10,true,0 from centros c cross join produtos p",
  );
  let catalogo = fs.readFileSync("db/fase244_catalogo_precos_lojas.sql", "utf8");
  let ca = catalogo.indexOf("create or replace function public.listar_catalogo_loja_244(");
  catalogo = catalogo
    .slice(ca, catalogo.indexOf("$$;", ca) + 3)
    .replace(
      "where l.centro_id=_loja and",
      "where public.produto_categoria_loja_246(_loja,p.id) and l.centro_id=_loja and",
    );
  await db.exec(catalogo);
  const sql = fs.readFileSync("db/fase271_estoque_proprio_por_loja.sql", "utf8");
  await assert.rejects(db.exec(sql), /categoria vinculada a uma única loja/);
  await db.exec("rollback");
  assert.equal(
    (await db.query("select to_regclass('public.estoque_por_loja_271') r")).rows[0].r,
    null,
  );
  await db.query("update centros set categoria_produtos_id=$1 where id=$2", [id(201), id(11)]);
  await assert.rejects(db.exec(sql), /reserva de produto na loja incorreta/);
  await db.exec("rollback");
  // Corrige apenas o fixture inconsistente criado pelos testes do antigo modelo global.
  await db.query("update estoque_reservas set centro_id=$1 where produto_id=$2", [id(11), id(21)]);
  await db.query("update pedidos set centro_id=$1 where id=$2", [id(11), id(32)]);
  const [{ deposito_entrada: shared }] = (
    await db.query("select deposito_entrada from estoque_compartilhado_226")
  ).rows;
  await db.query("insert into inventarios(id,deposito_id,status) values($1,$2,'contagem')", [
    id(300),
    shared,
  ]);
  const snapshot = async () =>
    (
      await db.query(
        `select (select jsonb_agg(to_jsonb(p) order by p.id) from produtos p) produtos,(select jsonb_agg(to_jsonb(p) order by p.id) from pedidos p) pedidos,(select jsonb_agg(to_jsonb(c)) from contas_receber c) financeiro,(select jsonb_agg(to_jsonb(c)) from comissoes c) comissoes,(select jsonb_agg(to_jsonb(r)) from estoque_reservas r) reservas,(select jsonb_agg(to_jsonb(c) order by c.id) from centros c) lojas`,
      )
    ).rows[0];
  const before = await snapshot();
  await db.exec(sql);
  await db.exec(sql);
  assert.deepEqual(await snapshot(), before);
  assert.equal(
    (await db.query("select status from inventarios where id=$1", [id(300)])).rows[0].status,
    "cancelado",
  );
  assert.equal((await db.query("select count(*)::int n from depositos where ativo")).rows[0].n, 2);
  assert.equal(
    (await db.query("select * from listar_catalogo_loja_244($1)", [id(10)])).rows.length,
    1,
  );
  assert.equal(
    (await db.query("select * from listar_catalogo_loja_244($1)", [id(11)])).rows.length,
    1,
  );
  const saldo = async (c, p) =>
    (await db.query("select * from saldos_estoque_loja_271($1) where produto_id=$2", [c, p])).rows;
  assert.equal(Number((await saldo(id(10), id(20)))[0].fisico), 12);
  assert.equal((await saldo(id(10), id(21))).length, 0);
  assert.equal(Number((await saldo(id(11), id(21)))[0].fisico), 100);
  assert.equal(Number((await saldo(id(11), id(21)))[0].reservado), 70);
  const move = (c, p, q, t = "saida") =>
    db.query("select registrar_movimento_estoque_controlado($1,$2,$3,$4,null,'manual',null,null)", [
      p,
      c,
      t,
      q,
    ]);
  await assert.rejects(move(id(10), id(21), 1), /outra loja/);
  await assert.rejects(move(id(10), id(21), 1, "entrada"), /outra loja/);
  await assert.rejects(move(id(11), id(21), 31), /reservado desta loja/);
  await move(id(10), id(20), 2);
  assert.equal(Number((await saldo(id(10), id(20)))[0].fisico), 10);
  assert.equal(Number((await saldo(id(11), id(21)))[0].fisico), 100);
  await move(id(11), id(21), 20, "entrada");
  assert.equal(Number((await saldo(id(11), id(21)))[0].fisico), 120);
  const actual = (
    await db.query("select * from deposito_saldos where deposito_id=$1 and produto_id=$2", [
      id(61),
      id(21),
    ])
  ).rows[0];
  assert.equal(Number(actual.quantidade), 120);
  // Confirmação real do motor de vendas baixa somente a loja do pedido.
  await db.query(
    "insert into pedidos(id,numero,centro_id,cliente_id,status,total_liquido,total_itens,parcelas,data_pedido) values($1,3,$2,$3,'rascunho',60,60,1,current_date)",
    [id(340), id(11), id(50)],
  );
  await db.query("insert into pedido_itens(pedido_id,produto_id,quantidade) values($1,$2,20)", [
    id(340),
    id(21),
  ]);
  await db.query("select confirmar_pedido($1)", [id(340)]);
  await db.query("select confirmar_pedido($1)", [id(340)]);
  assert.equal(Number((await saldo(id(11), id(21)))[0].fisico), 100);
  assert.equal(Number((await saldo(id(10), id(20)))[0].fisico), 10);
  await assert.rejects(
    db.query("update pedidos set status='aprovado' where id=$1", [id(33)]),
    /não pertence ao estoque desta loja/,
  );
  const inv = (await db.query("select abrir_inventario_213($1) i", [id(61)])).rows[0].i;
  await assert.rejects(
    db.query("select contar_inventario_213($1,$2,10)", [inv, id(20)]),
    /não pertence ao depósito/,
  );
  await db.query("select contar_inventario_213($1,$2,105)", [inv, id(21)]);
  await db.query("select conferir_inventario_213($1)", [inv]);
  await db.query("select conferir_inventario_213($1)", [inv]);
  assert.equal(Number((await saldo(id(11), id(21)))[0].fisico), 105);
  assert.equal(Number((await saldo(id(10), id(20)))[0].fisico), 10);
  await assert.rejects(
    db.query("update produtos set categoria='Ferragens' where id=$1", [id(21)]),
    /não altere sua categoria/,
  );
  await assert.rejects(
    db.query("update centros set categoria_produtos_id=$1 where id=$2", [id(201), id(10)]),
    /Loja com estoque/,
  );
  await db.query(
    "insert into pedidos(id,centro_id,status) values($1,$3,'rascunho'),($2,$3,'rascunho')",
    [id(345), id(346), id(11)],
  );
  await db.query(
    "insert into pedido_itens(pedido_id,produto_id,quantidade) values($1,$3,20),($2,$3,20)",
    [id(345), id(346), id(21)],
  );
  await db.query("update pedidos set status='aprovado' where id=$1", [id(345)]);
  assert.equal(Number((await saldo(id(11), id(21)))[0].reservado), 90);
  await assert.rejects(
    db.query("update pedidos set status='aprovado' where id=$1", [id(346)]),
    /disponível insuficiente/,
  );
  await db.query("update pedidos set status='cancelado' where id=$1", [id(345)]);
  assert.equal(Number((await saldo(id(11), id(21)))[0].reservado), 70);
  await db.query("update centros set nome='Loja de Cimentos' where id=$1", [id(11)]);
  assert.equal(Number((await saldo(id(11), id(21)))[0].fisico), 105);
  await assert.rejects(
    db.query("select transferir_deposito_213($1,$2,$3,1,$4)", [id(60), id(61), id(20), id(303)]),
    /Não transfira/,
  );
  await db.exec(
    `create or replace function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='${id(10)}'::uuid$$;set role authenticated;`,
  );
  await assert.rejects(saldo(id(11), id(21)), /Loja sem acesso/);
  const posicoes = (await db.query("select distinct centro_id from vw_estoque_disponivel_212"))
    .rows;
  assert.deepEqual(
    posicoes.map((r) => r.centro_id),
    [id(10)],
  );
  assert.equal((await saldo(id(10), id(21))).length, 0);
  await assert.rejects(db.query("select abrir_inventario_213($1)", [id(61)]), /Sem acesso/);
  await assert.rejects(db.query("select * from estoque_retrato_271"), /permission denied/);
  await db.exec("reset role");
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from auditoria where tabela='fase271' and acao='instalada'",
      )
    ).rows[0].n,
    1,
  );
  console.log(
    "Estoque271 OK: categoria ambígua/reserva incorreta abortam sem efeitos, redistribuição por loja preserva total e histórico, duas lojas isoladas, entradas/saídas locais, reservas, renomeação e acesso ao inventário verificados.",
  );
};
