-- Fase229: Lead Rota integrado à Agenda Comercial e contatos sincronizados.
begin;
lock table public.acompanhamentos,public.lead_contatos in share row exclusive mode;
do $$ begin
 if to_regprocedure('public.agenda_cliente_acessivel_228(uuid)') is null then raise exception 'Aplique a fase228 antes da fase229'; end if;
end $$;
insert into public.permissoes(codigo,nome,grupo,ordem,modulo)
values('lead_rota_operar','Consultar Lead Rota, histórico e funil de contatos','Agenda comercial',132,'/agenda-comercial')
on conflict(codigo) do update set nome=excluded.nome,grupo=excluded.grupo,modulo=excluded.modulo;
do $$ begin
 if not exists(select 1 from public.auditoria where tabela='fase229' and acao='instalada') then
  insert into public.role_permissoes(role,permissao)
   select distinct role::text,'lead_rota_operar' from public.role_menus where path='/lead-rota' on conflict do nothing;
  insert into public.role_menus(role,path)
   select distinct role,'/agenda-comercial' from public.role_menus where path='/lead-rota' on conflict do nothing;
  delete from public.role_menus where path='/lead-rota';
  insert into public.auditoria(tabela,acao,detalhe) values('fase229','instalada','{"modulo":"/agenda-comercial","lead":"integrado"}');
 end if;
end $$;

create or replace function public.agenda_acao_permitida_228(_tipo text)
returns boolean language sql stable security definer set search_path=public as $$
 select public.usuario_ativo() and case _tipo
 when 'cobranca' then public.pode_rotina('cobranca_acompanhar')
 when 'comercial' then public.pode_rotina('comercial_acompanhar') or public.pode_rotina('clientes_reativar') or public.pode_rotina('lead_rota_operar')
 else false end;
$$;
-- A fonte é privada. Cada pedido/título é limitado aos centros autorizados;
-- não depende de permissões financeiras gerais nem de filtros do navegador.
create or replace function public.agenda_leads_base_229(_centro uuid,_cliente uuid default null,_rota uuid default null)
returns setof jsonb language sql stable security definer set search_path=public as $$
select to_jsonb(fonte) from (
with agg as (
  select p.cliente_id,
         count(*) as pedidos,
         sum(p.total_liquido) as total_comprado,
         max(p.data_pedido) as ultima_compra
    from public.pedidos p
   where p.status not in ('cancelado','rascunho','digitacao','recusado','aguardando_aprovacao','aprovado') and public.usuario_pode_acessar_centro(p.centro_id) and (_centro is null or p.centro_id=_centro)
   group by p.cliente_id
), ultimo as (
  select distinct on (p.cliente_id) p.cliente_id, p.id as ultimo_pedido_id,
         p.numero as ultimo_pedido_numero, p.total_liquido as ultimo_pedido_valor
    from public.pedidos p
   where p.status not in ('cancelado','rascunho','digitacao','recusado','aguardando_aprovacao','aprovado') and public.usuario_pode_acessar_centro(p.centro_id) and (_centro is null or p.centro_id=_centro)
   order by p.cliente_id, p.data_pedido desc, p.created_at desc
), mes as (
  select p.cliente_id, count(*) as pedidos_mes, coalesce(sum(p.total_liquido),0) as valor_mes
    from public.pedidos p
   where p.status not in ('cancelado','rascunho','digitacao','recusado','aguardando_aprovacao','aprovado') and public.usuario_pode_acessar_centro(p.centro_id) and (_centro is null or p.centro_id=_centro)
     and p.data_pedido >= date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date
   group by p.cliente_id
), cfg as (select * from public.lead_score_config where id)
select
  c.id as cliente_id,
  c.codigo,
  c.razao_social,
  c.nome_fantasia,
  coalesce(c.telefone, ps.telefone) as telefone,
  ps.whatsapp,
  c.email,
  c.cidade,
  c.uf,
  concat_ws(', ', nullif(c.logradouro,''), nullif(c.numero,''), nullif(c.bairro,'')) as endereco,
  coalesce(nullif(ps.ent_logradouro,''), c.logradouro) as entrega_logradouro,
  c.status,
  c.centro_id,
  c.tabela_preco,
  c.condicao_pagamento,
  c.rota_id,
  r.nome as rota,
  r.sequencia as rota_sequencia,
  c.sequencia_entrega,
  c.representante_id,
  rep.nome as representante,
  coalesce(c.limite_credito,0) as limite_credito,
  coalesce(cred.em_aberto,0) as em_aberto,
  coalesce(cred.vencido,0) as vencido,
  coalesce(c.limite_credito,0) - coalesce(cred.em_aberto,0) as limite_disponivel,
  coalesce(a.pedidos,0) as pedidos,
  coalesce(a.total_comprado,0) as total_comprado,
  case when coalesce(a.pedidos,0) > 0
       then round(a.total_comprado / a.pedidos, 2) else 0 end as ticket_medio,
  a.ultima_compra,
  case when a.ultima_compra is null then 9999
       else ((now() at time zone 'America/Sao_Paulo')::date - a.ultima_compra) end as dias_sem_comprar,
  u.ultimo_pedido_id,
  u.ultimo_pedido_numero,
  coalesce(u.ultimo_pedido_valor,0) as ultima_compra_valor,
  coalesce(m.pedidos_mes,0) as pedidos_mes,
  coalesce(m.valor_mes,0) as valor_mes,
  coalesce(s.status,'nao_contatado') as funil_status,
  s.proximo_contato,
  s.updated_at as funil_atualizado_em,
  round(
    cfg.peso_dias * least(
      case when a.ultima_compra is null then cfg.dias_referencia
           else ((now() at time zone 'America/Sao_Paulo')::date - a.ultima_compra) end::numeric / greatest(coalesce(cfg.dias_referencia,1),1), 1)
    + cfg.peso_ticket * least(
      (case when coalesce(a.pedidos,0) > 0 then a.total_comprado / a.pedidos else 0 end)
      / greatest(coalesce(cfg.ticket_referencia,1),1), 1)
    + cfg.peso_total * least(coalesce(a.total_comprado,0) / greatest(coalesce(cfg.total_referencia,1),1), 1)
    + cfg.peso_limite * case when coalesce(c.limite_credito,0) > 0
        then greatest(least((coalesce(c.limite_credito,0) - coalesce(cred.em_aberto,0))
             / c.limite_credito, 1), 0) else 0 end
    + cfg.peso_frequencia * least(coalesce(a.pedidos,0)::numeric / greatest(coalesce(cfg.pedidos_referencia,1),1), 1)
  , 1) as score_oportunidade
from public.clientes c
cross join cfg
left join public.pessoas ps on ps.id = c.pessoa_id
left join public.rotas r on r.id = c.rota_id
left join public.representantes rep on rep.id = c.representante_id
left join lateral(
 select coalesce(sum(x.saldo),0) em_aberto,coalesce(sum(x.saldo) filter(where public.vencimento_util(x.vencimento)<(now() at time zone 'America/Sao_Paulo')::date),0) vencido
 from (select t.vencimento,greatest(coalesce(t.valor,0)+coalesce(t.juros,0)+coalesce(t.multa,0)+coalesce(t.acrescimo,0)-coalesce(t.desconto,0)-coalesce(t.valor_pago,0),0) saldo
 from public.contas_receber t where t.cliente_id=c.id and t.status in ('aberto','parcial')
 and public.usuario_pode_acessar_centro(t.centro_id) and (_centro is null or t.centro_id=_centro))x
) cred on true
left join agg a on a.cliente_id = c.id
left join ultimo u on u.cliente_id = c.id
left join mes m on m.cliente_id = c.id
left join public.lead_situacoes s on s.cliente_id = c.id
where public.agenda_cliente_acessivel_228(c.id)
 and (_cliente is null or c.id=_cliente) and (_rota is null or c.rota_id=_rota)
 and (_centro is null or _cliente is not null or c.centro_id is null or c.centro_id=_centro)
)fonte;
$$;
revoke all on function public.agenda_leads_base_229(uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.agenda_leads_229(_rota uuid,_centro uuid default null,_representante uuid default null,
 _cidade text default '',_busca text default '',_classificacao text default '',_funil text default '',_ordem text default 'oportunidade',_pagina integer default 1)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare resposta jsonb;
begin
 if not public.pode_rotina('lead_rota_operar') then raise exception 'Lead Rota não liberado para seu perfil'; end if;
 if _centro is not null and not public.usuario_pode_acessar_centro(_centro) then raise exception 'Centro sem acesso'; end if;
 if public.escopo_representante() and _representante is not null and _representante is distinct from public.meu_representante_id() then raise exception 'Representante fora da sua carteira'; end if;
 if _rota is null then raise exception 'Selecione uma rota'; end if;
 if _pagina is null or _pagina<1 or _pagina>100000 or length(coalesce(_busca,''))>120 then raise exception 'Filtros inválidos'; end if;
 with base as materialized (
  select x.data from public.agenda_leads_base_229(_centro,null,_rota)x(data)
  where (_representante is null or x.data->>'representante_id'=_representante::text)
   and (coalesce(_cidade,'')='' or x.data->>'cidade'=_cidade)
   and (coalesce(trim(_busca),'')='' or position(lower(trim(_busca)) in lower(concat_ws(' ',x.data->>'razao_social',x.data->>'nome_fantasia',x.data->>'codigo',x.data->>'telefone',x.data->>'cidade')))>0)
   and (coalesce(_funil,'')='' or x.data->>'funil_status'=_funil)
 ), filtrados as materialized (
  select data from base where coalesce(_classificacao,'')=''
   or (_classificacao='recente' and (data->>'dias_sem_comprar')::int<=15)
   or (_classificacao in ('15','30','45','60','90','120') and (data->>'dias_sem_comprar')::int>=case when _classificacao ~ '^[0-9]+$' then _classificacao::int else 0 end)
   or (_classificacao='inadimplente' and (data->>'vencido')::numeric>0)
   or (_classificacao='sem_mes' and (data->>'pedidos_mes')::int=0)
   or (_classificacao='potencial' and (data->>'score_oportunidade')::numeric>=50 and (data->>'limite_disponivel')::numeric>0)
 ), pagina as (
  select data from filtrados order by
   case when _ordem='nome' then data->>'razao_social' end,
   case when _ordem='ultima' then data->>'ultima_compra' end desc nulls last,
   case _ordem when 'dias' then (data->>'dias_sem_comprar')::numeric when 'valor_ultima' then (data->>'ultima_compra_valor')::numeric
    when 'ticket' then (data->>'ticket_medio')::numeric when 'limite' then (data->>'limite_disponivel')::numeric
    when 'nome' then 0 when 'ultima' then 0 else (data->>'score_oportunidade')::numeric end desc,
   data->>'razao_social',data->>'cliente_id' limit 24 offset (_pagina-1)*24
 )select jsonb_build_object('rows',coalesce((select jsonb_agg(data) from pagina),'[]'::jsonb),'count',(select count(*) from filtrados),
 'contadores',(select jsonb_build_object('total',count(*),'contatados',count(*) filter(where data->>'funil_status'<>'nao_contatado'),
 'naoContatados',count(*) filter(where data->>'funil_status'='nao_contatado'),'pedidos',count(*) filter(where data->>'funil_status'='pedido_realizado'),
 'negociacao',count(*) filter(where data->>'funil_status'='em_negociacao'),'semInteresse',count(*) filter(where data->>'funil_status'='sem_interesse'),
 'atencao90',count(*) filter(where (data->>'dias_sem_comprar')::int>=90),'atencao60',count(*) filter(where (data->>'dias_sem_comprar')::int between 60 and 89),
 'atencao30',count(*) filter(where (data->>'dias_sem_comprar')::int between 30 and 59)) from filtrados),
 'meta',(select jsonb_build_object('faturamento_mes',coalesce(sum((data->>'valor_mes')::numeric),0),'pedidos_mes',coalesce(sum((data->>'pedidos_mes')::int),0),
 'clientes_com_pedido',count(*) filter(where (data->>'pedidos_mes')::int>0)) from filtrados)) into resposta;
 return resposta;
end $$;
revoke all on function public.agenda_leads_229(uuid,uuid,uuid,text,text,text,text,text,integer) from public,anon;
grant execute on function public.agenda_leads_229(uuid,uuid,uuid,text,text,text,text,text,integer) to authenticated;

create or replace function public.agenda_lead_cliente_229(_cliente uuid,_centro uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare resultado jsonb;
begin
 if not public.pode_rotina('lead_rota_operar') or not public.agenda_cliente_acessivel_228(_cliente) then raise exception 'Cliente fora da carteira ou Lead Rota sem acesso'; end if;
 if _centro is not null and not public.usuario_pode_acessar_centro(_centro) then raise exception 'Centro sem acesso'; end if;
 select data into resultado from public.agenda_leads_base_229(_centro,_cliente,null)x(data);
 if resultado is null then raise exception 'Cliente não está no centro selecionado'; end if;
 return resultado;
end $$;
revoke all on function public.agenda_lead_cliente_229(uuid,uuid) from public,anon;
grant execute on function public.agenda_lead_cliente_229(uuid,uuid) to authenticated;

create or replace function public.agenda_lead_historico_229(_cliente uuid,_centro uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare resultado jsonb;
begin
 perform public.agenda_lead_cliente_229(_cliente,_centro);
 with pedidos as materialized(
  select p.*,rep.nome representante,(select count(*) from public.pedido_itens i where i.pedido_id=p.id) qtd_itens
  from public.pedidos p left join public.representantes rep on rep.id=p.representante_id
  where p.cliente_id=_cliente and public.usuario_pode_acessar_centro(p.centro_id) and (_centro is null or p.centro_id=_centro)
 ), ultimos as(select id pedido_id,numero,data_pedido,status,representante,total_liquido,qtd_itens from pedidos order by data_pedido desc,created_at desc,id limit 200),
 produtos as materialized(
  select i.produto_id,pr.codigo produto_codigo,pr.descricao produto,pr.preco_venda,pr.estoque_atual,
   count(distinct p.id) frequencia,sum(i.quantidade) quantidade_total,sum(i.total) valor_total,max(p.data_pedido) ultima_compra,
   (now() at time zone 'America/Sao_Paulo')::date-max(p.data_pedido) dias_ultima_compra,round(avg(i.preco_unitario),4) preco_medio
  from pedidos p join public.pedido_itens i on i.pedido_id=p.id join public.produtos pr on pr.id=i.produto_id
  where p.status not in ('cancelado','rascunho','digitacao','recusado','aguardando_aprovacao','aprovado')
  group by i.produto_id,pr.codigo,pr.descricao,pr.preco_venda,pr.estoque_atual
 ), frequentes as(select * from produtos order by frequencia desc,valor_total desc,produto_id limit 200)
 select jsonb_build_object('pedidos',coalesce((select jsonb_agg(to_jsonb(u)) from ultimos u),'[]'::jsonb),
 'produtos',coalesce((select jsonb_agg(to_jsonb(f)) from frequentes f),'[]'::jsonb),
 'count_pedidos',(select count(*) from pedidos),'count_produtos',(select count(*) from produtos)) into resultado;
 return resultado;
end $$;
revoke all on function public.agenda_lead_historico_229(uuid,uuid) from public,anon;
grant execute on function public.agenda_lead_historico_229(uuid,uuid) to authenticated;

-- Um contato aparece no funil e no acompanhamento, ligados por identificador único.
alter table public.acompanhamentos add column if not exists lead_contato_id uuid references public.lead_contatos(id) on delete restrict;
create unique index if not exists acompanhamento_lead_contato_229 on public.acompanhamentos(lead_contato_id) where lead_contato_id is not null;
insert into public.acompanhamentos(cliente_id,centro_id,tipo,responsavel,responsavel_nome,status,proxima_acao,resultado,observacao,created_at,concluido_em,lead_contato_id)
select l.cliente_id,l.centro_id,'comercial',l.responsavel,coalesce(p.nome,''),case when l.proximo_contato is null then 'concluido' else 'aberto' end,
 coalesce(l.proximo_contato,(l.created_at at time zone 'America/Sao_Paulo')::date),l.resultado,l.observacao,l.created_at,
 case when l.proximo_contato is null then l.created_at end,l.id from public.lead_contatos l left join public.profiles p on p.id=l.responsavel
where l.responsavel is not null and not exists(select 1 from public.acompanhamentos a where a.lead_contato_id=l.id)
on conflict do nothing;
-- Preserva o corpo endurecido da fase228; o helper legado não fica exposto.
do $$ begin
 if to_regprocedure('public.registrar_acompanhamento_base_229(uuid,uuid,text,date,text,text,date,numeric)') is null then
  alter function public.registrar_acompanhamento(uuid,uuid,text,date,text,text,date,numeric) rename to registrar_acompanhamento_base_229;
 end if;
end $$;
revoke all on function public.registrar_acompanhamento_base_229(uuid,uuid,text,date,text,text,date,numeric) from public,anon,authenticated;

create or replace function public.agenda_gravar_contato_base_229(_cliente uuid,_centro uuid,_resultado text,_observacao text,_proximo date,_rota uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare atividade uuid; contato uuid; c public.clientes;
begin
 if not public.agenda_acao_permitida_228('comercial') or not public.agenda_cliente_acessivel_228(_cliente) then raise exception 'Cliente sem acesso para contato'; end if;
 select * into c from public.clientes where id=_cliente for share;
 if _rota is not null and _rota is distinct from c.rota_id then raise exception 'Rota difere do cadastro do cliente'; end if;
 atividade:=public.registrar_acompanhamento_base_229(_cliente,_centro,'comercial',coalesce(_proximo,(now() at time zone 'America/Sao_Paulo')::date),_resultado,_observacao,null,null);
 insert into public.lead_contatos(cliente_id,rota_id,representante_id,centro_id,resultado,observacao,proximo_contato,responsavel)
 values(c.id,coalesce(_rota,c.rota_id),c.representante_id,_centro,_resultado,nullif(trim(_observacao),''),_proximo,auth.uid()) returning id into contato;
 update public.acompanhamentos set lead_contato_id=contato where id=atividade;
 if _proximo is null then perform public.concluir_acompanhamento(atividade); end if;
 return atividade;
end $$;
revoke all on function public.agenda_gravar_contato_base_229(uuid,uuid,text,text,date,uuid) from public,anon,authenticated;

create or replace function public.registrar_acompanhamento(_cliente_id uuid,_centro_id uuid,_tipo text,_proxima_acao date,_resultado text,_observacao text default null,_promessa_data date default null,_promessa_valor numeric default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare atividade uuid; codigo text; contato uuid; c public.clientes;
begin
 -- Mantém resultado livre e validações existentes. A cobrança nunca altera funil comercial.
 atividade:=public.registrar_acompanhamento_base_229(_cliente_id,_centro_id,_tipo,_proxima_acao,_resultado,_observacao,_promessa_data,_promessa_valor);
 if _tipo='comercial' then
  codigo:=case when _resultado in ('contato_realizado','nao_atendeu','pediu_retorno','fez_pedido','sem_interesse','cliente_fechado','nao_localizado','outro') then _resultado else 'contato_realizado' end;
  select * into c from public.clientes where id=_cliente_id for share;
  insert into public.lead_contatos(cliente_id,rota_id,representante_id,centro_id,resultado,observacao,proximo_contato,responsavel)
   values(c.id,c.rota_id,c.representante_id,_centro_id,codigo,_observacao,_proxima_acao,auth.uid()) returning id into contato;
  update public.acompanhamentos set lead_contato_id=contato where id=atividade;
 end if;
 return atividade;
end $$;
revoke all on function public.registrar_acompanhamento(uuid,uuid,text,date,text,text,date,numeric) from public,anon;
grant execute on function public.registrar_acompanhamento(uuid,uuid,text,date,text,text,date,numeric) to authenticated;

create or replace function public.agenda_registrar_contato_229(_cliente uuid,_rota uuid,_resultado text,_observacao text default null,_proximo date default null,_centro uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
begin
 if not public.pode_rotina('lead_rota_operar') or _resultado is null or _resultado not in ('contato_realizado','nao_atendeu','pediu_retorno','fez_pedido','sem_interesse','cliente_fechado','nao_localizado','outro') then raise exception 'Contato inválido ou Lead Rota sem acesso'; end if;
 return public.agenda_gravar_contato_base_229(_cliente,_centro,_resultado,_observacao,_proximo,_rota);
end $$;
revoke all on function public.agenda_registrar_contato_229(uuid,uuid,text,text,date,uuid) from public,anon;
grant execute on function public.agenda_registrar_contato_229(uuid,uuid,text,text,date,uuid) to authenticated;
-- Fecha gravação direta que permitiria ignorar o acompanhamento unificado.
revoke insert,update,delete on public.lead_contatos,public.lead_situacoes from authenticated,anon;
alter table public.lead_contatos enable row level security;
alter table public.lead_situacoes enable row level security;
do $$ declare t text; regra text; begin
 foreach t in array array['lead_contatos','lead_situacoes'] loop
  execute format('drop policy if exists agenda_lead_229 on public.%I',t);
  regra:=case when t='lead_contatos' then ' and (centro_id is null or public.usuario_pode_acessar_centro(centro_id))' else '' end;
  execute format('create policy agenda_lead_229 on public.%I as restrictive for select to authenticated using(public.pode_rotina(''lead_rota_operar'') and public.agenda_cliente_acessivel_228(cliente_id)%s)',t,regra);
 end loop;
end $$;

-- Pedido novo/repetido usa os motores atuais, sem liberar DML de pedidos ao navegador.
create or replace function public.lead_criar_pedido(_cliente_id uuid,_modo text default 'vazio',_rota_id uuid default null,_centro_id uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare c public.clientes; ped public.pedidos; centro uuid; forma uuid; rota uuid; item record; ultimo uuid;
begin
 if not public.pode_rotina('lead_rota_operar') or not public.agenda_cliente_acessivel_228(_cliente_id) or not public.can_operate(auth.uid()) then raise exception 'Cliente sem acesso para pedido'; end if;
 if not public.can_manage(auth.uid()) and not exists(select 1 from public.user_roles u join public.role_menus m on m.role::text=u.role::text where u.user_id=auth.uid() and m.path='/pedidos') then raise exception 'Menu Pedidos não liberado'; end if;
 if _modo is null or _modo not in ('vazio','ultimo','frequentes') then raise exception 'Modo de pedido inválido'; end if;
 select * into c from public.clientes where id=_cliente_id for share;
 centro:=coalesce(_centro_id,c.centro_id); rota:=coalesce(_rota_id,c.rota_id);
 if centro is null or not public.usuario_pode_acessar_centro(centro) then raise exception 'Selecione um centro autorizado para o pedido'; end if;
 if (select count(*) from public.formas_pagamento where ativo and lower(trim(nome))=lower(trim(c.condicao_pagamento)))>1 then raise exception 'Condição de pagamento ambígua; confira o cadastro antes de criar o pedido'; end if;
 select id into forma from public.formas_pagamento where ativo and lower(trim(nome))=lower(trim(c.condicao_pagamento));
 if forma is null then raise exception 'Defina no cliente uma condição de pagamento válida antes de criar o pedido pela agenda'; end if;
 ped:=public.criar_pedido_rascunho(c.id,centro,rota,forma,(now() at time zone 'America/Sao_Paulo')::date,null,c.representante_id,null);
 if _modo='ultimo' then
  select p.id into ultimo from public.pedidos p where p.cliente_id=c.id and p.id<>ped.id and p.status not in ('cancelado','rascunho','digitacao','recusado','aguardando_aprovacao','aprovado')
   and public.usuario_pode_acessar_centro(p.centro_id) order by p.data_pedido desc,p.created_at desc,p.id limit 1;
  for item in select i.produto_id,i.quantidade from public.pedido_itens i where i.pedido_id=ultimo order by i.id loop
   perform public.adicionar_item_pedido(ped.id,item.produto_id,item.quantidade,public.preco_produto(item.produto_id,c.id),0);
  end loop;
 elsif _modo='frequentes' then
  for item in select i.produto_id,greatest(round(sum(i.quantidade)/count(distinct p.id),0),1) quantidade
   from public.pedido_itens i join public.pedidos p on p.id=i.pedido_id where p.cliente_id=c.id
    and p.status not in ('cancelado','rascunho','digitacao','recusado','aguardando_aprovacao','aprovado') and public.usuario_pode_acessar_centro(p.centro_id)
   group by i.produto_id order by count(distinct p.id) desc,sum(i.quantidade) desc,i.produto_id limit 10 loop
   perform public.adicionar_item_pedido(ped.id,item.produto_id,item.quantidade,public.preco_produto(item.produto_id,c.id),0);
  end loop;
 end if;
 return ped.id;
end $$;
revoke all on function public.lead_criar_pedido(uuid,text,uuid,uuid) from public,anon;
grant execute on function public.lead_criar_pedido(uuid,text,uuid,uuid) to authenticated;
create or replace function public.admin_salvar_acesso(_role text,_menus text[],_permissoes text[])
returns void language plpgsql security definer set search_path=public as $$
declare antes jsonb; tipo_role text;
begin
 if not public.usuario_ativo() or not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador ativo pode alterar acessos'; end if;
 if _role in ('admin','gestor') or not exists(select 1 from public.papeis where codigo=_role) then raise exception 'Perfil inválido ou de acesso total'; end if;
 _menus:=case when _menus is null then null else array(select distinct case when m in ('/cobranca','/clientes-inativos','/lead-rota') then '/agenda-comercial' else m end from unnest(_menus) m) end;
 if _menus is null or _permissoes is null or cardinality(_menus)>100 or cardinality(_permissoes)>200 then raise exception 'Listas de acesso inválidas'; end if;
 if exists(select 1 from unnest(_menus) p where p is null or p<>all(array['/dashboard','/pendencias','/pessoas','/produtos','/tabelas-preco','/centros','/rotas','/formas-pagamento','/cadastros-padrao','/descontos-peso','/pedidos','/representantes','/lead-rota','/agenda-comercial','/metas','/comissoes','/separacao','/compras','/planejamento-compras','/estoque','/notas','/cargas','/expedicao','/devolucoes','/financeiro','/fluxo-caixa','/contas','/categorias-financeiras','/movimentacoes','/dre','/relatorios-financeiros','/rota-despesas','/receber','/cobranca','/boletos','/conciliacao-creditos','/pagar','/relatorios','/relatorio-vendas','/clientes-inativos','/notificacoes','/usuarios','/auditoria','/configuracoes'])) then raise exception 'Menu desconhecido'; end if;
 if exists(select 1 from unnest(_permissoes) p where p is null or not exists(select 1 from public.permissoes c where c.codigo=p)) then raise exception 'Permissão desconhecida'; end if;
 perform pg_advisory_xact_lock(hashtextextended('acesso_perfil:'||_role,0));
 select jsonb_build_object('menus',coalesce((select jsonb_agg(path order by path) from public.role_menus where role::text=_role),'[]'::jsonb),'permissoes',coalesce((select jsonb_agg(permissao order by permissao) from public.role_permissoes where role=_role),'[]'::jsonb)) into antes;
 delete from public.role_menus where role::text=_role;
 select format_type(a.atttypid,a.atttypmod) into tipo_role from pg_attribute a where a.attrelid='public.role_menus'::regclass and a.attname='role';
 execute format('insert into public.role_menus(role,path) select $1::%s,path from (select distinct unnest($2::text[]) as path) x',tipo_role) using _role,_menus;
 delete from public.role_permissoes where role=_role;
 insert into public.role_permissoes(role,permissao) select _role,p from (select distinct unnest(_permissoes) p) x;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe)
 values('role_menus',null,'salvar_acesso',auth.uid(),jsonb_build_object('role',_role,'antes',antes,'depois',jsonb_build_object('menus',to_jsonb(_menus),'permissoes',to_jsonb(_permissoes))));
end $$;
revoke all on function public.admin_salvar_acesso(text,text[],text[]) from public,anon;
grant execute on function public.admin_salvar_acesso(text,text[],text[]) to authenticated;
notify pgrst,'reload schema';
commit;
