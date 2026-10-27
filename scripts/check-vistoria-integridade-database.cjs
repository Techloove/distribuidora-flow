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
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function usuario_ativo() returns boolean language sql as $$select coalesce(current_setting('test.active',true),'true')='true'$$;
 create function can_manage(uuid) returns boolean language sql as $$select coalesce(current_setting('test.manage',true),'true')='true'$$;
 create function pode_rotina(text) returns boolean language sql as $$select coalesce(current_setting('test.routine',true),'true')='true'$$;
 create function usuario_pode_acessar_centro(uuid) returns boolean language sql as $$select $1='${id(10)}'::uuid$$;
 create function escopo_representante() returns boolean language sql as $$select coalesce(current_setting('test.rep',true),'false')='true'$$;
 create function documento_na_minha_carteira(text,uuid) returns boolean language sql as $$select $2<>'${id(30)}'::uuid$$;
 create function norm_txt(text) returns text language sql immutable as $$select lower(trim($1))$$;
 create table cad_categorias(id uuid primary key,nome_norm text);
 create table centros(id uuid primary key,ativo boolean,categoria_produtos_id uuid);
 create table produtos(id uuid primary key,categoria text,estoque_atual numeric,permite_estoque_negativo boolean,preco_venda numeric);
 create table estoque_saldos(produto_id uuid,centro_id uuid,quantidade numeric);
 create table depositos(id uuid primary key,centro_id uuid);
 create table deposito_saldos(produto_id uuid,deposito_id uuid,quantidade numeric);
 create table estoque_reservas(pedido_id uuid,produto_id uuid,centro_id uuid,quantidade numeric);
 create table pedidos(id uuid primary key,centro_id uuid,status text,tipo_documento text default 'pedido',status_regularizado_em timestamptz,total_liquido numeric default 100);
 create table pedido_itens(pedido_id uuid,produto_id uuid,quantidade numeric);
 create table compras(id uuid primary key,centro_id uuid);
 create table contas_receber(id uuid,pedido_id uuid,centro_id uuid,parcela int,status text);
 create table contas_pagar(id uuid,compra_id uuid,centro_id uuid,parcela int,status text);
 create table loja_produtos(produto_id uuid,centro_id uuid,preco_venda numeric);
 create table auditoria(tabela text,registro_id uuid,acao text);
 create table estoque_movimentos(documento_id uuid,origem text,tipo text);
 create table creditos_clientes_aplicacoes(pedido_id uuid,status text,valor numeric);
 create table devolucoes(id uuid,pedido_id uuid,centro_id uuid,status text);
 create table entrega_itens(devolucao_id uuid);
 create table inventarios(id uuid,deposito_id uuid,status text);
 create table pessoas(id uuid,cnpj_cpf text,is_cliente boolean,is_fornecedor boolean,is_representante boolean,is_transportadora boolean);
 create table clientes(pessoa_id uuid,limite_credito numeric);
 create table fornecedores(pessoa_id uuid);create table representantes(pessoa_id uuid,profile_id uuid);create table transportadoras(pessoa_id uuid);
 create table loja_parametros(chave text,valor text);
 create table boletos(conta_receber_id uuid,status text,banco text,nosso_numero text);
 insert into loja_parametros values('desconto_maximo','101');
 insert into clientes values(null,-1);
 alter table depositos add column padrao boolean default true,add column ativo boolean default true;
 insert into pessoas values('${id(80)}',null,true,false,false,false);
 create function salvar_observacoes_pedido_274(uuid,text,text) returns void language sql as $$select null::void$$;
 create function sincronizar_preco_produto_275() returns trigger language plpgsql as $$begin return new;end$$;
 insert into cad_categorias values('${id(1)}','ferragens'),('${id(2)}','cimento');
 insert into centros values('${id(10)}',true,'${id(1)}'),('${id(11)}',true,'${id(2)}');
 insert into produtos values('${id(20)}','Ferragens',100,false,15),('${id(21)}','Cimento',50,false,20);
 insert into estoque_saldos values('${id(20)}','${id(10)}',100),('${id(21)}','${id(11)}',50);
 insert into depositos values('${id(60)}','${id(10)}'),('${id(61)}','${id(11)}');
 insert into deposito_saldos values('${id(20)}','${id(60)}',100),('${id(21)}','${id(61)}',50);
 insert into loja_produtos values('${id(20)}','${id(10)}',15),('${id(21)}','${id(11)}',999);
 insert into pedidos(id,centro_id,status) values('${id(30)}','${id(10)}','confirmado'),('${id(31)}','${id(11)}','confirmado');
 insert into auditoria values('pedidos','${id(30)}','confirmar'),('pedidos','${id(31)}','confirmar');
 insert into estoque_movimentos values('${id(30)}','pedido','saida');
 insert into contas_receber values('${id(50)}','${id(30)}','${id(10)}',1,'aberto');
 `);
    const source = fs.readFileSync(
      path.join(root, "db/fase271_estoque_proprio_por_loja.sql"),
      "utf8",
    );
    const a = source.indexOf("create or replace function public.loja_produto_estoque_271(");
    await db.exec(source.slice(a, source.indexOf("$$;", a) + 3));
    const migration = fs.readFileSync(
      path.join(root, "db/fase276_vistoria_integridade_por_loja.sql"),
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(
      `set test.actor='${id(99)}';grant usage on schema auth,public to authenticated;set role authenticated;`,
    );
    const report = async () =>
      Object.fromEntries(
        (await db.query("select * from diagnostico_integridade_220()")).rows.map((r) => [
          r.verificacao,
          Number(r.pendencias),
        ]),
      );
    let r = await report();
    assert.equal(Object.keys(r).length, 16);
    assert(Object.values(r).every((n) => n === 0));
    // Outra loja tem preço divergente e pedido sem efeitos; não pode vazar para o usuário da loja10.
    await db.exec("reset role");
    await db.exec(
      `update estoque_saldos set quantidade=-2 where produto_id='${id(20)}';update produtos set estoque_atual=-2,permite_estoque_negativo=true where id='${id(20)}';update deposito_saldos set quantidade=-2 where produto_id='${id(20)}';`,
    );
    r = await report();
    assert.equal(r["Operação: estoque negativo permitido pelo cadastro"], 1);
    assert.equal(r["Atenção: estoque negativo sem permissão do produto"], 0);
    await db.exec(
      `update produtos set permite_estoque_negativo=false where id='${id(20)}';insert into estoque_reservas values('${id(30)}','${id(20)}','${id(10)}',5);update loja_produtos set preco_venda=99 where centro_id='${id(10)}';insert into contas_receber values('${id(51)}','${id(30)}','${id(11)}',1,'aberto');`,
    );
    r = await report();
    assert.equal(r["Atenção: estoque negativo sem permissão do produto"], 1);
    assert.equal(r["Atenção: reservas acima do saldo da própria loja"], 1);
    assert.equal(r["Atenção: reservas sem vínculo válido com pedido e loja"], 1);
    assert.equal(r["Atenção: preço normal do catálogo diferente de Produtos"], 1);
    assert.equal(r["Atenção: títulos a receber em loja diferente do pedido"], 1);
    assert.equal(r["Atenção: parcelas ativas duplicadas por pedido"], 1);
    await db.exec(
      `delete from contas_receber;delete from estoque_movimentos;update pedidos set status_regularizado_em=now() where id='${id(30)}';`,
    );
    r = await report();
    assert.equal(r["Revisar: pedidos confirmados sem baixa de estoque registrada"], 0);
    assert.equal(r["Revisar: pedidos confirmados sem recebíveis ou cobertura por crédito"], 0);
    await db.exec(
      `update pedidos set status_regularizado_em=null where id='${id(30)}';insert into creditos_clientes_aplicacoes values('${id(30)}','aplicado',100);`,
    );
    r = await report();
    assert.equal(r["Revisar: pedidos confirmados sem baixa de estoque registrada"], 1);
    assert.equal(r["Revisar: pedidos confirmados sem recebíveis ou cobertura por crédito"], 0);
    await db.exec("set test.rep='true'");
    r = await report();
    assert.equal(r["Revisar: pedidos confirmados sem baixa de estoque registrada"], 0);
    await db.exec("set test.rep='false'");
    for (const flag of ["active", "manage", "routine"]) {
      await db.exec(`set test.${flag}='false'`);
      await assert.rejects(report(), /restrito/);
      await db.exec(`set test.${flag}='true'`);
    }
    await db.exec("set test.actor=''");
    await assert.rejects(report(), /restrito/);
    const before = (await db.query("select * from estoque_saldos")).rows;
    const diagnostic = fs.readFileSync(
      path.join(root, "db/vistoria_integridade_276_somente_leitura.sql"),
      "utf8",
    );
    const results = await db.exec(diagnostic);
    const counts = results.find((x) => x.rows[0]?.verificacao);
    assert(
      counts.rows.some((x) => x.verificacao.includes("catálogo") && Number(x.pendencias) === 2),
    );
    assert.equal(
      Number(
        counts.rows.find(
          (x) => x.verificacao === "Cadastros: função Cliente sem vínculo especializado",
        ).pendencias,
      ),
      1,
    );
    assert.equal(
      Number(
        counts.rows.find(
          (x) => x.verificacao === "Limites: desconto ou margem líquida fora de zero a cem",
        ).pendencias,
      ),
      1,
    );
    assert.equal(
      Number(
        counts.rows.find(
          (x) => x.verificacao === "Limites: limite de crédito negativo ou não finito",
        ).pendencias,
      ),
      1,
    );
    assert.deepEqual((await db.query("select * from estoque_saldos")).rows, before);
    const query = migration.split(" return query\n")[1].split("-- FIM CONSULTA276")[0].trim();
    assert(diagnostic.includes(query.replace(/;$/, "")));
    await db.exec("set role anon");
    await assert.rejects(report(), /permission denied/);
    console.log(
      "Vistoria276 OK: duas lojas isoladas, negativos permitidos distintos de falha, divergências detectadas, carteira, regularização, crédito integral, gestão ativa, anon bloqueado e diagnóstico somente leitura.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
