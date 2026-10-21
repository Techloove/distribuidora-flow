const { PGlite } = require("@electric-sql/pglite");
const { readFileSync } = require("node:fs");
const assert = require("node:assert/strict");
const path = require("node:path");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sql = (f) => readFileSync(path.join(__dirname, "..", "db", f), "utf8");
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`
 create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function usuario_ativo() returns boolean language sql as $$select auth.uid() is not null$$;
 create function can_manage(uuid) returns boolean language sql as $$select $1='${id(1)}'::uuid$$;
 create function can_operate(uuid) returns boolean language sql as $$select $1 in ('${id(1)}'::uuid,'${id(2)}'::uuid)$$;
 create table permissoes(codigo text primary key,nome text,grupo text,ordem int,modulo text);
 create table role_menus(role text,path text);insert into role_menus values('admin','/centros'),('admin','/pedidos'),('representante','/pedidos');
 create table role_permissoes(role text,permissao text,primary key(role,permissao));
 create function pode_rotina(text) returns boolean language sql as $$select exists(select 1 from role_permissoes where role=case when can_manage(auth.uid()) then 'admin' else 'representante' end and permissao=$1)$$;
 create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select can_manage(auth.uid()) or $1='${id(10)}'::uuid$$;
 create function escopo_representante() returns boolean language sql as $$select not can_manage(auth.uid())$$;
 create table profiles(id uuid primary key);insert into profiles values('${id(1)}'),('${id(2)}');
 create table centros(id uuid primary key);insert into centros values('${id(10)}'),('${id(11)}');
 create table clientes(id uuid primary key,cidade text,uf text);insert into clientes values('${id(20)}',' Venda Nova ','es'),('${id(21)}','VENDA NOVA','MG'),('${id(22)}','Outra cidade','ES');
 create table produtos(id uuid primary key,codigo text,descricao text,unidade text,estoque_atual numeric default 10000);
 insert into produtos(id,codigo,descricao,unidade) values('${id(30)}','C1','Cimento','SC'),('${id(31)}','F1','Ferragem','KG');
 create table loja_produtos(centro_id uuid,produto_id uuid,disponivel boolean);
 insert into loja_produtos select c.id,p.id,true from centros c cross join produtos p;
 create function listar_catalogo_loja_244(uuid,text,boolean) returns void language sql as $$select$$;
 create table formas_pagamento(id uuid primary key,taxa_percentual numeric,desconto_percentual numeric);
 insert into formas_pagamento values('${id(40)}',5,2);
 create table pedidos(id uuid primary key,cliente_id uuid,centro_id uuid,representante_id uuid,data_pedido date default current_date,status text default 'rascunho',tipo_documento text default 'pedido',forma_pagamento_id uuid,
 total_itens numeric default 0,total_liquido numeric default 0,frete_valor numeric default 0,desconto_valor numeric default 0,forma_acrescimo_valor numeric default 0,forma_desconto_valor numeric default 0,comissao_percentual numeric default 0,comissao_valor numeric default 0);
 create table pedido_itens(id uuid primary key,pedido_id uuid references pedidos,produto_id uuid,quantidade numeric,preco_unitario numeric,total numeric generated always as (round(quantidade*preco_unitario,2)) stored);
 create function documento_na_minha_carteira(text,uuid) returns boolean language sql as $$select exists(select 1 from pedidos where id=$2 and representante_id=auth.uid())$$;
 create function orcamento_acessivel_236(uuid) returns boolean language sql as $$select documento_na_minha_carteira('pedidos',$1) or can_manage(auth.uid())$$;
 create function resolver_comissao(uuid,uuid,date,uuid,numeric) returns numeric language sql as $$select 10::numeric$$;
 create function apurar_comissao_pedido(uuid) returns void language sql as $$select$$;
 create table auditoria(tabela text,registro_id uuid,acao text,user_id uuid,detalhe jsonb);
 create table devolucoes(id uuid,pedido_id uuid);
 create table devolucao_itens(devolucao_id uuid,produto_id uuid,quantidade numeric,preco_unitario numeric,total numeric);
 insert into pedidos(id,cliente_id,centro_id) values('${id(50)}','${id(20)}','${id(10)}');
 `);
    const f41 = sql("fase41_forma_pagamento_desconto_acrescimo.sql");
    const from = f41.indexOf("create or replace function public.recalcular_pedido(");
    await db.exec(f41.slice(from, f41.indexOf("end $function$;", from) + "end $function$;".length));
    await db.exec(sql("fase52_devolucao_valor_pago.sql"));
    await db.exec(
      `create trigger devolucao_calc before insert on devolucao_itens for each row execute function devolucao_itens_calc();`,
    );
    const migration = sql("fase250_frete_volume_despesas.sql");
    await db.exec(migration);
    await db.exec(migration);
    assert.equal(
      (await db.query(`select frete_volume_ativo a from pedidos where id=$1`, [id(50)])).rows[0].a,
      false,
    );
    await db.exec(`select set_config('request.jwt.claim.sub','${id(1)}',false)`);
    const salvar = (loja, cidade, uf, produto, valor, ativo = true) =>
      db.query("select salvar_frete_volume_250($1,$2,$3,$4,$5,$6)", [
        id(loja),
        cidade,
        uf,
        id(produto),
        valor,
        ativo,
      ]);
    await salvar(10, "venda nova", "ES", 30, 2.5);
    await salvar(10, "VENDA NOVA", "MG", 30, 4);
    await salvar(11, "VENDA NOVA", "ES", 30, 8);
    await assert.rejects(salvar(10, "Inventada", "ES", 30, 5), /cadastro de clientes/);
    await assert.rejects(salvar(10, "VENDA NOVA", "ES", 30, -1), /valor unitário/);
    await assert.rejects(salvar(10, "VENDA NOVA", "ES", 30, "NaN"), /valor unitário/);
    await assert.rejects(salvar(10, "VENDA NOVA", "ES", 30, 0.001), /valor unitário/);
    const get = async (n) => (await db.query("select * from pedidos where id=$1", [id(n)])).rows[0];
    const recalc = (n) => db.query("select recalcular_pedido($1)", [id(n)]);
    const encargos = (n, usar, v) =>
      db.query("select definir_encargos_pedido_250($1,$2,$3)", [id(n), usar, v]);
    await db.exec(`insert into pedidos(id,cliente_id,centro_id,representante_id,forma_pagamento_id) values('${id(51)}','${id(20)}','${id(10)}','${id(2)}','${id(40)}');
 insert into pedido_itens(id,pedido_id,produto_id,quantidade,preco_unitario) values('${id(60)}','${id(51)}','${id(30)}',100,10),('${id(61)}','${id(51)}','${id(31)}',2,50);`);
    await encargos(51, true, 20);
    let p = await get(51);
    assert.equal(Number(p.frete_volume_valor), 250);
    assert.equal(Number(p.total_itens), 1100);
    assert.equal(Number(p.total_liquido), 1403);
    assert.equal(Number(p.comissao_valor), 110);
    assert.equal(p.frete_volume_detalhes.length, 1);
    await db.exec(`update pedido_itens set quantidade=120 where id='${id(60)}'`);
    await recalc(51);
    assert.equal(Number((await get(51)).frete_volume_valor), 300);
    await db.exec(`update pedidos set cliente_id='${id(21)}' where id='${id(51)}'`);
    assert.equal(Number((await get(51)).frete_volume_valor), 480);
    await db.exec(
      `update pedidos set centro_id='${id(11)}',cliente_id='${id(20)}' where id='${id(51)}'`,
    );
    assert.equal(Number((await get(51)).frete_volume_valor), 960);
    await encargos(51, false, 20);
    assert.equal(Number((await get(51)).frete_volume_valor), 0);
    await db.exec(`update pedidos set centro_id='${id(10)}' where id='${id(51)}'`);
    await encargos(51, true, 20);
    // Frete manual e ajustes da forma são independentes e entram uma única vez.
    await db.exec(`update pedidos set frete_valor=10 where id='${id(51)}'`);
    await recalc(51);
    p = await get(51);
    assert.equal(Number(p.total_liquido), 1669);
    await db.exec(
      `insert into devolucoes values('${id(80)}','${id(51)}');insert into devolucao_itens(devolucao_id,produto_id,quantidade,preco_unitario) values('${id(80)}','${id(30)}',1,0)`,
    );
    assert.equal(
      Number((await db.query("select preco_unitario from devolucao_itens")).rows[0].preco_unitario),
      10.3,
    );
    await db.exec(`update pedidos set status='confirmado' where id='${id(51)}'`);
    await salvar(10, "VENDA NOVA", "ES", 30, 3);
    await recalc(51);
    assert.equal(Number((await get(51)).frete_volume_valor), 300);
    await assert.rejects(encargos(51, true, 40), /digitação/);
    await db.exec(`select set_config('request.jwt.claim.sub','${id(2)}',false)`);
    await assert.rejects(salvar(10, "VENDA NOVA", "ES", 30, 1), /permissão/);
    await assert.rejects(db.query("select cidades_frete_volume_250($1)", [id(10)]), /Sem acesso/);
    await assert.rejects(encargos(50, true, 1), /sem acesso/);
    await db.exec(
      `update pedidos set status='rascunho',tipo_documento='orcamento' where id='${id(51)}'`,
    );
    await encargos(51, true, 30);
    assert.equal(Number((await get(51)).frete_volume_valor), 360);
    await assert.rejects(encargos(51, true, -1), /não negativas/);
    await assert.rejects(encargos(51, true, "Infinity"), /não negativas/);
    // Uma nova execução não restaura permissões retiradas pelo administrador.
    await db.exec(`delete from role_permissoes where role='representante';`);
    await db.exec(migration);
    await assert.rejects(encargos(51, true, 30), /permissão/);
    await db.exec(`set role authenticated;`);
    await assert.rejects(
      db.query("select calcular_frete_volume_250($1)", [id(51)]),
      /permission denied/,
    );
    await assert.rejects(db.query("delete from loja_fretes_volume"), /permission denied/);
    await db.exec("reset role");
    assert.equal(
      Number((await db.query("select sum(estoque_atual) s from produtos")).rows[0].s),
      20000,
    );
    console.log(
      "Frete250 OK: soma por quantidade/produto/cidade/UF/loja, despesas no total, frete manual e comissão independentes, orçamentos, histórico congelado, devoluções sem frete, valores inválidos e carteira/permissões protegidos; migração reaplicável sem restaurar acessos.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
