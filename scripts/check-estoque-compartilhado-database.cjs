const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
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
    // Nova regra comercial: ambos os centros consomem o mesmo saldo.
    await db.exec(`
      alter table centros add column ativo boolean default true;
      alter table produtos add column codigo text,add column unidade text,add column estoque_minimo numeric default 0,add column estoque_maximo numeric default 0,add column prazo_fornecedor_dias int default 0,add column ativo boolean default true;
      alter table pedidos add column created_at timestamptz default now();
      alter table depositos add constraint depositos_centro_id_nome_key unique(centro_id,nome);
      alter table deposito_saldos add column endereco text;
      alter table inventarios add column status text default 'contagem',add column criado_por uuid,add column conferido_por uuid,add column conferido_em timestamptz;
      create table inventario_itens(inventario_id uuid,produto_id uuid,esperado numeric,contado numeric,primary key(inventario_id,produto_id));
      create table compras(id uuid,centro_id uuid,status text);
      create table compra_itens(compra_id uuid,produto_id uuid,quantidade numeric);
      create table devolucoes(id uuid,centro_id uuid,status text);
      create table entrega_itens(devolucao_id uuid);
      create function usuario_ativo() returns boolean language sql as $$select coalesce(current_setting('test.active',true),'true')<>'false'$$;
      create function can_manage(uuid) returns boolean language sql as $$select coalesce(current_setting('test.manage',true),'true')<>'false'$$;
      create function pode_rotina(text) returns boolean language sql as $$select coalesce(current_setting('test.routine',true),'true')<>'false'$$;
      create function has_role(uuid,text) returns boolean language sql as $$select false$$;
      create function escopo_representante() returns boolean language sql as $$select false$$;
      create function documento_na_minha_carteira(text,uuid) returns boolean language sql as $$select true$$;
      grant usage on schema public,auth to authenticated;
      grant select on produtos,centros,depositos to authenticated;
      update produtos set estoque_atual=500 where id='${id(20)}';
      update produtos set estoque_atual=1000 where id='${id(21)}';
    `);
    await load("fase212_reservas_estoque.sql", "total_reservado_212");
    await db.exec("alter table estoque_saldos alter column quantidade type numeric(14,3)");
    const oldReserveSql = fs.readFileSync(
      path.join(root, "db/fase212_reservas_estoque.sql"),
      "utf8",
    );
    const viewStart = oldReserveSql.indexOf(
      "create or replace view public.vw_estoque_disponivel_212",
    );
    await db.exec(oldReserveSql.slice(viewStart, oldReserveSql.indexOf(";", viewStart) + 1));

    await db.exec(
      fs.readFileSync(path.join(root, "db/fase56_planejamento_compras_centro.sql"), "utf8"),
    );
    await db.exec(
      fs.readFileSync(path.join(root, "db/fase225_correcao_reserva_estoque_negativo.sql"), "utf8"),
    );
    const migration = fs.readFileSync(
      path.join(root, "db/fase226_estoque_compartilhado.sql"),
      "utf8",
    );
    const q = async (sql, args = []) => (await db.query(sql, args)).rows;
    const stock = async (p = id(21)) =>
      Number((await q("select estoque_atual n from produtos where id=$1", [p]))[0].n);
    const warehouses = async (p = id(21)) =>
      Number(
        (
          await q("select coalesce(sum(quantidade),0) n from deposito_saldos where produto_id=$1", [
            p,
          ])
        )[0].n,
      );
    // Divergência real preexistente aborta toda a migração, sem modificar saldo.
    await db.exec(`update produtos set estoque_atual=501 where id='${id(20)}'`);
    await assert.rejects(db.exec(migration), /diverge dos depósitos/);
    await db.exec("rollback");
    assert.equal(await stock(id(21)), 1000);
    await db.exec(`update produtos set estoque_atual=500 where id='${id(20)}'`);
    await db.exec(migration);
    await db.exec(migration);
    assert.equal(await stock(), 1000);
    assert.equal(await warehouses(), 1000);
    assert.equal(await warehouses(id(20)), 500);
    assert.equal(
      Number(
        (await q("select count(*) n from auditoria where acao='distribuicao_legado_226'"))[0].n,
      ),
      1,
    );
    // 500 unidades fisicamente no outro centro atendem o pedido do centro10.
    await db.query("select confirmar_pedido($1)", [id(30)]);
    await db.query("select confirmar_pedido($1)", [id(30)]);
    assert.equal(await stock(id(20)), 400);
    assert.equal(await warehouses(id(20)), 400);
    assert.equal(Number((await q("select count(*) n from contas_receber"))[0].n), 1);
    // Produto sem venda negativa: saída60 do pedido deixa940, não estoque0 por centro.
    await move(id(21), 60, "manual", null);
    assert.equal(await stock(), 940);
    assert.equal(await warehouses(), 940);
    await db.exec(
      `create or replace function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1 in ('${id(10)}'::uuid,'${id(11)}'::uuid)$$`,
    );
    await move(id(21), 40, "manual", null, "saida", id(11));
    assert.equal(await stock(), 900);
    assert.equal(await warehouses(), 900);
    // Reserva de outra loja protege o mesmo saldo, inclusive origemNULL.
    await db.exec(`insert into estoque_reservas values('${id(31)}','${id(21)}','${id(11)}',850)`);
    await assert.rejects(move(id(21), 51, null, null), /compartilhado reservado/);
    assert.equal(await stock(), 900);
    await move(id(21), 50, "manual", null);
    assert.equal(await stock(), 850);
    await move(id(21), 850, "pedido", id(31));
    assert.equal(await stock(), 0);
    assert.equal(await warehouses(), 0);
    await db.exec("delete from estoque_reservas");
    await assert.rejects(move(id(21), 1, "manual", null), /estoque compartilhado/);
    // Recebimento por outra loja reabastece exatamente o mesmo saldo.
    await move(id(21), 100, "compra", id(99), "entrada", id(11));
    assert.equal(await stock(), 100);
    assert.equal(await warehouses(), 100);
    // Aprovação também consulta todas as reservas, independentemente do centro.
    await load("fase226_estoque_compartilhado.sql", "reservar_pedido_212");
    await db.exec(
      "create trigger reserva_pedido_212 after update of status on pedidos for each row execute function reservar_pedido_212()",
    );
    await db.exec(`insert into pedidos(id,centro_id,status) values('${id(32)}','${id(10)}','rascunho'),('${id(33)}','${id(10)}','rascunho');
      insert into pedido_itens values('${id(32)}','${id(21)}',70),('${id(33)}','${id(21)}',40);`);
    await db.exec(`update pedidos set status='aprovado' where id='${id(32)}'`);
    await assert.rejects(
      db.exec(`update pedidos set status='aprovado' where id='${id(33)}'`),
      /disponível insuficiente/,
    );
    assert.equal(Number((await q("select total_reservado_226($1) n", [id(21)]))[0].n), 70);
    // Política explícita de negativo continua válida, sem duplicar depósitos.
    await move(id(20), 450, "manual", null);
    assert.equal(await stock(id(20)), -50);
    assert.equal(await warehouses(id(20)), -50);
    // Cadastro não pode desalinhar estoque; uma entrada real pode repor o saldo.
    await assert.rejects(
      db.exec(`update produtos set estoque_atual=9999 where id='${id(21)}'`),
      /rotina de estoque/,
    );
    await move(id(20), 60, "manual", null, "entrada");
    assert.equal(await stock(id(20)), 10);
    assert.equal(await warehouses(id(20)), 10);
    // Transferência física entre depósitos de centros diferentes conserva o total.
    await db
      .query("select transferir_deposito_213($1,$2,$3,5,$4)", [id(61), id(60), id(20), id(80)])
      .catch(async (error) => {
        // Após consumo, o saldo positivo está no depósito compartilhado de entradas.
        if (!/Saldo insuficiente/.test(error.message)) throw error;
        const [{ deposito_entrada }] = await q(
          "select deposito_entrada from estoque_compartilhado_226",
        );
        await db.query("select transferir_deposito_213($1,$2,$3,5,$4)", [
          deposito_entrada,
          id(61),
          id(20),
          id(80),
        ]);
      });
    assert.equal(await stock(id(20)), 10);
    assert.equal(await warehouses(id(20)), 10);
    // Inventário no depósito de outra loja altera o global uma única vez.
    await db.exec(
      "alter table inventarios alter column id set default gen_random_uuid();alter table inventarios add primary key(id)",
    );
    const [{ deposito_entrada: shared }] = await q(
      "select deposito_entrada from estoque_compartilhado_226",
    );
    const [{ abrir_inventario_213: inv }] = await q("select abrir_inventario_213($1)", [shared]);
    const invRows = await q("select * from inventario_itens where inventario_id=$1", [inv]);
    for (const item of invRows) {
      const counted = Number(item.esperado) + (item.produto_id === id(20) ? 2 : 0);
      await db.query("select contar_inventario_213($1,$2,$3)", [inv, item.produto_id, counted]);
    }
    await db.query("select conferir_inventario_213($1)", [inv]);
    await db.query("select conferir_inventario_213($1)", [inv]);
    assert.equal(await stock(id(20)), 12);
    assert.equal(await warehouses(id(20)), 12);
    // Planejamento retorna uma posição global por produto, sem duplicar por loja.
    assert.equal(Number((await q("select count(*) n from vw_sugestao_compras_centro"))[0].n), 2);
    assert.equal(
      Number(
        (
          await q("select estoque_atual n from vw_sugestao_compras_centro where produto_id=$1", [
            id(21),
          ])
        )[0].n,
      ),
      100,
    );
    // RLS permanece ativa; acesso agregado não concede escrita nem revela reservas.
    await db.exec(`alter table produtos enable row level security;
      create policy leitura_produtos on produtos for select to authenticated using(usuario_ativo());
      alter table depositos enable row level security;
      set role authenticated;`);
    const visible = await q("select * from vw_estoque_compartilhado_226 where produto_id=$1", [
      id(21),
    ]);
    assert.equal(Number(visible[0].reservado), 70);
    assert.equal(Number(visible[0].disponivel), 30);
    await assert.rejects(db.query("select * from estoque_compartilhado_226"), /permission denied/);
    await assert.rejects(db.query("select * from estoque_reservas"), /permission denied/);
    await assert.rejects(db.query("update produtos set estoque_atual=42"), /permission denied/);
    await db.exec("reset role");
    // Leitura global não revela pedidos; sessão inativa não lê reserva agregada.
    await db.exec("set test.active='false'");
    assert.equal(Number((await q("select total_reservado_226($1) n", [id(21)]))[0].n), 0);
    await db.exec("set test.active='true';set test.routine='false'");
    await assert.rejects(db.query("select abrir_inventario_213($1)", [id(60)]), /Sem acesso/);
    console.log(
      "OK fase226: legado1000 preservado, duas lojas, reservas globais, confirmação idempotente, depósitos e bloqueios.",
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
