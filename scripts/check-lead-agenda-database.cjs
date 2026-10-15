const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
(async () => {
  const d = new PGlite();
  try {
    await d.exec(
      `create role anon;create role authenticated;create schema auth;
 create type app_role as enum('admin','gestor','representante','financeiro','comercial');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table profiles(id uuid primary key,nome text,ativo boolean default true,representante_id uuid);
 create table user_roles(user_id uuid,role app_role);
 create table papeis(codigo text primary key);
 create table permissoes(codigo text primary key,nome text,grupo text,ordem int,modulo text);
 create table role_menus(role app_role,path text,primary key(role,path));
 create table role_permissoes(role text,permissao text,primary key(role,permissao));
 create table centros(id uuid primary key,nome text);
 create table representantes(id uuid primary key,nome text);
 create table rotas(id uuid primary key,nome text);
 create table clientes(id uuid primary key,codigo text,razao_social text,representante_id uuid,centro_id uuid,rota_id uuid,cidade text,uf text,telefone text,status text default 'ativo');
 create table pedidos(id uuid default gen_random_uuid(),cliente_id uuid,centro_id uuid,status text,data_pedido date,total_liquido numeric);
 create table contas_receber(id uuid primary key default gen_random_uuid(),cliente_id uuid,centro_id uuid,documento text,parcela int,vencimento date,status text,valor numeric,valor_pago numeric default 0,juros numeric default 0,multa numeric default 0,acrescimo numeric default 0,desconto numeric default 0);
 create table acompanhamentos(id uuid primary key default gen_random_uuid(),cliente_id uuid references clientes(id),centro_id uuid,tipo text,responsavel uuid default auth.uid(),responsavel_nome text,status text default 'aberto',proxima_acao date,promessa_data date,promessa_valor numeric,resultado text,observacao text,created_at timestamptz default now(),concluido_em timestamptz);
 create unique index cobranca_unica on acompanhamentos(cliente_id) where tipo='cobranca' and status='aberto';
 alter table acompanhamentos enable row level security;
 revoke all on acompanhamentos from public,anon,authenticated;grant select on acompanhamentos to authenticated;
 alter table contas_receber enable row level security;grant select on contas_receber to authenticated;
 create table auditoria(tabela text,registro_id uuid,acao text,user_id uuid,detalhe jsonb);
 create function has_role(uuid,text) returns boolean language sql stable security definer set search_path=public as $$select exists(select1 from user_roles where user_id=$1 and role::text=$2)$$;
 create function usuario_ativo() returns boolean language sql stable security definer set search_path=public as $$select coalesce((select ativo from profiles where id=auth.uid()),false)$$;
 create function can_manage(uuid) returns boolean language sql stable security definer set search_path=public as $$select has_role($1,'admin') or has_role($1,'gestor')$$;
 create function can_finance(uuid) returns boolean language sql stable security definer set search_path=public as $$select can_manage($1) or has_role($1,'financeiro')$$;
 create function meu_representante_id() returns uuid language sql stable security definer set search_path=public as $$select representante_id from profiles where id=auth.uid()$$;
 create function usuario_pode_acessar_centro(uuid) returns boolean language sql stable security definer set search_path=public as $$select usuario_ativo() and ($1='${id(10)}'::uuid or has_role(auth.uid(),'admin'))$$;
 create function vencimento_util(date) returns date language sql stable as $$select $1$$;
 grant usage on schema public,auth to authenticated;
 insert into papeis values('admin'),('gestor'),('representante'),('financeiro'),('comercial');
 insert into profiles(id,nome,representante_id) values('${id(1)}','Rep A','${id(20)}'),('${id(2)}','Rep B','${id(21)}'),('${id(3)}','Master',null),('${id(4)}','Financeiro',null),('${id(5)}','Sem vínculo',null);
 insert into user_roles values('${id(1)}','representante'),('${id(2)}','representante'),('${id(3)}','admin'),('${id(4)}','financeiro'),('${id(5)}','representante');
 insert into role_menus values('representante','/agenda-comercial'),('financeiro','/cobranca'),('comercial','/clientes-inativos');
 insert into permissoes values('comercial_acompanhar','Comercial','Agenda',103,'/agenda-comercial'),('cobranca_acompanhar','Cobrança','Financeiro',104,'/cobranca');
 insert into role_permissoes values('representante','comercial_acompanhar'),('financeiro','cobranca_acompanhar');
 insert into centros values('${id(10)}','Loja A'),('${id(11)}','Loja B');
 insert into representantes values('${id(20)}','Rep A'),('${id(21)}','Rep B');
 insert into rotas values('${id(30)}','Rota A'),('${id(31)}','Rota B');
 insert into clientes(id,codigo,razao_social,representante_id,centro_id,rota_id,cidade) values
 ('${id(40)}','C001','Cliente A','${id(20)}','${id(10)}','${id(30)}','Cidade A'),
 ('${id(41)}','C002','Cliente B','${id(21)}','${id(10)}','${id(31)}','Cidade B'),
 ('${id(42)}','C003','Outra loja','${id(20)}','${id(11)}','${id(30)}','Cidade C');
 insert into pedidos(cliente_id,centro_id,status,data_pedido,total_liquido) values('${id(40)}','${id(10)}','confirmado',current_date-90,100),('${id(41)}','${id(10)}','confirmado',current_date-10,200);
 insert into contas_receber(cliente_id,centro_id,documento,parcela,vencimento,status,valor,juros,multa,acrescimo,desconto,valor_pago) values
 ('${id(40)}','${id(10)}','PED1',1,current_date-5,'parcial',100,5,2,3,1,10),
 ('${id(41)}','${id(10)}','PED2',1,current_date+5,'aberto',500,0,0,0,0,0),
 ('${id(40)}','${id(11)}','PED3',1,current_date-5,'aberto',800,0,0,0,0,0);
 `.replaceAll("select1", "select 1"),
    );
    const fn = async (file, name) => {
      const s = fs.readFileSync(path.join(root, "db", file), "utf8"),
        a = s.indexOf("create or replace function public." + name + "(");
      await d.exec(s.slice(a, s.indexOf("$$;", a) + 3));
    };
    await fn("fase206_carteira_representante.sql", "escopo_representante");
    await fn("fase206_carteira_representante.sql", "cliente_na_minha_carteira");
    await fn("fase211_acessos_rotinas.sql", "pode_rotina");
    const sql = fs.readFileSync(
      path.join(root, "db/fase228_agenda_comercial_unificada.sql"),
      "utf8",
    );
    await d.exec(sql);
    await d.exec(sql);
    const q = async (s, a = []) => (await d.query(s, a)).rows;
    const actor = async (n) => {
      await d.exec("reset role");
      await d.query("select set_config('test.actor',$1,false)", [id(n)]);
      await d.exec("set role authenticated");
    };

    await d.exec(`create role service_role;create table auth.users(id uuid primary key);
 insert into auth.users select id from profiles;
 alter table clientes add column nome_fantasia text,add column email text,add column logradouro text,add column numero text,add column bairro text,add column tabela_preco text,add column condicao_pagamento text default 'Boleto20/40/60',add column pessoa_id uuid,add column sequencia_entrega int,add column limite_credito numeric default 1000;
 alter table rotas add column sequencia int default 1,add column ativo boolean default true;
 alter table representantes add column ativo boolean default true;
 alter table pedidos add primary key(id),add column numero int generated by default as identity,add column representante_id uuid,add column rota_id uuid,add column created_at timestamptz default now(),add column previsao_entrega date,add column observacoes text,add column forma_pagamento_id uuid,add column parcelas int default 3;
 alter table pedidos alter column status set default 'rascunho';
 create table pessoas(id uuid primary key,telefone text,whatsapp text,ent_logradouro text);
 create table produtos(id uuid primary key,codigo text,descricao text,preco_venda numeric,estoque_atual numeric);
 create table pedido_itens(id uuid primary key default gen_random_uuid(),pedido_id uuid,produto_id uuid,quantidade numeric,preco_unitario numeric,desconto_percentual numeric,total numeric generated always as(quantidade*preco_unitario) stored);
 create table formas_pagamento(id uuid primary key default gen_random_uuid(),nome text,ativo boolean default true);
 create function can_operate(uuid) returns boolean language sql stable as $$select can_manage($1) or has_role($1,'representante')$$;
 create function recalcular_pedido(uuid) returns void language sql as $$update pedidos set total_liquido=(select coalesce(sum(total),0) from pedido_itens where pedido_id=$1) where id=$1$$;
 create function preco_produto(uuid,uuid) returns numeric language sql stable as $$select preco_venda from produtos where id=$1$$;
 insert into role_menus values('representante','/lead-rota'),('representante','/pedidos');
 insert into formas_pagamento(nome) values('Boleto20/40/60');
 insert into produtos values('${id(70)}','P001','Produto A',25,1000);
 insert into pedido_itens(pedido_id,produto_id,quantidade,preco_unitario,desconto_percentual) select id,'${id(70)}',4,10,5 from pedidos where cliente_id='${id(40)}';
 `);
    const source25 = fs.readFileSync(path.join(root, "db/fase25_lead_rota.sql"), "utf8");
    let a = source25.indexOf("create table if not exists public.lead_score_config"),
      b = source25.indexOf("-- escopo:");
    // Tabelas reais e índices, antes das políticas legadas.
    await d.exec(source25.slice(a, b));
    const pa = source25.indexOf("do $$", source25.indexOf("-- escopo:")),
      pb = source25.indexOf("end $$;", pa) + 7;
    await d.exec(source25.slice(pa, pb));
    await d.exec(
      "grant select on clientes to authenticated;alter table clientes enable row level security;create policy clientes_scope on clientes for select to authenticated using(agenda_cliente_acessivel_228(id))",
    );
    await fn("fase25_lead_rota.sql", "lead_aplicar_contato");
    await d.exec(
      "create trigger trg_lead_aplicar_contato after insert on lead_contatos for each row execute function lead_aplicar_contato()",
    );
    await fn("fase81_hardening_crud_pedidos.sql", "criar_pedido_rascunho");
    await fn("fase81_hardening_crud_pedidos.sql", "adicionar_item_pedido");
    await d.exec(
      `insert into lead_contatos(cliente_id,rota_id,resultado,responsavel) values('${id(40)}','${id(30)}','contato_realizado','${id(1)}')`,
    );
    const migration = fs.readFileSync(
      path.join(root, "db/fase229_lead_rota_agenda_integrada.sql"),
      "utf8",
    );
    await d.exec(migration);
    await d.exec(migration);
    await d.exec("grant select on pedidos,pedido_itens to authenticated");
    assert.equal(
      Number(
        (await q("select count(*) n from acompanhamentos where lead_contato_id is not null"))[0].n,
      ),
      1,
    );
    const lead = async (rota = id(30), rep = null, centro = null, cls = "", pagina = 1) =>
      (
        await q("select agenda_leads_229($1,$2,$3,'','',$4,'','oportunidade',$5) r", [
          rota,
          centro,
          rep,
          cls,
          pagina,
        ])
      )[0].r;
    await actor(1);
    let data = await lead();
    assert.equal(data.count, 1);
    assert.equal(data.rows[0].em_aberto, 99);
    assert.equal(data.rows[0].limite_disponivel, 901);
    assert.equal(data.rows[0].total_comprado, 100);
    assert.equal(data.contadores.contatados, 1);
    assert.equal((await lead(id(30), null, null, "inadimplente")).count, 1);
    assert.equal((await lead(id(30), null, null, "30")).count, 1);
    assert.equal((await lead(id(30), null, null, "recente")).count, 0);
    await assert.rejects(lead(id(30), id(21)), /fora da sua carteira/);
    await assert.rejects(q("select agenda_lead_cliente_229($1)", [id(41)]), /fora da carteira/);
    await assert.rejects(q("select agenda_lead_historico_229($1)", [id(41)]), /fora da carteira/);
    const h = (await q("select agenda_lead_historico_229($1) r", [id(40)]))[0].r;
    assert.equal(h.pedidos.length, 1);
    assert.equal(h.produtos[0].produto_codigo, "P001");
    await assert.rejects(
      q("select agenda_registrar_contato_229($1,$2,'pediu_retorno')", [id(41), id(31)]),
      /sem acesso/,
    );
    await assert.rejects(
      q("select agenda_registrar_contato_229($1,$2,'pediu_retorno')", [id(40), id(31)]),
      /Rota difere/,
    );
    let [{ atividade }] = await q(
      "select agenda_registrar_contato_229($1,$2,'pediu_retorno','Contato de teste',current_date+5,$3) atividade",
      [id(40), id(30), id(10)],
    );
    let [{ lead_contato_id, status }] = await q(
      "select lead_contato_id,status from acompanhamentos where id=$1",
      [atividade],
    );
    assert.ok(lead_contato_id);
    assert.equal(status, "aberto");
    // Registro comercial padrão também atualiza o mesmo funil e histórico.
    await q(
      "select registrar_acompanhamento($1,$2,'comercial',current_date+2,'Contato realizado','Pela agenda',null,null)",
      [id(40), id(10)],
    );
    assert.equal((await lead()).rows[0].funil_status, "proximo_contato");
    await q("select agenda_registrar_contato_229($1,$2,'sem_interesse',null,null,$3)", [
      id(40),
      id(30),
      id(10),
    ]);
    assert.equal((await lead()).rows[0].funil_status, "sem_interesse");
    await assert.rejects(
      q("insert into lead_contatos(cliente_id,resultado) values($1,'outro')", [id(40)]),
      /permission denied/,
    );
    await assert.rejects(q("select agenda_leads_base_229(null)"), /permission denied/);
    // Criação e repetição passam pelos motores81, com preço atual e condição real.
    const before = Number((await q("select count(*) n from pedidos"))[0].n);
    const [{ novo }] = await q("select lead_criar_pedido($1,'ultimo',$2,$3) novo", [
      id(40),
      id(30),
      id(10),
    ]);
    const [{ forma_pagamento_id }] = await q("select forma_pagamento_id from pedidos where id=$1", [
      novo,
    ]);
    assert.ok(forma_pagamento_id);
    const copied = await q(
      "select quantidade,preco_unitario,desconto_percentual from pedido_itens where pedido_id=$1",
      [novo],
    );
    assert.equal(Number(copied[0].quantidade), 4);
    assert.equal(Number(copied[0].preco_unitario), 25);
    assert.equal(Number(copied[0].desconto_percentual), 0);
    const [{ frequentes }] = await q("select lead_criar_pedido($1,'frequentes',$2,$3) frequentes", [
      id(40),
      id(30),
      id(10),
    ]);
    assert.equal(
      Number(
        (await q("select quantidade from pedido_itens where pedido_id=$1", [frequentes]))[0]
          .quantidade,
      ),
      4,
    );
    await assert.rejects(
      q("select lead_criar_pedido($1,'ultimo',$2,$3)", [id(41), id(31), id(10)]),
      /sem acesso/,
    );
    // Cobrança não altera funil comercial.
    const beforeContact = Number((await q("select count(*) n from lead_contatos"))[0].n);
    await q(
      "select registrar_acompanhamento($1,$2,'cobranca',current_date,'Cobrança',null,null,null)",
      [id(40), id(10)],
    );
    assert.equal(Number((await q("select count(*) n from lead_contatos"))[0].n), beforeContact);
    await assert.rejects(lead(id(30), null, id(11)), /Centro sem acesso/);
    await d.exec("reset role");
    await d.exec(`insert into user_roles values('${id(1)}','gestor')`);
    await actor(1);
    assert.equal((await lead()).count, 1);
    await d.exec("reset role");
    await d.exec(`insert into user_roles values('${id(1)}','admin')`);
    await actor(1);
    assert.equal((await lead()).count, 2);
    await d.exec("reset role");
    await d.exec(`delete from user_roles where user_id='${id(1)}' and role in ('admin','gestor')`);
    await actor(5);
    assert.equal((await lead()).count, 0);
    await actor(2);
    assert.equal((await lead()).count, 0);
    assert.equal((await lead(id(31))).count, 1);
    await actor(3);
    assert.equal((await lead()).count, 2);
    assert.equal((await lead(id(30), id(20), id(10))).count, 1);
    await d.exec("reset role");
    await d.exec(
      `insert into clientes(id,codigo,razao_social,representante_id,centro_id,rota_id,cidade) select gen_random_uuid(),'Z'||n,'Extra'||n,'${id(20)}','${id(10)}','${id(30)}','Cidade A' from generate_series(1,27)n;`,
    );
    await actor(1);
    const page1 = await lead(),
      page2 = await lead(id(30), null, null, "", 2);
    assert.equal(page1.count, 28);
    assert.equal(page1.rows.length, 24);
    assert.equal(page2.rows.length, 4);
    assert.equal(page1.contadores.total, 28);
    await d.exec("reset role");
    // Perder o menu Pedidos bloqueia criar, mas preserva a leitura da carteira.
    await d.exec("delete from role_menus where role='representante' and path='/pedidos'");
    await actor(1);
    await assert.rejects(
      q("select lead_criar_pedido($1,'vazio',$2,$3)", [id(40), id(30), id(10)]),
      /Menu Pedidos não liberado/,
    );
    assert.equal((await lead()).count, 28);
    await d.exec("reset role");
    // Originais históricos não são duplicados por reaplicar a migração.
    const counts = (await q("select count(*) n from acompanhamentos"))[0].n;
    await d.exec(migration);
    assert.equal((await q("select count(*) n from acompanhamentos"))[0].n, counts);
    await d.exec(
      "delete from role_permissoes where role='representante' and permissao='lead_rota_operar'",
    );
    await d.exec(migration);
    await actor(1);
    await assert.rejects(lead(), /não liberado/);
    await assert.rejects(
      q("select lead_criar_pedido($1,'vazio',$2,$3)", [id(40), id(30), id(10)]),
      /sem acesso/,
    );
    console.log(
      "OK229: Lead por carteira/centro, encargos reais, filtros, histórico, contatos ligados sem duplicação, funil, pedidos pelos motores81 e revogação preservada.",
    );
  } finally {
    await d.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
