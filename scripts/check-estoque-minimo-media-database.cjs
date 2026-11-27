const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const d = new PGlite();
  try {
    await d.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;
create function usuario_ativo() returns boolean language sql as $$select current_setting('test.ativo',true)='true'$$;
create function can_manage(uuid) returns boolean language sql as $$select current_setting('test.admin',true)='true'$$;
create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1::text=current_setting('test.centro',true)$$;
create function pode_rotina(text) returns boolean language sql as $$select true$$;
create function norm_txt(text) returns text language sql immutable as $$select lower(trim($1))$$;
create table parametros(chave text primary key,valor text,descricao text);
create table loja_parametros(centro_id uuid,chave text,valor text,updated_by uuid,updated_at timestamptz default now(),primary key(centro_id,chave));
create table auditoria(tabela text,registro_id uuid,acao text,user_id uuid,detalhe jsonb);
create table cad_categorias(id uuid primary key,nome_norm text);
create table centros(id uuid primary key,nome text,ativo boolean,categoria_produtos_id uuid);
create table produtos(id uuid primary key,codigo text,descricao text,unidade text,grupo text,marca text,ativo boolean,categoria text,estoque_minimo numeric(14,3),estoque_maximo numeric,prazo_fornecedor_dias int,ultimo_custo numeric,custo_medio numeric,estoque_atual numeric);
create table estoque_saldos(centro_id uuid,produto_id uuid,quantidade numeric);
create table pedidos(id uuid primary key,centro_id uuid,status text,data_pedido date,tipo_documento text default 'pedido',modalidade_venda text default 'estoque');
create table pedido_itens(pedido_id uuid,produto_id uuid,quantidade numeric);
create table devolucoes(id uuid primary key,pedido_id uuid,status text);
create table devolucao_itens(devolucao_id uuid,produto_id uuid,quantidade numeric);
create table compras(id uuid primary key,centro_id uuid,status text,fornecedor_id uuid,data_entrada date,created_at timestamptz);
create table compra_itens(compra_id uuid,produto_id uuid,quantidade numeric);
create table fornecedores(id uuid primary key,razao_social text);
create table notificacoes(titulo text,mensagem text,tipo text,link text);
create function notificar(text,text,text,text) returns void language sql as $$insert into notificacoes values($1,$2,$3,$4)$$;
set test.ativo='true';set test.admin='true';set test.centro='${id(50)}';
insert into cad_categorias values('${id(100)}','ferragem');
insert into centros values('${id(50)}','A',true,'${id(100)}'),('${id(51)}','B',true,'${id(100)}');
insert into produtos values('${id(10)}','1','Produto A','KG','','',true,'Ferragem',999,1000,7,2,2,500),('${id(11)}','2','Sem vendas','KG','','',true,'Ferragem',888,500,7,2,2,0);
insert into estoque_saldos values('${id(50)}','${id(10)}',500),('${id(51)}','${id(10)}',500);
insert into parametros values('alerta_estoque_minimo','true','Alerta');
`);
    const base = fs.readFileSync("db/fase243_parametros_por_loja.sql", "utf8");
    for (const name of ["parametros_da_loja_243", "salvar_parametros_loja_243"]) {
      const start = base.indexOf("create or replace function public." + name + "(");
      const end = base.indexOf("end $$;", start);
      if (name === "parametros_da_loja_243")
        await d.exec(base.slice(start, base.indexOf("$$;", start) + 3));
      else await d.exec(base.slice(start, end + 7));
    }
    await d.exec(fs.readFileSync("db/fase294_planejamento_compras.sql", "utf8"));
    const legacy = fs.readFileSync("db/fase271_estoque_proprio_por_loja.sql", "utf8");
    await d.exec(
      legacy.slice(
        legacy.indexOf("create or replace view public.vw_sugestao_compras_centro"),
        legacy.indexOf("-- Novas lojas"),
      ),
    );
    // Mesma estrutura de CTE utilizada nas quatro consultas de dashboard instaladas.
    for (const name of [
      "dashboard_resumo",
      "dashboard_resumo_mod_300",
      "dashboard_resumo_mes_307",
      "dashboard_resumo_mes_307_mod_300",
    ])
      await d.exec(
        `create function ${name}(_centro_id uuid default null) returns jsonb language plpgsql as $$begin with saldos_produto as(select id produto_id,estoque_atual quantidade from produtos),alertas as (select p.id,p.descricao,p.estoque_atual,p.estoque_minimo from produtos p where p.estoque_atual<=p.estoque_minimo) select jsonb_build_object('alertas',coalesce(jsonb_agg(alertas),'[]')) from alertas into _resultado;return _resultado;end$$;`.replace(
          "begin with",
          "declare _resultado jsonb;begin with",
        ),
      );
    let seq = 200;
    async function sale(
      age,
      q,
      status = "confirmado",
      centro = 50,
      tipo = "pedido",
      modal = "estoque",
    ) {
      const n = id(seq++);
      await d.query(
        "insert into pedidos values($1,$2,$3,(now() at time zone 'America/Sao_Paulo')::date-$4::int,$5,$6)",
        [n, id(centro), status, age, tipo, modal],
      );
      await d.query("insert into pedido_itens values($1,$2,$3)", [n, id(10), q]);
      return n;
    }
    const main = await sale(0, 500);
    await d.query("insert into pedido_itens values($1,$2,500)", [main, id(10)]);
    await d.exec(
      `insert into devolucoes values('${id(900)}','${main}','confirmada'),('${id(901)}','${main}','rascunho');insert into devolucao_itens values('${id(900)}','${id(10)}',100),('${id(901)}','${id(10)}',9999);`,
    );
    await sale(89, 90);
    await sale(90, 210);
    await sale(119, 120);
    await sale(120, 9999);
    await sale(-1, 9999);
    for (const status of ["aprovado", "cancelado", "rascunho", "aguardando_aprovacao"])
      await sale(0, 9999, status);
    await sale(0, 9999, "confirmado", 50, "orcamento");
    await sale(0, 9999, "confirmado", 50, "pedido", "intermediacao");
    await sale(0, 600, "confirmado", 51);
    const sql = fs.readFileSync("db/fase379_estoque_minimo_por_media.sql", "utf8");
    await d.exec(sql);
    await d.exec(sql);
    await d.exec(
      "grant select on all tables in schema public to authenticated;set role authenticated",
    );
    const rows = async () =>
      (await d.query("select * from estoque_minimos_loja_379($1) order by produto_id", [id(50)]))
        .rows;
    let r = await rows();
    assert.equal(Number(r[0].venda_periodo), 990);
    assert.equal(Number(r[0].estoque_minimo), 330);
    assert.equal(Number(r[1].estoque_minimo), 0);
    assert.equal(
      Number(
        (
          await d.query(
            "select estoque_minimo from vw_planejamento_compras_294 where produto_id=$1 and centro_id=$2",
            [id(10), id(50)],
          )
        ).rows[0].estoque_minimo,
      ),
      330,
    );
    assert.equal(
      Number(
        (
          await d.query(
            "select estoque_minimo from vw_sugestao_compras_centro where produto_id=$1",
            [id(10)],
          )
        ).rows[0].estoque_minimo,
      ),
      330,
    );
    await assert.rejects(
      d.query("select * from estoque_minimos_loja_379($1)", [id(51)]),
      /Loja sem acesso/,
    );
    await assert.rejects(
      d.query("select * from estoque_minimos_interno_379($1)", [id(50)]),
      /permission denied/,
    );
    await d.query("select salvar_parametros_loja_243($1,$2)", [
      id(50),
      JSON.stringify({ estoque_media_dias: "120", estoque_cobertura_dias: "30" }),
    ]);
    r = await rows();
    assert.equal(Number(r[0].venda_periodo), 1320);
    assert.equal(Number(r[0].estoque_minimo), 330);
    assert.equal(r[0].periodo_dias, 120);
    await d.query("select salvar_parametros_loja_243($1,$2)", [
      id(50),
      JSON.stringify({ estoque_cobertura_dias: "15" }),
    ]);
    assert.equal(Number((await rows())[0].estoque_minimo), 165);
    for (const bad of ["0", "-1", "1.5", "3651", "x"])
      await assert.rejects(
        d.query("select salvar_parametros_loja_243($1,$2)", [
          id(50),
          JSON.stringify({ estoque_media_dias: bad }),
        ]),
        /dias/,
      );
    await d.exec("set test.admin='false'");
    await assert.rejects(
      d.query("select salvar_parametros_loja_243($1,$2)", [
        id(50),
        JSON.stringify({ estoque_media_dias: "90" }),
      ]),
      /Sem permissão/,
    );
    await d.exec("set test.admin='true'");
    for (const name of [
      "dashboard_resumo",
      "dashboard_resumo_mod_300",
      "dashboard_resumo_mes_307",
      "dashboard_resumo_mes_307_mod_300",
    ]) {
      const q = (await d.query(`select ${name}($1) j`, [id(50)])).rows[0].j;
      assert.equal(q.alertas.length, 1);
      assert.equal(q.alertas[0].descricao, "Sem vendas");
    }
    await d.exec("reset role");
    await d.query("update estoque_saldos set quantidade=100 where centro_id=$1", [id(50)]);
    assert.equal((await d.query("select count(*)::int n from notificacoes")).rows[0].n, 1);
    await d.exec(`set test.centro='${id(51)}';set role authenticated`);
    const other = (await d.query("select * from estoque_minimos_loja_379($1)", [id(51)])).rows;
    assert.equal(Number(other[0].estoque_minimo), 200);
    assert.equal(other[0].periodo_dias, 90);
    await d.exec("set test.ativo='false'");
    await assert.rejects(
      d.query("select * from estoque_minimos_loja_379($1)", [id(51)]),
      /Loja sem acesso/,
    );
    await d.exec("reset role;set role anon");
    await assert.rejects(
      d.query("select * from estoque_minimos_loja_379($1)", [id(51)]),
      /permission denied/,
    );
    console.log(
      "OK: mínimo379 por loja, média90/120 e cobertura configurável, devolução sem duplicação, exclusão de orçamento/intermediação/aprovação/futuro, zero sem vendas, planejamento, quatro dashboards, alertas e permissões.",
    );
  } finally {
    await d.close();
  }
})().catch((e) => {
  console.error(e.message, e.where?.slice(0, 180));
  process.exit(1);
});
