const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const root = path.resolve(__dirname, "..");
(async () => {
  const db = new PGlite();
  await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;
 create function auth.role() returns text language sql as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,ativo boolean,nome text default 'Usuário teste');
 create table user_roles(user_id uuid,role text);create table role_menus(role text,path text);
 create table sicredi_cnab_config(id uuid primary key,cooperativa text,proxima_remessa int default 1,api_key text);
 create table centros(id uuid primary key,nome text,ativo boolean default true);create table usuario_centros(user_id uuid,centro_id uuid);
 create table representantes(id uuid primary key,profile_id uuid);
 create table formas_pagamento(id uuid primary key,taxa_percentual numeric,desconto_percentual numeric);
 create table parametros(chave text primary key,valor text,descricao text);
 create table clientes(id uuid primary key,razao_social text,representante_id uuid,centro_id uuid,rota_id uuid,status text default 'ativo',limite_credito numeric default 0);
 create table produtos(id uuid primary key,descricao text,codigo text,unidade text default 'UN',ativo boolean default true,custo_medio numeric,preco_custo numeric,ultimo_custo numeric,preco_venda numeric,estoque_atual numeric default 100,margem_minima numeric default 0);
 create table pedidos(id uuid primary key,numero int,centro_id uuid,cliente_id uuid,representante_id uuid,data_pedido date,status text,total_liquido numeric,frete_valor numeric default 0,comissao_percentual numeric default 0,comissao_valor numeric default 9,forma_pagamento_id uuid,desconto_valor numeric default 0,forma_desconto_valor numeric default 0,forma_acrescimo_valor numeric default 0,total_itens numeric default 90,parcelas int default 1);
 create table pedido_itens(id uuid primary key,pedido_id uuid references pedidos(id),produto_id uuid references produtos(id),quantidade numeric,preco_unitario numeric,desconto_percentual numeric default 0,total numeric);
 create table contas_receber(id uuid primary key default gen_random_uuid(),documento text,parcela int,data_emissao date,pedido_id uuid,cliente_id uuid,centro_id uuid,vencimento date,valor numeric,valor_pago numeric default 0,status text);
 create table contas_financeiras(id uuid primary key,nome text,centro_id uuid,banco_codigo text,agencia text,conta text);
 create table movimentos_financeiros(id uuid primary key,conta_id uuid,centro_id uuid,data date,valor numeric,tipo text,status text);
 create table comissoes(id uuid primary key default gen_random_uuid(),percentual numeric,pedido_id uuid,representante_id uuid,centro_id uuid,base_calculo numeric,valor numeric,status text);
 create table devolucoes(id uuid primary key,numero int,cliente_id uuid,pedido_id uuid,centro_id uuid,status text,valor_total numeric);
 create table devolucao_itens(id uuid primary key,devolucao_id uuid references devolucoes(id),produto_id uuid,quantidade numeric,total numeric);
 create table devolucao_operacoes(id uuid default gen_random_uuid(),devolucao_id uuid,tipo text,created_by uuid,unique(devolucao_id,tipo));
 create table creditos_clientes_aplicacoes(id uuid,credito_id uuid,pedido_id uuid,status text,valor numeric,aplicado_em timestamptz);
 create table creditos_clientes(id uuid default gen_random_uuid(),devolucao_id uuid,valor_utilizado numeric default 0,status text);
 create table estoque_movimentos(id uuid default gen_random_uuid(),produto_id uuid,centro_id uuid,tipo text,quantidade numeric check(quantidade>0),custo_unitario numeric,origem text,documento_id uuid,observacao text,created_by uuid);
 create table expedicoes(id uuid primary key,pedido_id uuid,centro_id uuid,status text);
 create table cargas(id uuid primary key,centro_id uuid,status text,peso_kg numeric);
 create table auditoria(id uuid default gen_random_uuid(),tabela text,registro_id uuid,acao text,detalhe jsonb,user_id uuid,created_at timestamptz default now());
 create table reposicao_base(produto_id uuid,centro_id uuid,descricao text,unidade text,centro text,estoque_atual numeric,estoque_minimo numeric,prazo_fornecedor_dias int,venda_90 numeric,pedidos_pendentes numeric,em_transito numeric);
 create view vw_sugestao_compras_centro with(security_invoker=on) as select * from reposicao_base;
 create function usuario_ativo() returns boolean language sql security definer set search_path=public as $$select coalesce((select ativo from profiles where id=auth.uid()),false)$$;
 create function has_role(u uuid,r text) returns boolean language sql security definer set search_path=public as $$select exists(select 1 from user_roles where user_id=u and role=r)$$;
 create function can_manage(u uuid) returns boolean language sql as $$select has_role(u,'admin') or has_role(u,'gestor')$$;
 create function can_finance(u uuid) returns boolean language sql as $$select can_manage(u) or has_role(u,'financeiro')$$;
 create function resolver_comissao(uuid,uuid,date,uuid,numeric) returns numeric language sql as $$select case when $1 is null then 0 else 10 end$$;
 create function can_operate(u uuid) returns boolean language sql as $$select usuario_ativo()$$;
 create function recalcular_pedido(uuid) returns void language sql security definer set search_path=public as $$update pedidos set total_itens=coalesce((select sum(total) from pedido_itens where pedido_id=$1),0) where id=$1$$;
 create function registrar_movimento_estoque_controlado(uuid,uuid,text,numeric,numeric,text,uuid,text) returns void language sql as $$insert into estoque_movimentos(produto_id,centro_id,tipo,quantidade,origem,documento_id) values($1,$2,$3,$4,$6,$7)$$;
 create function can_ship(u uuid) returns boolean language sql as $$select can_manage(u) or has_role(u,'expedicao')$$;
 create function meu_representante_id() returns uuid language sql security definer set search_path=public as $$select id from representantes where profile_id=auth.uid()$$;
 create function escopo_representante() returns boolean language sql as $$select has_role(auth.uid(),'representante') and not has_role(auth.uid(),'admin')$$;
 create function usuario_pode_acessar_centro(c uuid) returns boolean language sql security definer set search_path=public as $$select usuario_ativo() and (has_role(auth.uid(),'admin') or exists(select 1 from usuario_centros where user_id=auth.uid() and centro_id=c))$$;
 create function cliente_na_minha_carteira(c uuid) returns boolean language sql security definer set search_path=public as $$select exists(select 1 from clientes where id=c and representante_id=meu_representante_id())$$;
 create function documento_na_minha_carteira(t text,d uuid) returns boolean language sql security definer set search_path=public as $$select case when t='devolucoes' then exists(select 1 from devolucoes where id=d and cliente_na_minha_carteira(cliente_id)) else exists(select 1 from pedidos where id=d and cliente_na_minha_carteira(cliente_id)) end$$;
 create function usuario_pode_acessar_conta_financeira(c uuid) returns boolean language sql security definer set search_path=public as $$select can_finance(auth.uid()) and exists(select 1 from contas_financeiras where id=c and (centro_id is null or usuario_pode_acessar_centro(centro_id)))$$;
 create function avancar_expedicao(_id uuid,_status text,_data date) returns void language sql security definer set search_path=public as $$update expedicoes set status=_status where id=_id$$;
 create function criar_credito_devolucao(uuid,uuid,uuid,numeric,text) returns void language sql as $$insert into creditos_clientes(devolucao_id,status) values($1,'disponivel')$$;
 create function notificar(text,text,text,text) returns void language sql as $$select$$;
 grant usage on schema public,auth to authenticated,anon;grant select on all tables in schema public to authenticated;
 grant update on pedidos,pedido_itens,comissoes,devolucoes,devolucao_itens,parametros,movimentos_financeiros,cargas to authenticated;
 insert into profiles(id,ativo) values('${uuid(1)}',true),('${uuid(2)}',true),('${uuid(3)}',true),('${uuid(4)}',true),('${uuid(5)}',false);
 insert into user_roles values('${uuid(1)}','admin'),('${uuid(2)}','representante'),('${uuid(3)}','representante'),('${uuid(4)}','financeiro'),('${uuid(5)}','admin');
 insert into centros values('${uuid(10)}','A',true),('${uuid(11)}','B',true);
 insert into usuario_centros values('${uuid(2)}','${uuid(10)}'),('${uuid(3)}','${uuid(10)}'),('${uuid(4)}','${uuid(10)}');
 insert into representantes values('${uuid(20)}','${uuid(2)}'),('${uuid(21)}','${uuid(3)}');
 insert into clientes(id,razao_social,representante_id,centro_id) values('${uuid(30)}','Cliente A','${uuid(20)}','${uuid(10)}'),('${uuid(31)}','Cliente B','${uuid(21)}','${uuid(10)}');
 insert into produtos(id,descricao,custo_medio,preco_custo,ultimo_custo) values('${uuid(40)}','Produto',50,0,0);
 insert into pedidos(id,numero,centro_id,cliente_id,representante_id,data_pedido,status,total_liquido,frete_valor,comissao_percentual,forma_pagamento_id) values('${uuid(50)}',1,'${uuid(10)}','${uuid(30)}','${uuid(20)}',current_date,'rascunho',90,0,10,'${uuid(999)}'),('${uuid(51)}',2,'${uuid(11)}','${uuid(31)}','${uuid(21)}',current_date,'confirmado',100,0,10,'${uuid(999)}');
 insert into pedido_itens(id,pedido_id,produto_id,quantidade,preco_unitario,total) values('${uuid(60)}','${uuid(50)}','${uuid(40)}',1,90,90);
 insert into contas_financeiras values('${uuid(70)}','Conta A','${uuid(10)}',null,null,null),('${uuid(71)}','Conta B','${uuid(11)}',null,null,null);
 insert into movimentos_financeiros values('${uuid(80)}','${uuid(70)}','${uuid(10)}',current_date,90,'entrada','ativo'),('${uuid(81)}','${uuid(71)}','${uuid(11)}',current_date,90,'entrada','ativo'),('${uuid(82)}','${uuid(70)}','${uuid(10)}',current_date,91,'entrada','ativo');
 insert into expedicoes values('${uuid(90)}','${uuid(50)}','${uuid(10)}','em_rota');
 insert into cargas values('${uuid(95)}','${uuid(10)}','aberta',500);
 insert into comissoes(id,pedido_id,representante_id,centro_id,base_calculo,valor,status) values('${uuid(100)}','${uuid(50)}','${uuid(20)}','${uuid(10)}',90,9,'prevista');
 insert into reposicao_base values('${uuid(40)}','${uuid(10)}','Produto','UN','A',10,5,20,90,4,2);
 alter table clientes enable row level security;create policy carteira on clientes for select to authenticated using(usuario_ativo() and usuario_pode_acessar_centro(centro_id) and (not escopo_representante() or cliente_na_minha_carteira(id)));
 alter table pedidos enable row level security;create policy carteira on pedidos for all to authenticated using(usuario_ativo() and usuario_pode_acessar_centro(centro_id) and (not escopo_representante() or cliente_na_minha_carteira(cliente_id)));
 `);
  await db.exec(`insert into sicredi_cnab_config values('${uuid(399)}','0165',1,'NAO_AUDITAR_API');
 create function cnab_salvar_config(_actor uuid,_config jsonb) returns void language plpgsql security definer set search_path=public as $$begin
 if coalesce(auth.role(),'')<>'service_role' or not has_role(_actor,'admin') or not exists(select 1 from profiles where id=_actor and ativo) then raise exception 'Ator inválido'; end if;
 update sicredi_cnab_config set cooperativa=_config->>'cooperativa',api_key=_config->>'api_key';end$$;
 revoke all on function cnab_salvar_config(uuid,jsonb) from public,anon,authenticated;grant execute on function cnab_salvar_config(uuid,jsonb) to service_role;`);
  const fonteApuracao = fs.readFileSync(
    path.join(root, "db/fase21_comissao_representante_logado.sql"),
    "utf8",
  );
  for (const nome of ["apurar_comissao_pedido", "trg_apurar_comissao_pedido"]) {
    const inicio = fonteApuracao.indexOf("create or replace function public." + nome + "(");
    await db.exec(fonteApuracao.slice(inicio, fonteApuracao.indexOf("$$;", inicio) + 3));
  }
  await db.exec(
    "create unique index comissoes_pedido_teste on comissoes(pedido_id) where pedido_id is not null;create trigger comissao_pedido_teste after insert or update of status,representante_id,total_itens,desconto_valor,comissao_percentual on pedidos for each row execute function public.trg_apurar_comissao_pedido()",
  );
  const fonteCalculo = fs.readFileSync(
    path.join(root, "db/fase41_forma_pagamento_desconto_acrescimo.sql"),
    "utf8",
  );
  const inicioCalculo = fonteCalculo.indexOf(
    "create or replace function public.recalcular_pedido(",
  );
  await db.exec(
    fonteCalculo.slice(inicioCalculo, fonteCalculo.indexOf("$function$;", inicioCalculo) + 12),
  );
  // Usa a validação de crédito e margem real da fase201; protege-a sem substituí-la.
  await db.exec(
    fs
      .readFileSync(path.join(root, "db/fase201_regras_aprovacao_credito.sql"), "utf8")
      .replaceAll(", service_role", ""),
  );
  for (const nome of ["confirmar_devolucao", "cancelar_devolucao", "confirmar_pedido"]) {
    const sql = fs.readFileSync(path.join(root, "db/fase80_credito_cliente_devolucao.sql"), "utf8");
    const inicio = sql.indexOf("create or replace function public." + nome + "(");
    await db.exec(sql.slice(inicio, sql.indexOf("$$;", inicio) + 3));
  }
  const fonteItens = fs.readFileSync(
    path.join(root, "db/fase2_vendas_estoque_financeiro.sql"),
    "utf8",
  );
  const inicioItens = fonteItens.indexOf("create or replace function public.pedido_itens_after()");
  await db.exec(fonteItens.slice(inicioItens, fonteItens.indexOf("$$;", inicioItens) + 3));
  await db.exec(
    "create trigger recalcular_item_teste after insert or update or delete on pedido_itens for each row execute function public.pedido_itens_after()",
  );
  const migration = fs.readFileSync(
    path.join(root, "db/fase209_rotinas_distribuidora.sql"),
    "utf8",
  );
  await db.exec(migration);
  await db.exec(migration);
  const login = async (n) =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${uuid(n)}',false);set role authenticated;`,
    );
  await login(1);
  assert.equal(
    (await db.query(`select resultado from vw_margem_pedido_209 where pedido_id='${uuid(50)}'`))
      .rows[0].resultado,
    "31.00",
  );
  await db.query("select definir_custo_frete_pedido($1,40)", [uuid(50)]);
  assert.match(
    JSON.stringify((await db.query("select validar_pedido($1) v", [uuid(50)])).rows[0].v),
    /Margem de contribuição/,
  );
  await db.query("select definir_custo_frete_pedido($1,0)", [uuid(50)]);
  await db.exec(
    `update pedidos set status='confirmado' where id='${uuid(50)}';reset role;update produtos set custo_medio=80;set role authenticated;`,
  );
  assert.equal(
    Number(
      (await db.query(`select custo from vw_margem_pedido_209 where pedido_id='${uuid(50)}'`))
        .rows[0].custo,
    ),
    50,
  );
  await assert.rejects(
    db.query("select definir_custo_frete_pedido($1,10)", [uuid(50)]),
    /antes da confirmação/,
  );
  await db.exec(
    `reset role;insert into pedidos(id,numero,centro_id,cliente_id,representante_id,data_pedido,status,total_liquido,forma_pagamento_id,custo_frete) values('${uuid(52)}',3,'${uuid(10)}','${uuid(30)}','${uuid(20)}',current_date,'rascunho',90,'${uuid(999)}',20);insert into pedido_itens(id,pedido_id,produto_id,quantidade,preco_unitario,total) values('${uuid(62)}','${uuid(52)}','${uuid(40)}',1,90,90);set role authenticated;`,
  );
  await assert.rejects(db.query("select confirmar_pedido($1)", [uuid(52)]), /requer aprovação/);
  await db.exec(`update pedidos set status='aprovado' where id='${uuid(52)}'`);
  await db.query("select confirmar_pedido($1)", [uuid(52)]);
  assert.equal(
    (await db.query(`select status from pedidos where id='${uuid(52)}'`)).rows[0].status,
    "confirmado",
  );
  await db.query("select confirmar_pedido($1)", [uuid(52)]);
  assert.equal(
    (await db.query(`select count(*) n from contas_receber where pedido_id='${uuid(52)}'`)).rows[0]
      .n,
    1,
  );
  assert.equal(
    (await db.query(`select count(*) n from comissoes where pedido_id='${uuid(52)}'`)).rows[0].n,
    1,
  );
  const reposicao = (await db.query("select * from vw_reposicao_209")).rows[0];
  assert.equal(Number(reposicao.compra_recomendada), 42);
  assert.equal(reposicao.situacao, "repor");
  await login(2);
  await assert.rejects(
    db.query("select registrar_acompanhamento($1,$2,$3,current_date,$4)", [
      uuid(31),
      uuid(10),
      "comercial",
      "Visita",
    ]),
    /Cliente sem acesso/,
  );
  const agenda = (
    await db.query("select registrar_acompanhamento($1,$2,$3,current_date,$4) id", [
      uuid(30),
      uuid(10),
      "comercial",
      "Visita",
    ])
  ).rows[0].id;
  assert.equal((await db.query("select count(*) n from acompanhamentos")).rows[0].n, 1);
  await login(3);
  assert.equal((await db.query("select count(*) n from acompanhamentos")).rows[0].n, 0);
  await assert.rejects(db.query("select concluir_acompanhamento($1)", [agenda]), /sem acesso/);
  await login(4);
  const cobranca = (
    await db.query("select registrar_acompanhamento($1,$2,$3,current_date,$4) id", [
      uuid(30),
      uuid(10),
      "cobranca",
      "Ligação",
    ])
  ).rows[0].id;
  await assert.rejects(
    db.query("select registrar_acompanhamento($1,$2,$3,current_date,$4)", [
      uuid(30),
      uuid(10),
      "cobranca",
      "Duplicada",
    ]),
    /já tem cobrança aberta/,
  );
  await db.query("select concluir_acompanhamento($1)", [cobranca]);
  const linhas = JSON.stringify([
    { referencia: "TX1", data: "2026-10-08", valor: 90, descricao: "Teste" },
  ]);
  assert.equal(
    (await db.query("select importar_extrato_bancario($1,$2::jsonb) n", [uuid(70), linhas])).rows[0]
      .n,
    1,
  );
  assert.equal(
    (await db.query("select importar_extrato_bancario($1,$2::jsonb) n", [uuid(70), linhas])).rows[0]
      .n,
    0,
  );
  await assert.rejects(
    db.query("select importar_extrato_bancario($1,$2::jsonb)", [uuid(71), linhas]),
    /sem acesso/,
  );
  const linha = (await db.query("select id from extrato_bancario_linhas")).rows[0].id;
  await assert.rejects(
    db.query("select conciliar_extrato($1,$2)", [linha, uuid(82)]),
    /valor correspondente/,
  );
  await assert.rejects(
    db.query("select conciliar_extrato($1,$2)", [linha, uuid(81)]),
    /outra conta/,
  );
  await db.query("select conciliar_extrato($1,$2)", [linha, uuid(80)]);
  await db.query("select conciliar_extrato($1,$2)", [linha, uuid(80)]);
  await assert.rejects(
    db.exec(`update movimentos_financeiros set status='estornado' where id='${uuid(80)}'`),
    /Desfaça a conciliação/,
  );
  await db.query("select desconciliar_extrato($1,$2)", [linha, "Conferir referência"]);
  await login(2);
  assert.equal((await db.query("select count(*) n from extrato_bancario_linhas")).rows[0].n, 0);
  await assert.rejects(
    db.query("select importar_extrato_bancario($1,$2::jsonb)", [uuid(70), linhas]),
    /sem acesso/,
  );
  await login(1);
  await assert.rejects(
    db.exec(`reset role; update expedicoes set status='entregue' where id='${uuid(90)}'`),
    /Registre recebedor/,
  );
  await login(1);
  await db.query("select registrar_entrega($1,$2,$3,$4,$5)", [
    uuid(90),
    "entrega",
    "Recebedor",
    "CANHOTO-001",
    "Conferido",
  ]);
  await db.query("select registrar_entrega($1,$2,$3,$4,$5)", [
    uuid(90),
    "entrega",
    "Recebedor",
    "CANHOTO-001",
    "Retry",
  ]);
  assert.equal(
    (await db.query(`select status from expedicoes where id='${uuid(90)}'`)).rows[0].status,
    "entregue",
  );
  assert.equal((await db.query("select count(*) n from entrega_registros")).rows[0].n, 1);
  await db.query("select definir_capacidade_carga($1,400)", [uuid(95)]);
  await assert.rejects(
    db.exec(`update cargas set status='fechada' where id='${uuid(95)}'`),
    /excede/,
  );
  await db.query("select definir_capacidade_carga($1,600)", [uuid(95)]);
  await db.exec(`update cargas set status='fechada' where id='${uuid(95)}'`);
  await db.exec(`update parametros set valor='recebimento' where chave='comissao_fato_gerador'`);
  await assert.rejects(
    db.exec(`update comissoes set status='liberada' where id='${uuid(100)}'`),
    /recebimento integral/,
  );
  await db.exec(
    `reset role;insert into contas_receber(id,pedido_id,cliente_id,centro_id,vencimento,valor,valor_pago,status) values('${uuid(110)}','${uuid(50)}','${uuid(30)}','${uuid(10)}',current_date,90,90,'pago');set role authenticated;update comissoes set status='liberada' where id='${uuid(100)}';`,
  );
  await db.exec(
    `reset role;insert into pedidos(id,numero,centro_id,cliente_id,data_pedido,status,total_liquido) values('${uuid(54)}',4,'${uuid(10)}','${uuid(30)}',current_date,'confirmado',90);insert into comissoes(id,pedido_id,representante_id,centro_id,base_calculo,valor,status) values('${uuid(104)}','${uuid(54)}','${uuid(20)}','${uuid(10)}',90,9,'prevista');insert into creditos_clientes_aplicacoes(id,pedido_id,status,valor) values('${uuid(301)}','${uuid(54)}','aplicado',90);set role authenticated;update comissoes set status='liberada' where id='${uuid(104)}';`,
  );
  await db.exec(`reset role;insert into devolucoes values('${uuid(120)}',1,'${uuid(30)}','${uuid(50)}','${uuid(10)}','rascunho',45,'credito',null);
 insert into devolucao_itens(id,devolucao_id,produto_id,quantidade,total,condicao) values('${uuid(121)}','${uuid(120)}','${uuid(40)}',0.5,45,'avaria');set role authenticated;`);
  await db.query("select confirmar_devolucao($1)", [uuid(120)]);
  await db.query("select confirmar_devolucao($1)", [uuid(120)]);
  assert.equal(
    (await db.query("select count(*) n from estoque_movimentos where origem like 'devolucao%'"))
      .rows[0].n,
    0,
  );
  assert.equal(
    (await db.query(`select valor from comissoes where id='${uuid(100)}'`)).rows[0].valor,
    "4.50",
  );
  await assert.rejects(
    db.exec(`update devolucao_itens set condicao='revenda' where id='${uuid(121)}'`),
    /imutáveis/,
  );
  await db.query("select recalcular_pedido($1)", [uuid(50)]);
  assert.equal(
    (await db.query(`select valor from comissoes where id='${uuid(100)}'`)).rows[0].valor,
    "4.50",
  );
  await db.query("select cancelar_devolucao($1)", [uuid(120)]);
  assert.equal(
    (await db.query("select count(*) n from estoque_movimentos where origem like 'devolucao%'"))
      .rows[0].n,
    0,
  );
  assert.equal(
    (await db.query(`select valor from comissoes where id='${uuid(100)}'`)).rows[0].valor,
    "9.00",
  );
  await db.exec(
    `update comissoes set status='paga' where id='${uuid(100)}';reset role;insert into devolucoes values('${uuid(122)}',2,'${uuid(30)}','${uuid(50)}','${uuid(10)}','rascunho',45,'credito',null);insert into devolucao_itens(id,devolucao_id,produto_id,quantidade,total) values('${uuid(123)}','${uuid(122)}','${uuid(40)}',0.5,45);set role authenticated;`,
  );
  await db.query("select confirmar_devolucao($1)", [uuid(122)]);
  assert.equal(
    Number(
      (
        await db.query(
          "select sum(quantidade) n from estoque_movimentos where origem like 'devolucao%'",
        )
      ).rows[0].n,
    ),
    0.5,
  );
  assert.equal((await db.query("select valor from comissao_ajustes")).rows[0].valor, "4.50");
  await db.query("select recalcular_pedido($1)", [uuid(50)]);
  assert.equal(
    (await db.query(`select valor from comissoes where id='${uuid(100)}'`)).rows[0].valor,
    "9.00",
  );
  const ajuste = (await db.query("select id from comissao_ajustes")).rows[0].id;
  await db.query("select conferir_ajuste_comissao($1,$2)", [
    ajuste,
    "Acerto financeiro documento 123",
  ]);
  await db.exec(
    `reset role;insert into parametros values('token_secreto','NAO_AUDITAR','Teste');set role authenticated;`,
  );
  assert.equal(
    (await db.query(`select count(*) n from auditoria where detalhe::text like '%NAO_AUDITAR%'`))
      .rows[0].n,
    0,
  );
  assert.ok(
    (await db.query(`select detalhe from auditoria where tabela='comissoes'`)).rows.length === 0,
  ); // Comissão usa ajuste específico; sem cópia indiscriminada.
  assert.ok(
    (
      await db.query(
        `select detalhe from auditoria where tabela='pedidos' and detalhe->'depois' ? 'custo_frete'`,
      )
    ).rows.length > 0,
  );
  await db.exec(
    `reset role;insert into user_roles values('${uuid(2)}','gestor');insert into devolucoes(id,numero,cliente_id,centro_id,status,valor_total) values('${uuid(124)}',3,'${uuid(31)}','${uuid(10)}','rascunho',45);`,
  );
  await login(2);
  await assert.rejects(
    db.query("select confirmar_devolucao($1)", [uuid(124)]),
    /sem acesso à carteira/,
  );
  await assert.rejects(
    db.query("select cancelar_devolucao($1)", [uuid(124)]),
    /sem acesso à carteira/,
  );
  await db.exec(
    `reset role;select set_config('request.jwt.claim.sub','',false);select set_config('request.jwt.claim.role','service_role',false);set role service_role;`,
  );
  await db.query("select cnab_salvar_config($1,$2::jsonb)", [
    uuid(1),
    JSON.stringify({ cooperativa: "0175", api_key: "NAO_AUDITAR_API_NOVA" }),
  ]);
  await db.exec("reset role");
  const banco = (
    await db.query("select user_id,detalhe from auditoria where tabela='sicredi_cnab_config'")
  ).rows;
  assert.equal(banco.length, 1);
  assert.equal(banco[0].user_id, uuid(1));
  assert.equal(banco[0].detalhe.antes.cooperativa, "0165");
  assert.equal(banco[0].detalhe.depois.cooperativa, "0175");
  assert.equal(JSON.stringify(banco).includes("NAO_AUDITAR_API"), false);
  await db.exec("update sicredi_cnab_config set proxima_remessa=2");
  assert.equal(
    (await db.query("select count(*) n from auditoria where tabela='sicredi_cnab_config'")).rows[0]
      .n,
    1,
  );
  await db.exec("select set_config('request.jwt.claim.role','authenticated',false)");
  await login(5);
  await assert.rejects(
    db.query("select registrar_acompanhamento($1,$2,$3,current_date,$4)", [
      uuid(30),
      uuid(10),
      "comercial",
      "Desativado",
    ]),
    /Sem permissão/,
  );
  await db.exec("reset role;set role anon");
  await assert.rejects(
    db.query("select concluir_acompanhamento($1)", [agenda]),
    /permission denied/,
  );
  await db.exec(`reset role;
    create type app_role as enum ('admin','gestor','financeiro','comercial','representante','estoque','expedicao');
    alter table role_menus alter column role type app_role using role::app_role;
    alter table role_menus add primary key(role,path);
    create table papeis(codigo text primary key);
    insert into papeis select unnest(enum_range(null::app_role))::text;
    create table permissoes(codigo text primary key,nome text,grupo text,ordem int);
    create table role_permissoes(role text,permissao text references permissoes,primary key(role,permissao));
    insert into permissoes values('financeiro_ver','Financeiro','Financeiro',1);
    insert into role_permissoes values('financeiro','financeiro_ver');
    insert into role_menus values('representante','/lead-rota'),('representante','/pedidos'),('representante','/dashboard'),('financeiro','/receber'),('financeiro','/movimentacoes');
    grant select on papeis,permissoes,role_permissoes to authenticated;
    delete from user_roles where user_id='${uuid(2)}' and role='gestor';
  `);
  const acessoSql = fs.readFileSync(path.join(root, "db/fase211_acessos_rotinas.sql"), "utf8");
  await db.exec(acessoSql);
  await db.exec(acessoSql);
  await login(2);
  assert.equal((await db.query("select pode_rotina('comercial_acompanhar') ok")).rows[0].ok, true);
  assert.equal((await db.query("select pode_rotina('extrato_ver') ok")).rows[0].ok, false);
  await assert.rejects(
    db.query("select admin_salvar_acesso('representante',array['/pedidos'],array[]::text[])"),
    /Somente administrador/,
  );
  await login(1);
  await assert.rejects(
    db.query("select admin_salvar_acesso('representante',array['/desconhecido'],array[]::text[])"),
    /Menu desconhecido/,
  );
  await db.query(
    "select admin_salvar_acesso('representante',array['/lead-rota','/pedidos'],array['margem_pedido_ver','comercial_acompanhar'])",
  );
  await login(2);
  assert.equal((await db.query("select pode_rotina('comercial_acompanhar') ok")).rows[0].ok, false);
  await assert.rejects(
    db.query("select registrar_acompanhamento($1,$2,'comercial',current_date,'Teste bloqueado')", [
      uuid(30),
      uuid(10),
    ]),
    /Ação não liberada/,
  );
  assert.equal((await db.query("select * from vw_carteira_comercial_209")).rows.length, 0);
  await login(1);
  await db.query(
    "select admin_salvar_acesso('financeiro',array['/movimentacoes','/cobranca'],array['financeiro_ver','extrato_ver'])",
  );
  await login(4);
  assert.equal((await db.query("select pode_rotina('extrato_ver') ok")).rows[0].ok, true);
  await assert.rejects(
    db.query("select importar_extrato_bancario($1,$2::jsonb)", [uuid(80), "[]"]),
    /Ação não liberada/,
  );
  await assert.rejects(
    db.query("delete from role_permissoes where role='financeiro'"),
    /permission denied/,
  );
  await login(5);
  await assert.rejects(
    db.query("select definir_permissao('financeiro','extrato_importar',true)"),
    /Somente administrador ativo/,
  );
  await db.exec("reset role");
  await db.exec(acessoSql);
  assert.equal(
    (
      await db.query(
        "select * from role_permissoes where role='financeiro' and permissao='extrato_importar'",
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query(
        "select * from role_menus where role='representante' and path='/agenda-comercial'",
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query(
        "select * from role_permissoes where role='financeiro' and permissao='financeiro_ver'",
      )
    ).rows.length,
    1,
  );
  await login(1);
  await db.query("select admin_salvar_acesso('financeiro',array[]::text[],array[]::text[])");
  assert.equal((await db.query("select * from role_menus where role='financeiro'")).rows.length, 0);
  await db.exec("reset role;set role anon");
  await assert.rejects(db.query("select pode_rotina('extrato_ver')"), /permission denied/);
  await require("./check-expansao-database.cjs")(db, uuid, login, root);
  await db.close();
  console.log(
    "Rotinas OK: migração reaplicável, margem/custo capturado, reposição, carteiras, cobrança única, importação idempotente, conciliação, entrega, capacidade, comissões, devolução/avaria/cancelamento e auditoria sem segredos.",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
