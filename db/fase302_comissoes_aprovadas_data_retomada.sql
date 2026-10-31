-- Comissão só entra em apuração depois da aprovação. Estimativas comerciais
-- do rascunho não geram liberação nem pagamento de comissão.
begin;
create or replace function public.status_comissao_valido_302(_tipo text,_status text) returns boolean
language sql immutable security invoker set search_path=public as $$
 select coalesce(_tipo='pedido' and _status in('aprovado','confirmado','separacao','separado','conferido','faturado','nf_emitida','em_carga','em_rota','entregue','parcial','nao_entregue','devolvido'),false);
$$;
revoke all on function public.status_comissao_valido_302(text,text) from public,anon;
grant execute on function public.status_comissao_valido_302(text,text) to authenticated;
create or replace view public.pedidos_comissao_302 with(security_invoker=true) as
 select p.* from public.pedidos p where public.status_comissao_valido_302(p.tipo_documento,p.status);
revoke all on public.pedidos_comissao_302 from public,anon;grant select on public.pedidos_comissao_302 to authenticated;
create or replace view public.pedidos_comissao_mod_302 with(security_invoker=true) as
 select p.* from public.pedidos_comissao_302 p where (select public.modalidade_filtro_300())='todos' or p.modalidade_venda=(select public.modalidade_filtro_300());
revoke all on public.pedidos_comissao_mod_302 from public,anon;grant select on public.pedidos_comissao_mod_302 to authenticated;
create or replace view public.comissoes_validas_302 with(security_invoker=true) as
 select cm.* from public.comissoes cm where exists(select 1 from public.pedidos p where p.id=cm.pedido_id and (public.status_comissao_valido_302(p.tipo_documento,p.status) or (p.tipo_documento='pedido' and p.status in('cancelado','recusado') and cm.status='cancelada')));
revoke all on public.comissoes_validas_302 from public,anon;grant select on public.comissoes_validas_302 to authenticated;
-- Registros legados ficam preservados. As visões e os motores de pagamento os
-- excluem até que o pedido seja aprovado; nenhuma comissão paga é apagada.
do $$declare d text;begin
 select pg_get_functiondef('public.apurar_comissao_pedido(uuid)'::regprocedure) into d;
 if position('elegibilidade_302' in d)=0 then
  if position('select * into c from public.comissoes where pedido_id=p.id for update;' in d)=0 then raise exception 'Apuração incompatível com a fase302';end if;
  d:=replace(d,'select * into c from public.comissoes where pedido_id=p.id for update;', E'-- elegibilidade_302\n if not public.status_comissao_valido_302(p.tipo_documento,p.status) and p.status not in(''cancelado'',''recusado'') then return;end if;\n select * into c from public.comissoes where pedido_id=p.id for update;');execute d;
 end if;
end $$;
create or replace function public.proteger_comissao_elegivel_302() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if new.status in('prevista','liberada','paga') and not exists(select 1 from public.pedidos p where p.id=new.pedido_id and public.status_comissao_valido_302(p.tipo_documento,p.status)) then raise exception 'Comissão exige pedido aprovado. Digitação, orçamento e análise ficam fora da apuração';end if;
 return new;
end $$;
revoke all on function public.proteger_comissao_elegivel_302() from public,anon,authenticated,service_role;
drop trigger if exists aa_comissao_elegivel_302 on public.comissoes;
create trigger aa_comissao_elegivel_302 before insert or update on public.comissoes for each row execute function public.proteger_comissao_elegivel_302();
-- Protege também os caminhos de agendamento proporcional e lotes.
do $$declare d text;n text;a text;begin
 foreach n in array array['liberar_comissoes','pagar_comissoes','agendar_comissao_217'] loop
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=n;
  if position('comissao_exige_aprovado_302' in d)=0 then
   if n='liberar_comissoes' then a:='_ids';elsif n='pagar_comissoes' then a:='_comissao_ids';else a:='array[_comissao]';end if;
   -- Depois de BEGIN, o guard usa as mesmas permissões do financeiro e não grava.
   d:=regexp_replace(d,'\mBEGIN\M', 'BEGIN /* comissao_exige_aprovado_302 */ if not public.usuario_ativo() or not public.can_finance(auth.uid()) then raise exception ''Sem acesso às comissões'';end if; if exists(select 1 from public.comissoes cm302 left join public.pedidos ped302 on ped302.id=cm302.pedido_id where cm302.id=any('||a||') and (not public.status_comissao_valido_302(ped302.tipo_documento,ped302.status) or not public.usuario_pode_acessar_centro(ped302.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira(''pedidos'',ped302.id)))) then raise exception ''Selecione somente comissões de pedidos aprovados e da sua carteira/loja'';end if;', 'i');execute d;
  end if;
 end loop;
end $$;
-- Atualiza todas as apurações, incluindo a versão com filtro de modalidade.
do $$declare n text;d text;r record;mapa jsonb:='{"comissoes":"comissoes_validas_302"}';mm jsonb:='{"comissoes_validas_302":"comissoes_mod_300","pedidos":"pedidos_mod_300","pedidos_comissao_302":"pedidos_comissao_mod_302","vw_comissoes_detalhe":"vw_comissoes_detalhe_mod_300","vw_comissoes_resumo":"vw_comissoes_resumo_mod_300","vw_comissoes_representante":"vw_comissoes_representante_mod_300","vw_comissao_proporcional_217":"vw_comissao_proporcional_217_mod_300","vw_metas_acompanhamento":"vw_metas_acompanhamento_mod_300"}';begin
 foreach n in array array['vw_comissoes_detalhe','vw_comissoes_representante','vw_comissao_proporcional_217'] loop
  select pg_get_viewdef(('public.'||n)::regclass,true) into d;
  d:=public.reescrever_leitura_300(d,mapa);execute format('create or replace view public.%I with(security_invoker=true) as %s',n,d);
 end loop;
 select pg_get_viewdef('public.vw_comissoes_resumo'::regclass,true) into d;
 d:=public.reescrever_leitura_300(d,'{"pedidos":"pedidos_comissao_302"}');execute 'create or replace view public.vw_comissoes_resumo with(security_invoker=true) as '||d;
 select pg_get_viewdef('public.comissoes_mod_300'::regclass,true) into d;
 d:=public.reescrever_leitura_300(d,mapa);execute 'create or replace view public.comissoes_mod_300 with(security_invoker=true,security_barrier=false) as '||d;
 foreach n in array array['vw_comissoes_detalhe','vw_comissoes_resumo','vw_comissoes_representante','vw_comissao_proporcional_217'] loop
  select pg_get_viewdef(('public.'||n)::regclass,true) into d;
  d:=public.reescrever_leitura_300(d,mm);execute format('create or replace view public.%I with(security_invoker=true,security_barrier=false) as %s',n||'_mod_300',d);
 end loop;
 foreach n in array array['dashboard_resumo','resumo_comissoes_loja_295'] loop
  select p.oid,p.prosrc,pg_get_functiondef(p.oid) def into r from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=n;
  d:=public.reescrever_leitura_300(r.prosrc,case when n='resumo_comissoes_loja_295' then mapa||'{"pedidos":"pedidos_comissao_302"}'::jsonb else mapa end);
  execute replace(r.def,r.prosrc,d);
  if n='resumo_comissoes_loja_295' then
   select p.prosrc,pg_get_functiondef(p.oid) def into r from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=n||'_mod_300';
   d:=public.reescrever_leitura_300(r.prosrc,'{"pedidos_mod_300":"pedidos_comissao_mod_302"}');execute replace(r.def,r.prosrc,d);
  end if;
 end loop;
end $$;
-- Retomada: só a data comercial do rascunho pode mudar, por escolha explícita.
create table if not exists public.pedido_data_contexto_302(pedido_id uuid primary key references public.pedidos(id),usuario_id uuid not null references public.profiles(id),transacao bigint not null);
alter table public.pedido_data_contexto_302 enable row level security;
revoke all on public.pedido_data_contexto_302 from public,anon,authenticated;
grant all on public.pedido_data_contexto_302 to service_role;
create or replace function public.contexto_data_retomada_302(_pedido uuid) returns boolean
language sql stable security definer set search_path=public as $$select exists(select 1 from public.pedido_data_contexto_302 where pedido_id=_pedido and usuario_id=auth.uid() and transacao=txid_current())$$;
revoke all on function public.contexto_data_retomada_302(uuid) from public,anon,authenticated,service_role;
do $$declare d text;begin
 select pg_get_functiondef('public.modalidade_pedido_296()'::regprocedure) into d;
 if position('contexto_data_retomada_302' in d)=0 then
  if position('coalesce(new.orcamento_data,new.data_pedido) is distinct from coalesce(old.orcamento_data,old.data_pedido)' in d)=0 then raise exception 'Proteção de data incompatível com a fase302';end if;
  d:=replace(d,'coalesce(new.orcamento_data,new.data_pedido) is distinct from coalesce(old.orcamento_data,old.data_pedido)','(coalesce(new.orcamento_data,new.data_pedido) is distinct from coalesce(old.orcamento_data,old.data_pedido) and not public.contexto_data_retomada_302(old.id))');
  d:=replace(d,'new.data_pedido is distinct from old.data_pedido and not conversao','new.data_pedido is distinct from old.data_pedido and not conversao and not public.contexto_data_retomada_302(old.id)');execute d;
 end if;
end $$;
create or replace function public.retomar_data_pedido_302(_pedido uuid,_data_esperada date,_hoje_esperado date) returns public.pedidos
language plpgsql security definer set search_path=public as $$declare p public.pedidos;hoje date:=(now() at time zone 'America/Sao_Paulo')::date;begin
 select * into p from public.pedidos where id=_pedido for update;
 if not public.usuario_ativo() or not public.can_operate(auth.uid()) or p.id is null or not public.usuario_pode_acessar_centro(p.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',p.id)) then raise exception 'Pedido sem acesso para atualizar a data';end if;
 if p.tipo_documento<>'pedido' or p.status not in('rascunho','digitacao') then raise exception 'Somente pedidos em digitação podem atualizar a data na retomada';end if;
 if p.ciclo_reabertura_289>0 and not public.has_role(auth.uid(),'admin') then raise exception 'Pedido reaberto exige administrador';end if;
 if p.modalidade_venda='intermediacao' and not public.vendedor_intermediacao_autorizado_298(p.centro_id) then raise exception 'Vendedor sem autorização para intermediação';end if;
 if _data_esperada is null or p.data_pedido is distinct from _data_esperada then raise exception 'A data do pedido mudou. Atualize a tela antes de escolher';end if;
 if _hoje_esperado is null or _hoje_esperado<>hoje then raise exception 'O dia mudou. Abra novamente o pedido para conferir a data';end if;
 if p.data_pedido=hoje then return p;end if;
 if exists(select 1 from public.contas_receber where pedido_id=p.id and status<>'cancelado') or exists(select 1 from public.comissoes where pedido_id=p.id and status='paga') or exists(select 1 from public.comissao_parcelas cp join public.comissoes c on c.id=cp.comissao_id join public.contas_pagar t on t.id=cp.conta_pagar_id where c.pedido_id=p.id and t.status<>'cancelado') or exists(select 1 from public.comissao_pagamento_itens i join public.comissoes c on c.id=i.comissao_id where c.pedido_id=p.id) then raise exception 'Há financeiro ou comissão vinculada. Confira os vínculos antes de atualizar a data';end if;
 if exists(select 1 from public.estoque_reservas where pedido_id=p.id) or exists(select 1 from public.carga_pedidos where pedido_id=p.id) or exists(select 1 from public.expedicoes where pedido_id=p.id and status<>'cancelada') or exists(select 1 from public.notas_saida where pedido_id=p.id and status in('autorizada','emitida')) then raise exception 'O pedido possui reserva ou vínculo logístico/fiscal ativo';end if;
 insert into public.pedido_data_contexto_302 values(p.id,auth.uid(),txid_current());
 update public.pedidos set data_pedido=hoje where id=p.id;
 delete from public.pedido_data_contexto_302 where pedido_id=p.id;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',p.id,'data_retomada_302',auth.uid(),jsonb_build_object('data_anterior',p.data_pedido,'data_nova',hoje,'escolha_explicita',true));
 select * into p from public.pedidos where id=_pedido;return p;
end $$;
revoke all on function public.retomar_data_pedido_302(uuid,date,date) from public,anon;
grant execute on function public.retomar_data_pedido_302(uuid,date,date) to authenticated;
notify pgrst,'reload schema';
commit;
