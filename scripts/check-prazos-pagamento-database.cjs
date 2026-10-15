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

    await db.exec(`create table formas_pagamento(id uuid primary key,nome text,parcelas_padrao int,dias_primeira_parcela int,intervalo_dias int);
      alter table pedidos add column forma_pagamento_id uuid references formas_pagamento(id);
      insert into formas_pagamento values('${id(70)}','Boleto20/40/60',3,20,20);
      update pedidos set forma_pagamento_id='${id(70)}',parcelas=3,data_pedido='2026-10-15',total_liquido=2779;
      create function validar_pedido(uuid) returns jsonb language sql as $$select '[]'::jsonb$$;
    `);
    await db.exec(
      fs.readFileSync(path.join(root, "db/fase225_correcao_reserva_estoque_negativo.sql"), "utf8"),
    );
    const source209 = fs.readFileSync(
      path.join(root, "db/fase209_rotinas_distribuidora.sql"),
      "utf8",
    );
    const marker = source209.indexOf("-- A confirmação conserva estoque/crédito/idempotência");
    const start = source209.indexOf("do $$", marker),
      end = source209.indexOf("end $$;", start) + 7;
    await db.exec(source209.slice(start, end));
    const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
    const dates = async () =>
      (
        await rows("select to_char(vencimento,'YYYY-MM-DD') d from contas_receber order by parcela")
      ).map((r) => r.d);
    await db.exec("begin");
    await db.query("select confirmar_pedido($1)", [id(30)]);
    assert.deepEqual(await dates(), ["2026-10-15", "2026-11-14", "2026-12-14"]);
    await db.exec("rollback");
    const sql = fs.readFileSync(
      path.join(root, "db/fase227_prazos_forma_pagamento_pedido.sql"),
      "utf8",
    );
    await db.exec(sql);
    await db.exec(sql);
    const [{ definition }] = await rows(
      "select pg_get_functiondef('confirmar_pedido(uuid)'::regprocedure) definition",
    );
    assert.ok(definition.includes("-- confirmacao_209"));
    assert.ok(definition.includes("public.validar_pedido(_pedido_id)"));
    await db.query("select confirmar_pedido($1)", [id(30)]);
    await db.query("select confirmar_pedido($1)", [id(30)]);
    assert.deepEqual(await dates(), ["2026-11-04", "2026-11-24", "2026-12-14"]);
    assert.deepEqual(
      (await rows("select valor::text v from contas_receber order by parcela")).map((r) =>
        Number(r.v),
      ),
      [926.33, 926.33, 926.34],
    );
    assert.equal(Number((await rows("select count(*) n from estoque_movimentos"))[0].n), 1);
    assert.equal(Number((await rows("select count(*) n from contas_receber"))[0].n), 3);
    // Mudar o cadastro não altera títulos antigos por reaplicação da fase227.
    await db.exec(`update formas_pagamento set dias_primeira_parcela=10,intervalo_dias=15`);
    await db.exec(sql);
    assert.deepEqual(await dates(), ["2026-11-04", "2026-11-24", "2026-12-14"]);
    // Condições diferentes usam os campos, não o texto do nome.
    await db.exec(`insert into pedidos(id,numero,centro_id,status,data_pedido,parcelas,forma_pagamento_id,total_liquido)
      values('${id(31)}',2,'${id(10)}','rascunho','2026-12-25',3,'${id(70)}',100);
      insert into pedido_itens values('${id(31)}','${id(20)}',1);`);
    assert.equal(
      (await rows("select to_char(vencimento_pedido_227($1,1),'YYYY-MM-DD') d", [id(31)]))[0].d,
      "2027-01-04",
    );
    assert.equal(
      (await rows("select to_char(vencimento_pedido_227($1,3),'YYYY-MM-DD') d", [id(31)]))[0].d,
      "2027-02-03",
    );
    // Parcelas inconsistentes abortam toda confirmação, inclusive baixa de estoque.
    await db.exec(`update pedidos set parcelas=1 where id='${id(31)}'`);
    await assert.rejects(
      db.query("select confirmar_pedido($1)", [id(31)]),
      /Quantidade de parcelas difere/,
    );
    assert.equal(Number((await rows("select count(*) n from estoque_movimentos"))[0].n), 1);
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select vencimento_pedido_227($1,1)", [id(30)]),
      /permission denied/,
    );
    await db.exec("reset role");
    console.log(
      "OK fase227: regressão0/30/60 reproduzida,20/40/60 corrigido, centavos, virada de ano, idempotência, títulos anteriores preservados e guardas209 mantidas.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
