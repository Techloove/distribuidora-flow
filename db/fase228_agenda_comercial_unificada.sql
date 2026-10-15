-- Fase228: Agenda Comercial reúne relacionamento, reativação e cobrança.
-- Permissões por ação e carteira são verificadas no servidor; não libera baixas financeiras.
begin;
insert into public.permissoes(codigo,nome,grupo,ordem,modulo)
values('clientes_reativar','Consultar e acompanhar clientes sem comprar','Agenda comercial',131,'/agenda-comercial')
on conflict(codigo) do update set nome=excluded.nome,grupo=excluded.grupo,modulo=excluded.modulo;
update public.permissoes set modulo='/agenda-comercial',grupo='Agenda comercial'
where codigo in ('comercial_acompanhar','cobranca_acompanhar');
do $$ begin
 if not exists(select 1 from public.auditoria where tabela='fase228' and acao='instalada') then
  -- Converte acessos antigos sem tornar a cobrança obrigatória a todos os perfis.
  insert into public.role_permissoes(role,permissao)
   select role::text,'clientes_reativar' from public.role_menus where path='/clientes-inativos' on conflict do nothing;
  insert into public.role_menus(role,path)
   select distinct role,'/agenda-comercial' from public.role_menus
   where path in ('/cobranca','/clientes-inativos') on conflict do nothing;
  insert into public.role_permissoes(role,permissao)
   select codigo,a from public.papeis cross join unnest(array['cobranca_acompanhar','clientes_reativar']) a
   where codigo='representante' on conflict do nothing;
  insert into public.role_menus(role,path)
   select role,'/agenda-comercial' from public.role_menus where role::text='representante' on conflict do nothing;
  delete from public.role_menus where path in ('/cobranca','/clientes-inativos');
  insert into public.auditoria(tabela,acao,detalhe)
   values('fase228','instalada','{"modulo":"/agenda-comercial","carteira_obrigatoria":true}');
 end if;
end $$;

-- Este booleano não revela dados de outra carteira e também protege ações com IDs forjados.
create or replace function public.agenda_cliente_acessivel_228(_cliente uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select public.usuario_ativo() and exists(select 1 from public.clientes c where c.id=_cliente
  and (c.centro_id is null or public.usuario_pode_acessar_centro(c.centro_id))
  and (not public.escopo_representante() or public.cliente_na_minha_carteira(c.id)));
$$;
revoke all on function public.agenda_cliente_acessivel_228(uuid) from public,anon;
grant execute on function public.agenda_cliente_acessivel_228(uuid) to authenticated;
create or replace function public.agenda_acao_permitida_228(_tipo text)
returns boolean language sql stable security definer set search_path=public as $$
 select public.usuario_ativo() and case _tipo
  when 'cobranca' then public.pode_rotina('cobranca_acompanhar')
  when 'comercial' then public.pode_rotina('comercial_acompanhar') or public.pode_rotina('clientes_reativar')
  else false end;
$$;
revoke all on function public.agenda_acao_permitida_228(text) from public,anon;
grant execute on function public.agenda_acao_permitida_228(text) to authenticated;

create or replace function public.agenda_clientes_228(_aba text,_centro uuid default null,_representante uuid default null,
 _rota uuid default null,_busca text default '',_dias integer default 60,_pagina integer default 0,_cidade text default '')
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare resposta jsonb; hoje date:=(now() at time zone 'America/Sao_Paulo')::date; pode_cobrar boolean;
begin
 if _aba is null or _aba not in ('comercial','reativacao','cobranca') or not public.usuario_ativo() or
  not public.pode_rotina(case _aba when 'reativacao' then 'clientes_reativar' when 'cobranca' then 'cobranca_acompanhar' else 'comercial_acompanhar' end) then
  raise exception 'Agenda não liberada para seu perfil';
 end if;
 if _pagina is null or _pagina<0 or _pagina>100000 or _dias is null or _dias<0 or _dias>9999 or length(coalesce(_busca,''))>120 then raise exception 'Filtros inválidos'; end if;
 if _centro is not null and not public.usuario_pode_acessar_centro(_centro) then raise exception 'Centro sem acesso'; end if;
 if public.escopo_representante() and _representante is not null and _representante is distinct from public.meu_representante_id() then raise exception 'Filtro de representante fora da sua carteira'; end if;
 pode_cobrar:=public.pode_rotina('cobranca_acompanhar');
 with base as materialized (
  select c.id cliente_id,c.codigo,c.razao_social,c.centro_id,c.representante_id,c.rota_id,c.cidade,c.uf,c.telefone,
   rep.nome representante,ro.nome rota,v.ultima_compra,coalesce(hoje-v.ultima_compra,9999) dias_sem_comprar,
   coalesce(v.ticket_medio,0) ticket_medio,coalesce(v.vendas_30,0) vendas_30,coalesce(v.vendas_anteriores_30,0) vendas_anteriores_30,
   coalesce(f.aberto,0) aberto,coalesce(f.vencido,0) vencido
  from public.clientes c left join public.representantes rep on rep.id=c.representante_id
  left join public.rotas ro on ro.id=c.rota_id
  left join lateral(
   select max(p.data_pedido) ultima_compra,round(avg(p.total_liquido),2) ticket_medio,
    sum(p.total_liquido) filter(where p.data_pedido>=hoje-30) vendas_30,
    sum(p.total_liquido) filter(where p.data_pedido>=hoje-60 and p.data_pedido<hoje-30) vendas_anteriores_30
   from public.pedidos p where p.cliente_id=c.id and p.status in ('confirmado','faturado','entregue','parcial','devolvido')
    and public.usuario_pode_acessar_centro(p.centro_id) and (_centro is null or p.centro_id=_centro)
  )v on true
  left join lateral(
   select sum(s.saldo) aberto,sum(s.saldo) filter(where public.vencimento_util(s.vencimento)<hoje) vencido
   from (select t.vencimento,greatest(coalesce(t.valor,0)+coalesce(t.juros,0)+coalesce(t.multa,0)+coalesce(t.acrescimo,0)-coalesce(t.desconto,0)-coalesce(t.valor_pago,0),0) saldo
    from public.contas_receber t where pode_cobrar and t.cliente_id=c.id and t.status in ('aberto','parcial')
     and public.usuario_pode_acessar_centro(t.centro_id) and (_centro is null or t.centro_id=_centro))s
  )f on true
  where public.agenda_cliente_acessivel_228(c.id)
   and (c.status='ativo' or _aba='cobranca')
   and (_centro is null or _aba='cobranca' or c.centro_id is null or c.centro_id=_centro)
   and (_representante is null or c.representante_id=_representante)
   and (_rota is null or c.rota_id=_rota)
   and (coalesce(_cidade,'')='' or c.cidade=_cidade)
   and (coalesce(trim(_busca),'')='' or position(lower(trim(_busca)) in lower(c.razao_social||' '||coalesce(c.codigo,'')))>0)
 ), filtrados as materialized (
  select * from base where (_aba<>'reativacao' or dias_sem_comprar>=_dias) and (_aba<>'cobranca' or aberto>0)
 ), pagina as (
  select * from filtrados order by case when _aba='cobranca' then vencido else 0 end desc,
   case when _aba<>'cobranca' then dias_sem_comprar else 0 end desc,razao_social,cliente_id
  limit 50 offset _pagina*50
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from pagina p),'[]'::jsonb),
 'count',(select count(*) from filtrados),
 'resumo',(select jsonb_build_object('clientes',count(*),'aberto',coalesce(sum(aberto),0),'vencido',coalesce(sum(vencido),0),
  'sem_comprar',count(*) filter(where dias_sem_comprar>=_dias),'potencial',coalesce(sum(ticket_medio),0)) from filtrados)) into resposta;
 return resposta;
end $$;
revoke all on function public.agenda_clientes_228(text,uuid,uuid,uuid,text,integer,integer,text) from public,anon;
grant execute on function public.agenda_clientes_228(text,uuid,uuid,uuid,text,integer,integer,text) to authenticated;

create or replace function public.agenda_filtros_228()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare resultado jsonb;
begin
 if not (public.agenda_acao_permitida_228('comercial') or public.agenda_acao_permitida_228('cobranca')) then raise exception 'Sem acesso à agenda'; end if;
 with clientes as materialized(select * from public.clientes c where public.agenda_cliente_acessivel_228(c.id))
 select jsonb_build_object(
 'representantes',coalesce((select jsonb_agg(x order by x.nome,x.id) from(select distinct r.id,r.nome from public.representantes r join clientes c on c.representante_id=r.id)x),'[]'::jsonb),
 'rotas',coalesce((select jsonb_agg(x order by x.nome,x.id) from(select distinct r.id,r.nome from public.rotas r join clientes c on c.rota_id=r.id)x),'[]'::jsonb),
 'cidades',coalesce((select jsonb_agg(x.cidade order by x.cidade) from(select distinct cidade from clientes where nullif(trim(cidade),'') is not null)x),'[]'::jsonb)) into resultado;
 return resultado;
end $$;
revoke all on function public.agenda_filtros_228() from public,anon;
grant execute on function public.agenda_filtros_228() to authenticated;

create or replace function public.agenda_titulos_228(_cliente uuid,_centro uuid default null,_pagina integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare resultado jsonb;
begin
 if not public.agenda_acao_permitida_228('cobranca') or not public.agenda_cliente_acessivel_228(_cliente) then raise exception 'Cliente sem acesso para cobrança'; end if;
 if _centro is not null and not public.usuario_pode_acessar_centro(_centro) then raise exception 'Centro sem acesso'; end if;
 if _pagina is null or _pagina<0 or _pagina>100000 then raise exception 'Página inválida'; end if;
 with titulos as materialized(
  select t.id,t.documento,t.parcela,t.vencimento,t.status,t.valor,t.valor_pago,
   greatest(coalesce(t.valor,0)+coalesce(t.juros,0)+coalesce(t.multa,0)+coalesce(t.acrescimo,0)-coalesce(t.desconto,0)-coalesce(t.valor_pago,0),0) saldo
  from public.contas_receber t where t.cliente_id=_cliente and t.status in ('aberto','parcial')
   and public.usuario_pode_acessar_centro(t.centro_id) and (_centro is null or t.centro_id=_centro)
 ), pagina as(select * from titulos order by vencimento,id limit 50 offset _pagina*50)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from pagina p),'[]'::jsonb),'count',(select count(*) from titulos)) into resultado;
 return resultado;
end $$;
revoke all on function public.agenda_titulos_228(uuid,uuid,integer) from public,anon;
grant execute on function public.agenda_titulos_228(uuid,uuid,integer) to authenticated;

-- Histórico continua protegido por RLS; nenhum grant de contas a receber é ampliado.
alter table public.acompanhamentos enable row level security;
drop policy if exists acompanhamentos_leitura_209 on public.acompanhamentos;
create policy acompanhamentos_leitura_209 on public.acompanhamentos for select to authenticated using(
 public.agenda_cliente_acessivel_228(cliente_id) and (centro_id is null or public.usuario_pode_acessar_centro(centro_id))
 and public.agenda_acao_permitida_228(tipo));
drop policy if exists acompanhamento_acesso_211 on public.acompanhamentos;
create policy acompanhamento_acesso_211 on public.acompanhamentos as restrictive for select to authenticated
 using(public.agenda_cliente_acessivel_228(cliente_id) and (centro_id is null or public.usuario_pode_acessar_centro(centro_id)) and public.agenda_acao_permitida_228(tipo));
create or replace function public.registrar_acompanhamento(_cliente_id uuid,_centro_id uuid,_tipo text,_proxima_acao date,_resultado text,_observacao text default null,_promessa_data date default null,_promessa_valor numeric default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 if not public.agenda_acao_permitida_228(_tipo) then raise exception 'Ação não liberada para seu perfil'; end if;
 perform 1 from public.clientes where id=_cliente_id for share;
 if not public.agenda_cliente_acessivel_228(_cliente_id) then raise exception 'Cliente fora da sua carteira ou sem acesso'; end if;
 if _centro_id is not null and not public.usuario_pode_acessar_centro(_centro_id) then raise exception 'Centro sem acesso'; end if;
 if not exists(select 1 from public.clientes c where c.id=_cliente_id and (c.centro_id is null or public.usuario_pode_acessar_centro(c.centro_id))) or
 (public.escopo_representante() and not public.cliente_na_minha_carteira(_cliente_id)) then raise exception 'Cliente sem acesso'; end if;
 if _proxima_acao is null or nullif(trim(_resultado),'') is null or length(_resultado)>100 or length(coalesce(_observacao,''))>4000 then raise exception 'Informe data, resultado e observação de até 4000 caracteres'; end if;
 if _promessa_valor is not null and (_tipo<>'cobranca' or _promessa_valor<=0 or _promessa_data is null or _promessa_valor::text in ('NaN','Infinity','-Infinity')) then raise exception 'Promessa de pagamento inválida'; end if;
 insert into public.acompanhamentos(cliente_id,centro_id,tipo,proxima_acao,resultado,observacao,promessa_data,promessa_valor,responsavel_nome)
 values(_cliente_id,_centro_id,_tipo,_proxima_acao,trim(_resultado),nullif(trim(_observacao),''),_promessa_data,_promessa_valor,coalesce((select nome from public.profiles where id=auth.uid()),'')) returning id into v_id;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('acompanhamentos',v_id,'registrar',auth.uid(),jsonb_build_object('cliente',_cliente_id,'tipo',_tipo));
 return v_id;
exception when unique_violation then raise exception 'Este cliente já tem cobrança aberta. Consulte o responsável e o histórico antes de abrir outra.';
end $$;
create or replace function public.concluir_acompanhamento(_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare a public.acompanhamentos;
begin
 select * into a from public.acompanhamentos where id=_id for update;
 perform 1 from public.clientes where id=a.cliente_id for share;
 if not public.agenda_cliente_acessivel_228(a.cliente_id) or not public.agenda_acao_permitida_228(a.tipo) or not public.usuario_ativo() or a.id is null or (a.responsavel<>auth.uid() and not public.can_manage(auth.uid())) or
 (a.centro_id is not null and not public.usuario_pode_acessar_centro(a.centro_id)) or
 (public.escopo_representante() and not public.cliente_na_minha_carteira(a.cliente_id)) then raise exception 'Acompanhamento sem acesso ou de outro responsável'; end if;

 if a.status='concluido' then return; end if;
 update public.acompanhamentos set status='concluido',concluido_em=now() where id=_id;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('acompanhamentos',a.id,'concluir',auth.uid(),jsonb_build_object('cliente',a.cliente_id,'tipo',a.tipo));
end $$;
revoke all on function public.registrar_acompanhamento(uuid,uuid,text,date,text,text,date,numeric),public.concluir_acompanhamento(uuid) from public,anon;
grant execute on function public.registrar_acompanhamento(uuid,uuid,text,date,text,text,date,numeric),public.concluir_acompanhamento(uuid) to authenticated;
-- Perfil salvo pelo editor novo só oferece o menu unificado; o catálogo mantém
-- as ações separadas (comercial, reativação e cobrança) para restrições individuais.
create or replace function public.admin_salvar_acesso(_role text,_menus text[],_permissoes text[])
returns void language plpgsql security definer set search_path=public as $$
declare antes jsonb; tipo_role text;
begin
 if not public.usuario_ativo() or not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador ativo pode alterar acessos'; end if;
 if _role in ('admin','gestor') or not exists(select 1 from public.papeis where codigo=_role) then raise exception 'Perfil inválido ou de acesso total'; end if;
 _menus:=case when _menus is null then null else array(select distinct case when m in ('/cobranca','/clientes-inativos') then '/agenda-comercial' else m end from unnest(_menus) m) end;
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
