const fs = require("node:fs"),
  assert = require("node:assert/strict");
// PGlite: não conecta a banco ou integrações reais.
const criarBanco = require("./fixtures/pedidos-operacionais.cjs");
(async () => {
  const { db, id } = await criarBanco();
  const scalar = async (s, p = []) => Object.values((await db.query(s, p)).rows[0])[0];
  try {
    await db.exec(`create function can_stock(uuid) returns boolean language sql as $$select usuario_ativo()$$;
 create function norm_txt(text) returns text language sql immutable as $$select lower(trim($1))$$;
 create table centros(id uuid primary key,nome text,ativo boolean default true,categoria_produtos_id uuid);
 insert into centros(id,nome) values('${id(10)}','Cimento'),('${id(11)}','Ferragens');
 create table parametros(chave text primary key,valor text,descricao text);
 create table loja_parametros(centro_id uuid references centros(id),chave text references parametros(chave),valor text,updated_by uuid,updated_at timestamptz default now(),primary key(centro_id,chave));
 insert into parametros values('margem_minima','0','Margem mínima');
 create function parametros_da_loja_243(uuid) returns setof parametros language sql as $$select p.* from parametros p$$;
 create function pode_alterar_preco(uuid) returns boolean language sql as $$select coalesce(current_setting('test.preco',true),'true')='true'$$;
 create table loja_produtos(centro_id uuid,produto_id uuid,disponivel boolean default true,desconto_maximo numeric);
 create function produto_categoria_loja_246(uuid,uuid) returns boolean language sql as $$select exists(select 1 from loja_produtos where centro_id=$1 and produto_id=$2 and disponivel)$$;

 insert into loja_produtos values('${id(10)}','${id(20)}',true,null),('${id(11)}','${id(21)}',true,null);
 create table clientes(id uuid primary key,status text default 'ativo',limite_credito numeric default 10000,cidade text,uf text);insert into clientes(id) values('${id(90)}');
 alter table produtos add column preco_custo numeric,add column ultimo_custo numeric,add column margem_minima numeric default 0,add column ativo boolean default true;
 alter table estoque_reservas add column produto_id uuid,add column centro_id uuid;create unique index on estoque_reservas(pedido_id,produto_id);
 create table estoque_saldos(produto_id uuid,centro_id uuid,quantidade numeric);
 insert into estoque_saldos values('${id(20)}','${id(10)}',100);
 create table cad_categorias(id uuid);
 create function loja_produto_estoque_271(uuid) returns uuid language sql as $$select '${id(10)}'::uuid$$;
 create table entrega_itens(devolucao_id uuid);
 create table loja_fretes_volume(centro_id uuid,produto_id uuid,ativo boolean);
 create function calcular_comissao_itens_215(uuid) returns numeric language sql as $$select 0::numeric$$;
 create function margem_inadequada_215(uuid) returns boolean language sql as $$select false$$;
 create function vencimento_util(date) returns date language sql as $$select $1$$;


 alter table pedido_separacoes add column observacoes text;
 alter table formas_pagamento add column taxa_percentual numeric default 0,add column desconto_percentual numeric default 0;
 `);
    // Completa apenas as colunas do contrato já existente; todas as identidades/dados são fictícios.
    await db.exec(
      `alter table pedidos add column if not exists id uuid default gen_random_uuid();alter table pedidos add column if not exists numero bigint;alter table pedidos add column if not exists cliente_id uuid;alter table pedidos add column if not exists representante_id uuid;alter table pedidos add column if not exists centro_id uuid;alter table pedidos add column if not exists data_pedido date default CURRENT_DATE;alter table pedidos add column if not exists condicao_pagamento text;alter table pedidos add column if not exists parcelas integer default 1;alter table pedidos add column if not exists status text default 'rascunho'::text;alter table pedidos add column if not exists desconto_valor numeric default 0;alter table pedidos add column if not exists frete_valor numeric default 0;alter table pedidos add column if not exists total_itens numeric default 0;alter table pedidos add column if not exists total_liquido numeric default 0;alter table pedidos add column if not exists comissao_percentual numeric default 0;alter table pedidos add column if not exists comissao_valor numeric default 0;alter table pedidos add column if not exists observacoes text;alter table pedidos add column if not exists created_by uuid;alter table pedidos add column if not exists created_at timestamp with time zone default now();alter table pedidos add column if not exists updated_at timestamp with time zone default now();alter table pedidos add column if not exists forma_pagamento_id uuid;alter table pedidos add column if not exists rota_id uuid;alter table pedidos add column if not exists previsao_entrega date;alter table pedidos add column if not exists endereco_entrega text;alter table pedidos add column if not exists tabela_preco text;alter table pedidos add column if not exists onda_id uuid;alter table pedidos add column if not exists forma_acrescimo_valor numeric default 0;alter table pedidos add column if not exists forma_desconto_valor numeric default 0;alter table pedidos add column if not exists custo_frete numeric default 0;alter table pedidos add column if not exists faturado_em timestamp with time zone;alter table pedidos add column if not exists tributos_estimados numeric default 0;alter table pedidos add column if not exists despesas_variaveis numeric default 0;alter table pedidos add column if not exists data_entrega date;alter table pedidos add column if not exists tipo_documento text default 'pedido'::text;alter table pedidos add column if not exists orcamento_situacao text;alter table pedidos add column if not exists orcamento_data date;alter table pedidos add column if not exists orcamento_validade date;alter table pedidos add column if not exists orcamento_aceito_em timestamp with time zone;alter table pedidos add column if not exists orcamento_encerrado_em timestamp with time zone;alter table pedidos add column if not exists orcamento_motivo text;alter table pedidos add column if not exists aprovacao_automatica_em timestamp with time zone;alter table pedidos add column if not exists aprovacao_automatica_motivos jsonb default '[]'::jsonb;alter table pedidos add column if not exists frete_volume_ativo boolean default false;alter table pedidos add column if not exists frete_volume_valor numeric default 0;alter table pedidos add column if not exists frete_volume_detalhes jsonb default '[]'::jsonb;alter table pedidos add column if not exists outras_despesas numeric default 0;alter table pedidos add column if not exists frete_volume_opcao text default 'automatico'::text;alter table pedidos add column if not exists status_regularizado_em timestamp with time zone;alter table pedidos add column if not exists status_regularizado_por uuid;alter table pedidos add column if not exists status_regularizado_motivo text;alter table pedidos add column if not exists status_regularizado_data date;alter table pedidos add column if not exists cancelamento_motivo_285 text;alter table pedidos add column if not exists cancelamento_por_285 uuid;alter table pedidos add column if not exists cancelamento_em_285 timestamp with time zone;alter table pedidos add column if not exists ciclo_reabertura_289 integer default 0;alter table pedidos add column if not exists reaberto_por_289 uuid;alter table pedidos add column if not exists reaberto_em_289 timestamp with time zone;alter table pedido_itens add column if not exists id uuid default gen_random_uuid();alter table pedido_itens add column if not exists pedido_id uuid;alter table pedido_itens add column if not exists produto_id uuid;alter table pedido_itens add column if not exists quantidade numeric;alter table pedido_itens add column if not exists preco_unitario numeric default 0;alter table pedido_itens add column if not exists desconto_percentual numeric default 0;alter table pedido_itens add column if not exists total numeric default 0;alter table pedido_itens add column if not exists created_at timestamp with time zone default now();alter table pedido_itens add column if not exists centro_id uuid;alter table pedido_itens add column if not exists quantidade_separada numeric;alter table pedido_itens add column if not exists divergencia_acao text;alter table pedido_itens add column if not exists divergencia_obs text;alter table pedido_itens add column if not exists conferido boolean default false;alter table pedido_itens add column if not exists custo_unitario_base numeric;`,
    );
    await db.exec(fs.readFileSync("scripts/fixtures/intermediacao-motores-295.sql", "utf8"));
    await db.exec(`create trigger aa_reservar after update of status on pedidos for each row execute function reservar_pedido_212();
 create trigger trg_total before insert or update on pedido_itens for each row execute function pedido_itens_total();
 create trigger trg_after after insert or update or delete on pedido_itens for each row execute function pedido_itens_after();
 create view vw_cpv as select p.data_pedido as data,p.centro_id,sum(i.quantidade * COALESCE(pr.custo_medio, pr.preco_custo, pr.ultimo_custo, 0::numeric)) custo from pedidos p join pedido_itens i on i.pedido_id=p.id join produtos pr on pr.id=i.produto_id group by 1,2;
 create view vw_planejamento_compras_294 as select ped.id,ped.centro_id from pedidos ped join pedido_itens pi on pi.pedido_id=ped.id WHERE ped.status='aprovado';
 create view vw_sugestao_compras_centro as select ped.id from pedidos ped join pedido_itens pi on pi.pedido_id=ped.id WHERE ped.centro_id IS NOT NULL;
 set test.ativo='true';set test.admin='true';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
 `);
    const migration = fs.readFileSync("db/fase296_intermediacao.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    assert.equal(
      await scalar(
        "select valor from loja_parametros where centro_id=$1 and chave='intermediacao_habilitada'",
        [id(10)],
      ),
      "true",
    );
    assert.equal(
      await scalar(
        "select valor from loja_parametros where centro_id=$1 and chave='intermediacao_habilitada'",
        [id(11)],
      ),
      "false",
    );
    const cotacao = async (custo = 28.5, produto = 20, loja = 10) =>
      (
        await db.query("select * from salvar_cotacao_intermediacao_296($1,$2,current_date,$3)", [
          id(loja),
          id(produto),
          custo,
        ])
      ).rows[0];
    const q1 = await cotacao();
    assert.equal((await cotacao()).id, q1.id);
    await db.query(
      "insert into pedidos(id,numero,cliente_id,centro_id,status,data_pedido,forma_pagamento_id) values($1,296,$2,$3,'rascunho',current_date,$4)",
      [id(500), id(90), id(10), id(30)],
    );
    await db.query("select definir_modalidade_pedido_296($1,'intermediacao')", [id(500)]);
    const item = async (q = q1, qtd = 100, frete = 3, margem = 2.5, itemId = null) =>
      (
        await db.query("select * from salvar_item_intermediacao_296($1,$2,$3,$4,$5,$6,$7)", [
          id(500),
          itemId,
          id(20),
          qtd,
          q.id,
          frete,
          margem,
        ])
      ).rows[0];
    const i = await item();
    assert.equal(Number(i.preco_unitario), 34);
    assert.equal(Number(i.custo_unitario_base), 31.5);
    assert.equal(
      Number(await scalar("select total_liquido from pedidos where id=$1", [id(500)])),
      3400,
    );
    assert.equal(
      Number(await scalar("select custo from vw_cpv where centro_id=$1", [id(10)])),
      3150,
    );
    const q2 = await cotacao(30);
    assert.equal(q2.revisao, 2);
    assert.equal(
      Number(await scalar("select custo_fabrica_saca from pedido_itens where id=$1", [i.id])),
      28.5,
    );
    await item(q1, 100, 3, 2.5, i.id); // editar sem reaplicar a cotação mantém a fotografia anterior
    await assert.rejects(() => item(q1), /cotação mudou/);
    await assert.rejects(() => item(q2, 1.5), /inteira/);
    await assert.rejects(() => item(q2, 1, -1), /não negativos/);
    await assert.rejects(
      () => db.query("select definir_modalidade_pedido_296($1,'estoque')", [id(500)]),
      /antes de incluir/,
    );
    const outroDia = (
      await db.query("select * from salvar_cotacao_intermediacao_296($1,$2,current_date-1,27)", [
        id(10),
        id(20),
      ])
    ).rows[0];
    await assert.rejects(() => item(outroDia), /data e loja/);
    await db.exec("set test.preco='false'");
    await assert.rejects(() => item(q1, 100, 4, 2.5, i.id), /Sem permissão/);
    await db.exec("set test.preco='true'");
    await db.query("update pedidos set status='aprovado' where id=$1", [id(500)]);
    assert.equal(
      Number(await scalar("select count(*) from estoque_reservas where pedido_id=$1", [id(500)])),
      0,
    );
    await db.query("select confirmar_pedido($1)", [id(500)]);
    await db.query("select confirmar_pedido($1)", [id(500)]);
    assert.equal(
      Number(await scalar("select sum(valor) from contas_receber where pedido_id=$1", [id(500)])),
      3400,
    );
    assert.equal(
      Number(await scalar("select count(*) from contas_receber where pedido_id=$1", [id(500)])),
      1,
    );
    assert.equal(
      Number(
        await scalar("select count(*) from estoque_movimentos where documento_id=$1", [id(500)]),
      ),
      0,
    );
    assert.equal(await scalar("select status from pedidos where id=$1", [id(500)]), "confirmado");
    await assert.rejects(() => item(q1, 100, 4, 2.5, i.id), /imutáveis/);
    await assert.rejects(
      () =>
        db.query(
          "insert into estoque_movimentos(produto_id,centro_id,tipo,quantidade,origem,documento_id) values($1,$2,'saida',1,'pedido',$3)",
          [id(20), id(10), id(500)],
        ),
      /não movimenta/,
    );
    await assert.rejects(
      () =>
        db.query(
          "insert into estoque_reservas(pedido_id,produto_id,centro_id,quantidade) values($1,$2,$3,1)",
          [id(500), id(20), id(10)],
        ),
      /não movimenta/,
    );
    await db.query("select enviar_pedidos_separacao_233(array[$1]::uuid[])", [id(500)]);
    await db.query("update pedido_itens set quantidade_separada=quantidade where pedido_id=$1", [
      id(500),
    ]);
    await db.query("select concluir_separacao($1)", [id(500)]);
    await db.query("select conferir_separacao($1)", [id(500)]);
    assert.equal(await scalar("select status from pedidos where id=$1", [id(500)]), "conferido");
    await db.query("select cancelar_pedido_admin_285($1,$2)", [
      id(500),
      "Cancelamento de teste sem estoque",
    ]);
    assert.equal(await scalar("select status from pedidos where id=$1", [id(500)]), "cancelado");
    assert.equal(
      Number(
        await scalar("select count(*) from estoque_movimentos where documento_id=$1", [id(500)]),
      ),
      0,
    );

    // Devolução parcial da entrega direta reduz a cobrança, mas retorna à fábrica e não à loja.
    await db.query(
      "insert into pedidos(id,numero,cliente_id,centro_id,status,data_pedido,forma_pagamento_id) values($1,297,$2,$3,'rascunho',current_date,$4)",
      [id(501), id(90), id(10), id(30)],
    );
    await db.query("select definir_modalidade_pedido_296($1,'intermediacao')", [id(501)]);
    await db.query("select salvar_item_intermediacao_296($1,null,$2,100,$3,3,2.5)", [
      id(501),
      id(20),
      q2.id,
    ]);
    assert.equal(await scalar("select pedido_confirmado_logistica_233($1)", [id(501)]), false);
    await db.query("select confirmar_pedido($1)", [id(501)]);
    assert.equal(await scalar("select pedido_confirmado_logistica_233($1)", [id(501)]), true);
    const dev = await scalar("select devolver_pedido_admin_285($1,$2::jsonb,$3,$4,true)", [
      id(501),
      JSON.stringify([{ produto_id: id(20), quantidade: 50, condicao: "revenda" }]),
      "Retorno confirmado à fábrica",
      id(700),
    ]);
    assert.equal(
      Number(
        await scalar("select count(*) from estoque_movimentos where documento_id in($1,$2)", [
          id(501),
          dev,
        ]),
      ),
      0,
    );
    assert.equal(
      Number(
        await scalar(
          "select sum(valor) from contas_receber where pedido_id=$1 and status not in('cancelado','pago')",
          [id(501)],
        ),
      ),
      1775,
    );
    // A venda de estoque mantém a reserva e baixa tradicionais.
    await db.query(
      "insert into pedidos(id,numero,cliente_id,centro_id,status,data_pedido,forma_pagamento_id) values($1,298,$2,$3,'rascunho',current_date,$4)",
      [id(502), id(90), id(10), id(30)],
    );
    await db.query(
      "insert into pedido_itens(pedido_id,produto_id,quantidade,preco_unitario) values($1,$2,10,40)",
      [id(502), id(20)],
    );
    await db.query("update pedidos set status='aprovado' where id=$1", [id(502)]);
    assert.equal(
      Number(
        await scalar("select sum(quantidade) from estoque_reservas where pedido_id=$1", [id(502)]),
      ),
      10,
    );
    await db.query("select confirmar_pedido($1)", [id(502)]);
    assert.equal(
      Number(
        await scalar(
          "select sum(quantidade) from estoque_movimentos where documento_id=$1 and tipo='saida'",
          [id(502)],
        ),
      ),
      10,
    );
    assert.equal(
      Number(
        await scalar("select count(*) from intermediacao_confirmacoes_296 where pedido_id=$1", [
          id(502),
        ]),
      ),
      0,
    );
    assert.equal(Number(await scalar("select custo_medio from produtos where id=$1", [id(20)])), 5);
    assert.equal(
      Number(await scalar("select estoque_atual from produtos where id=$1", [id(20)])),
      90,
    );

    // Crédito integral não gera parcela, mas ainda deve gerar prova logística privada.
    await db.query(
      "insert into pedidos(id,numero,cliente_id,centro_id,status,data_pedido,forma_pagamento_id) values($1,300,$2,$3,'rascunho',current_date,$4)",
      [id(504), id(90), id(10), id(30)],
    );
    await db.query("select definir_modalidade_pedido_296($1,'intermediacao')", [id(504)]);
    await db.query("select salvar_item_intermediacao_296($1,null,$2,10,$3,3,2.5)", [
      id(504),
      id(20),
      q2.id,
    ]);
    await db.query(
      "insert into creditos_clientes(id,cliente_id,centro_id,valor_original,valor_utilizado,status) values($1,$2,$3,355,0,'disponivel')",
      [id(801), id(90), id(10)],
    );
    await db.query(
      "insert into creditos_clientes_aplicacoes(pedido_id,credito_id,valor,status) values($1,$2,355,'reservado')",
      [id(504), id(801)],
    );
    await db.query("select confirmar_pedido($1)", [id(504)]);
    assert.equal(
      Number(await scalar("select count(*) from contas_receber where pedido_id=$1", [id(504)])),
      0,
    );
    assert.equal(await scalar("select pedido_confirmado_logistica_233($1)", [id(504)]), true);
    assert.equal(
      Number(
        await scalar("select count(*) from estoque_movimentos where documento_id=$1", [id(504)]),
      ),
      0,
    );
    // Desabilitar a loja impede novos pedidos, sem reescrever os pedidos existentes.
    await db.query("select salvar_parametros_loja_243($1,$2::jsonb)", [
      id(10),
      JSON.stringify({ intermediacao_habilitada: "false" }),
    ]);
    assert.equal(await scalar("select intermediacao_ativa_296($1)", [id(10)]), false);
    await assert.rejects(() => cotacao(40), /Sem permissão/);
    await db.query(
      "insert into pedidos(id,numero,cliente_id,centro_id,status,data_pedido) values($1,299,$2,$3,'rascunho',current_date)",
      [id(503), id(90), id(10)],
    );
    await assert.rejects(
      () => db.query("select definir_modalidade_pedido_296($1,'intermediacao')", [id(503)]),
      /não habilitada/,
    );
    await db.query("select salvar_parametros_loja_243($1,$2::jsonb)", [
      id(10),
      JSON.stringify({ intermediacao_habilitada: "true" }),
    ]);
    assert.equal(
      Number(
        await scalar("select count(*) from vw_planejamento_compras_294 where id=$1", [id(501)]),
      ),
      0,
    );

    // A proposta precifica sem efeitos operacionais e conserva a cotação no aceite em outro dia.
    const correcao = fs.readFileSync("db/fase297_intermediacao_orcamento.sql", "utf8");
    await db.exec(correcao);
    await db.exec(correcao);
    await db.exec(fs.readFileSync("scripts/fixtures/orcamento-intermediacao-297.sql", "utf8"));
    await db.exec(`create table orcamento_contexto_aprovacao_241(pedido_id uuid primary key,usuario_id uuid,transacao bigint);
     create trigger orcamento_proteger_236 before update on pedidos for each row execute function proteger_orcamento_236();
     create trigger orcamento_itens_236 before insert or update or delete on pedido_itens for each row execute function proteger_orcamento_236();
     create trigger orcamento_sem_contas before insert on contas_receber for each row execute function impedir_efeito_orcamento_236();
     create trigger orcamento_sem_comissao before insert on comissoes for each row execute function impedir_efeito_orcamento_236();`);
    const anterior = await scalar(
      "select jsonb_build_array((select count(*) from contas_receber),(select count(*) from estoque_movimentos),(select count(*) from estoque_reservas),(select count(*) from comissoes),(select count(*) from expedicoes))",
    );
    await db.query(
      "insert into pedidos(id,numero,cliente_id,centro_id,status,data_pedido,forma_pagamento_id,tipo_documento,orcamento_situacao,orcamento_data,orcamento_validade) values($1,301,$2,$3,'rascunho',(now() at time zone 'America/Sao_Paulo')::date-1,$4,'orcamento','negociacao',(now() at time zone 'America/Sao_Paulo')::date-1,current_date+10)",
      [id(505), id(90), id(10), id(30)],
    );
    await db.query("select definir_modalidade_pedido_296($1,'intermediacao')", [id(505)]);
    const cotacaoOrc = (
      await db.query(
        "select * from salvar_cotacao_intermediacao_296($1,$2,(now() at time zone 'America/Sao_Paulo')::date-1,27)",
        [id(10), id(20)],
      )
    ).rows[0];
    await db.query("select salvar_item_intermediacao_296($1,null,$2,10,$3,3,2.5)", [
      id(505),
      id(20),
      cotacaoOrc.id,
    ]);
    assert.deepEqual(
      await scalar(
        "select jsonb_build_array((select count(*) from contas_receber),(select count(*) from estoque_movimentos),(select count(*) from estoque_reservas),(select count(*) from comissoes),(select count(*) from expedicoes))",
      ),
      anterior,
    );
    await assert.rejects(() => db.query("select confirmar_pedido($1)", [id(505)]), /orçamento/);
    await db.query("select decidir_orcamento_236($1,'aceitar',null)", [id(505)]);
    const convertido = (await db.query("select * from pedidos where id=$1", [id(505)])).rows[0];
    assert.equal(convertido.tipo_documento, "pedido");
    assert.equal(convertido.status, "aprovado");
    assert.equal(Number(convertido.total_liquido), 325);
    assert.equal(
      await scalar(
        "select data_pedido=(now() at time zone 'America/Sao_Paulo')::date and orcamento_data<data_pedido from pedidos where id=$1",
        [id(505)],
      ),
      true,
    );
    assert.equal(
      Number(
        await scalar("select custo_fabrica_saca from pedido_itens where pedido_id=$1", [id(505)]),
      ),
      27,
    );
    assert.equal(
      Number(await scalar("select count(*) from contas_receber where pedido_id=$1", [id(505)])),
      0,
    );
    await db.query("select confirmar_pedido($1)", [id(505)]);
    assert.equal(
      Number(await scalar("select sum(valor) from contas_receber where pedido_id=$1", [id(505)])),
      325,
    );
    assert.equal(
      Number(
        await scalar("select count(*) from estoque_movimentos where documento_id=$1", [id(505)]),
      ),
      0,
    );
    await assert.rejects(
      () => db.query("update pedidos set orcamento_data=current_date where id=$1", [id(505)]),
      /data base/,
    );

    await db.query(
      "insert into pedidos(id,numero,cliente_id,centro_id,status,data_pedido,forma_pagamento_id,tipo_documento,orcamento_situacao,orcamento_data,orcamento_validade) values($1,302,$2,$3,'rascunho',current_date,$4,'orcamento','negociacao',current_date,current_date+10)",
      [id(506), id(90), id(10), id(30)],
    );
    await db.query("select definir_modalidade_pedido_296($1,'intermediacao')", [id(506)]);
    const recusado = (
      await db.query("select * from salvar_item_intermediacao_296($1,null,$2,10,$3,3,2.5)", [
        id(506),
        id(20),
        q2.id,
      ])
    ).rows[0];
    await db.query("select decidir_orcamento_236($1,'recusar','Cliente não aprovou a proposta')", [
      id(506),
    ]);
    await assert.rejects(
      () =>
        db.query("select salvar_item_intermediacao_296($1,$2,$3,10,$4,4,2.5)", [
          id(506),
          recusado.id,
          id(20),
          q2.id,
        ]),
      /validade/,
    );
    assert.equal(
      Number(await scalar("select count(*) from contas_receber where pedido_id=$1", [id(506)])),
      0,
    );

    // Precificação no orçamento não exige a autorização administrativa para configurar lojas.
    await db.exec(
      "create or replace function can_manage(uuid) returns boolean language sql as $$select false$$",
    );
    const comercial = await cotacao(32);
    assert.equal(Number(comercial.custo_fabrica), 32);
    await db.exec("set test.preco='false'");
    await assert.rejects(() => cotacao(33), /Sem permissão/);
    await db.exec(
      "set test.preco='true';create or replace function can_manage(uuid) returns boolean language sql as $$select usuario_ativo()$$",
    );
    await db.exec("set role authenticated");
    await assert.rejects(
      () =>
        db.query(
          "insert into intermediacao_confirmacoes_296(pedido_id,ciclo,valor,created_by) values($1,99,1,$2)",
          [id(500), id(1)],
        ),
      /permission denied/,
    );

    await assert.rejects(
      () => db.query("delete from intermediacao_cotacoes_296 where id=$1", [q1.id]),
      /permission denied/,
    );
    await db.exec("reset role;set test.ativo='false'");
    await assert.rejects(() => cotacao(35), /Sem permissão/);
    await db.exec("set test.ativo='true';set role anon");
    await assert.rejects(
      () => db.exec("select * from intermediacao_cotacoes_296"),
      /permission denied/,
    );
    await assert.rejects(
      () => db.query("select definir_modalidade_pedido_296($1,'estoque')", [id(500)]),
      /permission denied/,
    );
    console.log(
      "OK: intermediação por loja; revisões e custo congelado; fábrica+frete+margem; parcelas integrais idempotentes; confirmação/conferência/cancelamento sem estoque; RLS e permissões.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
