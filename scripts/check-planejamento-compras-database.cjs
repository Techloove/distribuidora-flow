const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const d = new PGlite();
  try {
    await d.exec(`create role anon;create role authenticated;create role service_role;
 create function usuario_pode_acessar_centro(uuid) returns boolean language sql stable as $$select coalesce(current_setting('test.ativo',true),'true')='true' and $1::text=coalesce(nullif(current_setting('test.centro',true),''),'${id(50)}')$$;
 create function pode_rotina(text) returns boolean language sql stable as $$select $1='compras_planejar' and coalesce(current_setting('test.permissao',true),'true')='true' and coalesce(current_setting('test.ativo',true),'true')='true'$$;
 create function norm_txt(text) returns text language sql immutable as $$select lower(trim($1))$$;
 create table centros(id uuid primary key,nome text,ativo boolean,categoria_produtos_id uuid);
 create table cad_categorias(id uuid primary key,nome_norm text);
 create table produtos(id uuid primary key,codigo text,descricao text,unidade text,grupo text,marca text,ativo boolean,categoria text,estoque_minimo numeric,estoque_maximo numeric,prazo_fornecedor_dias int,ultimo_custo numeric,custo_medio numeric);
 create table estoque_saldos(produto_id uuid,centro_id uuid,quantidade numeric);
 create table pedidos(id uuid primary key,centro_id uuid,status text,data_pedido date);
 create table pedido_itens(id uuid default gen_random_uuid(),pedido_id uuid,produto_id uuid,quantidade numeric);
 create table devolucoes(id uuid primary key,pedido_id uuid,centro_id uuid,status text);
 create table devolucao_itens(devolucao_id uuid,produto_id uuid,quantidade numeric);
 create table compras(id uuid primary key,centro_id uuid,fornecedor_id uuid,status text,data_entrada date,created_at timestamptz default now());
 create table compra_itens(compra_id uuid,produto_id uuid,quantidade numeric);
 create table fornecedores(id uuid primary key,razao_social text,centro_id uuid);
 insert into cad_categorias values('${id(100)}','ferragem'),('${id(101)}','cimento');
 insert into centros values('${id(50)}','Loja A',true,'${id(100)}'),('${id(51)}','Loja B',true,'${id(101)}');
 insert into produtos values('${id(10)}','P1','Produto A','UN','Grupo','Marca',true,'Ferragem',20,200,10,2.9,3),('${id(11)}','P2','Produto B','KG','Grupo','Marca',true,'Cimento',10,100,5,null,4);
 insert into estoque_saldos values('${id(10)}','${id(50)}',-15),('${id(11)}','${id(51)}',999);
 grant select on all tables in schema public to authenticated;
 `);
    for (const t of ["pedidos", "compras", "devolucoes", "estoque_saldos", "fornecedores"])
      await d.exec(
        `alter table ${t} enable row level security;create policy escopo on ${t} for select to authenticated using(usuario_pode_acessar_centro(centro_id));`,
      );
    for (const [t, fk, parent] of [
      ["pedido_itens", "pedido_id", "pedidos"],
      ["compra_itens", "compra_id", "compras"],
      ["devolucao_itens", "devolucao_id", "devolucoes"],
    ])
      await d.exec(
        `alter table ${t} enable row level security;create policy escopo on ${t} for select to authenticated using(exists(select 1 from ${parent} p where p.id=${fk}));`,
      );
    let n = 1;
    async function venda(idade, q, status = "confirmado", produto = 10, centro = 50) {
      const pid = id(200 + n++);
      await d.query(
        "insert into pedidos values($1,$2,$3,(now() at time zone 'America/Sao_Paulo')::date-$4::int)",
        [pid, id(centro), status, idade],
      );
      await d.query("insert into pedido_itens(pedido_id,produto_id,quantidade) values($1,$2,$3)", [
        pid,
        id(produto),
        q,
      ]);
      return pid;
    }
    await venda(0, 10, "aprovado");
    const original = await venda(0, 20);
    await d.query("insert into pedido_itens(pedido_id,produto_id,quantidade) values($1,$2,30)", [
      original,
      id(10),
    ]);
    await d.exec(
      `insert into devolucoes values('${id(300)}','${original}','${id(50)}','confirmada'),('${id(301)}','${original}','${id(50)}','rascunho');insert into devolucao_itens values('${id(300)}','${id(10)}',5),('${id(301)}','${id(10)}',1000);`,
    );
    for (const [age, q] of [
      [29, 30],
      [30, 60],
      [59, 10],
      [60, 20],
      [89, 40],
      [90, 25],
      [119, 15],
      [120, 100],
    ])
      await venda(age, q);
    for (const status of ["rascunho", "digitacao", "aguardando_aprovacao", "recusado", "cancelado"])
      await venda(0, 9000, status);
    await venda(-1, 8000);
    await venda(0, 7000, "aprovado", 11, 51);
    const full = await venda(0, 80);
    await d.exec(
      `insert into devolucoes values('${id(302)}','${full}','${id(50)}','confirmada');insert into devolucao_itens values('${id(302)}','${id(10)}',80);`,
    );
    await d.exec(`insert into fornecedores values('${id(400)}','Fornecedor A','${id(50)}'),('${id(401)}','Fornecedor B','${id(51)}');
 insert into compras values('${id(500)}','${id(50)}','${id(400)}','comprado',current_date,now()),('${id(501)}','${id(50)}','${id(400)}','recebida',current_date-1,now()),('${id(502)}','${id(50)}','${id(400)}','cancelada',current_date,now()),('${id(503)}','${id(51)}','${id(401)}','comprado',current_date,now());
 insert into compra_itens values('${id(500)}','${id(10)}',20),('${id(501)}','${id(10)}',100),('${id(502)}','${id(10)}',200),('${id(503)}','${id(11)}',500);
 `);
    const sql = fs.readFileSync(
      path.join(__dirname, "../db/fase294_planejamento_compras.sql"),
      "utf8",
    );
    await d.exec(sql);
    await d.exec(sql);
    await d.exec("set role authenticated");
    let rows = (await d.query("select * from vw_planejamento_compras_294")).rows;
    assert.equal(rows.length, 1);
    let r = rows[0];
    assert.equal(r.produto_id, id(10));
    assert.equal(Number(r.estoque_atual), -15);
    assert.equal(Number(r.pendencia_aprovada), 10);
    assert.equal(Number(r.em_transito), 20);
    assert.equal(Number(r.custo_referencia), 2.9);
    assert.equal(r.fornecedor, "Fornecedor A");
    assert.deepEqual(
      [r.venda_30, r.venda_60, r.venda_90, r.venda_120].map(Number),
      [85, 155, 215, 255],
    );
    assert.equal(r.dias_historico, 120);
    await assert.rejects(
      () => d.query("insert into vw_planejamento_compras_294(produto_id) values($1)", [id(10)]),
      /permission denied|not automatically updatable|cannot insert into view/,
    );
    await d.exec(`set test.centro='${id(51)}'`);
    rows = (await d.query("select * from vw_planejamento_compras_294")).rows;
    assert.equal(rows.length, 1);
    r = rows[0];
    assert.equal(r.produto_id, id(11));
    assert.equal(Number(r.estoque_atual), 999);
    assert.equal(Number(r.pendencia_aprovada), 7000);
    assert.equal(Number(r.em_transito), 500);
    assert.equal(Number(r.custo_referencia), 4);
    await d.exec("set test.permissao='false'");
    assert.equal(
      (await d.query("select count(*)::int n from vw_planejamento_compras_294")).rows[0].n,
      0,
    );
    await d.exec("set test.permissao='true';set test.ativo='false'");
    assert.equal(
      (await d.query("select count(*)::int n from vw_planejamento_compras_294")).rows[0].n,
      0,
    );
    await d.exec("reset role;set role anon");
    await assert.rejects(
      () => d.query("select * from vw_planejamento_compras_294"),
      /permission denied/,
    );
    console.log(
      "OK: planejamento294 repetível/somente leitura; aprovados e estágios avançados; rascunho/análise/cancelado/futuro excluídos; janelas30/60/90/120; devolução sem duplicação; trânsito, fornecedor, custo e isolamento/RLS por loja.",
    );
  } finally {
    await d.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
