const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;
create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;
create function can_operate(uuid) returns boolean language sql as $$select true$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='${id(10)}'::uuid$$;
create table centros(id uuid primary key,nome text);
create table produtos(id uuid primary key,descricao text,permite_estoque_negativo boolean default false,estoque_atual numeric default 0,custo_medio numeric default 0);
create table estoque_saldos(produto_id uuid references produtos(id),centro_id uuid references centros(id),quantidade numeric default 0,custo_medio numeric default 0,updated_at timestamptz default now(),primary key(produto_id,centro_id));
create table depositos(id uuid primary key default gen_random_uuid(),centro_id uuid,nome text,padrao boolean,ativo boolean default true);
create unique index dep_padrao on depositos(centro_id) where padrao;
create table deposito_saldos(deposito_id uuid,produto_id uuid,quantidade numeric default 0 check(quantidade>=0),primary key(deposito_id,produto_id));
create table deposito_movimentos(id uuid default gen_random_uuid(),deposito_id uuid,produto_id uuid,quantidade numeric,origem text not null,documento_id uuid);
create table inventarios(id uuid,deposito_id uuid);
create table estoque_reservas(pedido_id uuid,produto_id uuid,centro_id uuid,quantidade numeric,primary key(pedido_id,produto_id));
create table estoque_movimentos(id uuid default gen_random_uuid(),produto_id uuid,centro_id uuid,tipo text,quantidade numeric,custo_unitario numeric,origem text,documento_id uuid,observacao text,created_by uuid);
create table pedidos(id uuid primary key,numero int,centro_id uuid,cliente_id uuid,status text,total_liquido numeric,total_itens numeric,parcelas int,data_pedido date,representante_id uuid,comissao_valor numeric default 0,comissao_percentual numeric default 0);
create table pedido_itens(pedido_id uuid,produto_id uuid,quantidade numeric);
create table creditos_clientes(id uuid,status text,cliente_id uuid,centro_id uuid,saldo numeric);
create table creditos_clientes_aplicacoes(id uuid,credito_id uuid,pedido_id uuid,status text,valor numeric,aplicado_em timestamptz);
create table contas_receber(id uuid default gen_random_uuid(),cliente_id uuid,pedido_id uuid,documento text,parcela int,valor numeric,vencimento date,centro_id uuid,data_emissao date,status text);
create table comissoes(representante_id uuid,pedido_id uuid,base_calculo numeric,percentual numeric,valor numeric,centro_id uuid);
create table auditoria(tabela text,registro_id uuid,acao text,detalhe jsonb,user_id uuid);
create function recalcular_pedido(uuid) returns void language sql as $$select$$;
insert into pedidos values('${id(30)}',1,'${id(10)}','${id(50)}','rascunho',100,100,1,current_date,null,0,0);
insert into pedido_itens values('${id(30)}','${id(20)}',100);
insert into centros values('${id(10)}','Ferragens'),('${id(11)}','Outro centro');
insert into produtos values('${id(20)}','PREGO C/CABE 17X21',true,0,0),('${id(21)}','Produto sem negativo',false,0,0);
insert into depositos(id,centro_id,nome,padrao) values('${id(60)}','${id(10)}','Principal',true),('${id(61)}','${id(11)}','Principal',true);
insert into deposito_saldos values('${id(61)}','${id(20)}',500);
insert into estoque_saldos(produto_id,centro_id,quantidade) values('${id(20)}','${id(10)}',0),('${id(20)}','${id(11)}',500);
`);
    const load = async (file, name) => {
      const sql = fs.readFileSync(path.join(root, "db", file), "utf8"),
        start = sql.indexOf("create or replace function public." + name + "(");
      assert.ok(start >= 0);
      await db.exec(sql.slice(start, sql.indexOf("$$;", start) + 3));
    };
    await load("fase55_estoque_por_centro.sql", "validar_estoque_negativo");
    await load("fase55_estoque_por_centro.sql", "aplicar_movimento_estoque");
    await load(
      "fase70_integridade_compras_financeiro.sql",
      "registrar_movimento_estoque_controlado",
    );
    await load("fase212_reservas_estoque.sql", "validar_disponivel_212");
    await load("fase80_credito_cliente_devolucao.sql", "confirmar_pedido");
    await load("fase213_depositos_inventario.sql", "depositar_movimento_213");
    await db.exec(
      "create trigger z_depositar_movimento_213 after insert on estoque_movimentos for each row execute function depositar_movimento_213()",
    );
    await db.exec(
      `create trigger a_disponivel_212 before insert on estoque_movimentos for each row execute function validar_disponivel_212();create trigger aa_valida_estoque_negativo before insert on estoque_movimentos for each row execute function validar_estoque_negativo();create trigger saldo after insert on estoque_movimentos for each row execute function aplicar_movimento_estoque();`,
    );
    const move = (
      product = id(20),
      q = 100,
      origem = "pedido",
      doc = id(30),
      type = "saida",
      centre = id(10),
    ) =>
      db.query("select registrar_movimento_estoque_controlado($1,$2,$3,$4,null,$5,$6,null)", [
        product,
        centre,
        type,
        q,
        origem,
        doc,
      ]);
    await assert.rejects(
      db.query("select confirmar_pedido($1)", [id(30)]),
      /reservada \(saldo 0, reservado 0\)/,
    );
    assert.equal(
      (await db.query("select status from pedidos where id=$1", [id(30)])).rows[0].status,
      "rascunho",
    );
    assert.equal((await db.query("select count(*) n from contas_receber")).rows[0].n, 0);
    assert.equal((await db.query("select count(*) n from estoque_movimentos")).rows[0].n, 0);
    // Sem o ajuste do depósito, a mesma confirmação ainda falharia na fase213.
    let oldSource = fs.readFileSync(path.join(root, "db/fase212_reservas_estoque.sql"), "utf8");
    let start = oldSource.indexOf("create or replace function public.validar_disponivel_212(");
    await db.exec(
      oldSource
        .slice(start, oldSource.indexOf("$$;", start) + 3)
        .replace(
          "if coalesce(saldo,0)+delta<reservado",
          "if reservado>0 and coalesce(saldo,0)+delta<reservado",
        ),
    );
    await assert.rejects(
      db.query("select confirmar_pedido($1)", [id(30)]),
      /Saldo físico por depósito insuficiente/,
    );
    assert.equal((await db.query("select count(*) n from estoque_movimentos")).rows[0].n, 0);
    const sql = fs.readFileSync(
      path.join(root, "db/fase225_correcao_reserva_estoque_negativo.sql"),
      "utf8",
    );
    await db.exec(sql);
    await db.exec(sql);
    await db.query("select confirmar_pedido($1)", [id(30)]);
    await db.query("select confirmar_pedido($1)", [id(30)]);
    assert.equal((await db.query("select count(*) n from contas_receber")).rows[0].n, 1);
    assert.equal(
      (await db.query("select status from pedidos where id=$1", [id(30)])).rows[0].status,
      "confirmado",
    );
    const saldo = async (p = id(20), c = id(10)) =>
      Number(
        (
          await db.query(
            "select quantidade from estoque_saldos where produto_id=$1 and centro_id=$2",
            [p, c],
          )
        ).rows[0]?.quantidade ?? 0,
      );
    assert.equal(await saldo(), -100);
    assert.equal(await saldo(id(20), id(11)), 500);
    await assert.rejects(move(id(21)), /Estoque insuficiente para Produto sem negativo/);
    assert.equal(await saldo(id(21)), 0);
    assert.equal((await db.query("select count(*) n from estoque_movimentos")).rows[0].n, 1);
    // Não empresta estoque de outro centro nem habilita a opção automaticamente.
    await db.exec(`update produtos set permite_estoque_negativo=false where id='${id(20)}'`);
    await assert.rejects(move(), /Estoque insuficiente.*centro selecionado/);
    await move(id(20), 200, "compra", null, "entrada");
    assert.equal(await saldo(), 100);
    await db.exec(
      `insert into estoque_reservas values('${id(31)}','${id(20)}','${id(10)}',80);update produtos set permite_estoque_negativo=true where id='${id(20)}'`,
    );
    await assert.rejects(move(id(20), 21), /PREGO C\/CABE 17X21.*Ferragens.*reservado 80/);
    await assert.rejects(move(id(20), 21, null, id(31)), /reservada/);
    await move(id(20), 20);
    assert.equal(await saldo(), 80);
    // A própria reserva pode ser consumida, sem liberar reservas de outros pedidos.
    await db.exec(`insert into estoque_reservas values('${id(32)}','${id(20)}','${id(10)}',10)`);
    await assert.rejects(move(id(20), 80, "pedido", id(31)), /reservado 10/);
    await move(id(20), 70, "pedido", id(31));
    assert.equal(await saldo(), 10);
    await assert.rejects(move(id(20), -1, "inventario", null, "ajuste"), /reservada/);
    await db.exec(
      `delete from estoque_reservas;update produtos set permite_estoque_negativo=false where id='${id(20)}'`,
    );
    await move(id(20), 10);
    assert.equal(await saldo(), 0);
    await assert.rejects(move(id(20), 1), /Estoque insuficiente/);
    await assert.rejects(
      move(id(20), 1, "pedido", id(30), "saida", id(11)),
      /sem acesso ao centro/,
    );
    // Produto autorizado sem linha de saldo prévia também segue o mesmo motor.
    await db.exec(`insert into produtos values('${id(22)}','Produto novo autorizado',true,0,0)`);
    await move(id(22), 2);
    assert.equal(await saldo(id(22)), -2);
    assert.equal(
      (await db.query("select permite_estoque_negativo from produtos where id=$1", [id(21)]))
        .rows[0].permite_estoque_negativo,
      false,
    );
    const dep = await db.query(
      "select s.produto_id,p.centro_id,sum(s.quantidade) q from deposito_saldos s join depositos p on p.id=s.deposito_id group by s.produto_id,p.centro_id",
    );
    for (const r of dep.rows) assert.equal(Number(r.q), await saldo(r.produto_id, r.centro_id));
    await db.exec(`update produtos set permite_estoque_negativo=false where id='${id(22)}'`);
    await move(id(22), 1, "compra", null, "entrada");
    assert.equal(await saldo(id(22)), -1);
    await assert.rejects(move(id(22), 1), /Estoque insuficiente/);
    await assert.rejects(
      db.query("insert into deposito_saldos values($1,$2,-5)", [id(60), id(21)]),
      /Produto nao permite/,
    );
    await db.exec(`insert into produtos values('${id(23)}','Produto com divergencia antiga',true,100,0);
insert into estoque_saldos(produto_id,centro_id,quantidade) values('${id(23)}','${id(10)}',100);
insert into deposito_saldos values('${id(60)}','${id(23)}',90);`);
    await assert.rejects(move(id(23), 200), /Saldo do centro e depósitos divergem/);
    assert.equal(await saldo(id(23)), 100);
    assert.equal(
      Number(
        (await db.query("select quantidade from deposito_saldos where produto_id=$1", [id(23)]))
          .rows[0].quantidade,
      ),
      90,
    );
    console.log(
      "Reservas225 OK: erro saldo0/reservado0 reproduzido; regra de negativo respeitada; reservas reais protegidas; própria reserva, limite exato, ajustes, entradas, origem nula e centros verificados; depósitos conciliados, entradas regularizam negativos, divergências bloqueadas; confirmação real de teste idempotente, com recebível único e rollback; migração reaplicável.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
