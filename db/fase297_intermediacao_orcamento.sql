-- Cotação no orçamento: a configuração da loja continua sendo somente habilitar/desabilitar.
-- O custo do orçamento é preservado quando a data comercial do pedido muda no aceite.
begin;
create or replace function public.modalidade_pedido_296() returns trigger
language plpgsql security definer set search_path=public as $$declare conversao boolean:=false;begin
 if new.modalidade_venda='intermediacao' and new.tipo_documento not in('pedido','orcamento') then raise exception 'Modalidade indisponível neste documento';end if;
 if new.modalidade_venda='intermediacao' and (tg_op='INSERT' or old.modalidade_venda is distinct from new.modalidade_venda) then
  if not public.intermediacao_ativa_296(new.centro_id) or new.status not in('rascunho','digitacao') then raise exception 'Intermediação não habilitada nesta loja ou documento indisponível';end if;
  if new.tipo_documento='orcamento' and (not public.pode_rotina('pedidos_orcamentos') or new.orcamento_situacao is distinct from 'negociacao' or new.orcamento_data is null or new.orcamento_validade is null or new.orcamento_validade<(now() at time zone 'America/Sao_Paulo')::date) then raise exception 'Orçamento sem acesso ou fora da negociação válida';end if;
 end if;
 if tg_op='UPDATE' then
  conversao:=old.tipo_documento='orcamento' and new.tipo_documento='pedido' and old.orcamento_situacao='negociacao' and new.orcamento_situacao='aceito' and new.orcamento_aceito_em is not null and old.orcamento_data is not null;
  if new.modalidade_venda is distinct from old.modalidade_venda and (old.status not in('rascunho','digitacao') or exists(select 1 from public.pedido_itens where pedido_id=old.id)) then raise exception 'Escolha a modalidade antes de incluir os itens';end if;
  if old.modalidade_venda='intermediacao' and exists(select 1 from public.pedido_itens where pedido_id=old.id) and (
   new.centro_id is distinct from old.centro_id or
   coalesce(new.orcamento_data,new.data_pedido) is distinct from coalesce(old.orcamento_data,old.data_pedido) or
   (new.data_pedido is distinct from old.data_pedido and not conversao)) then raise exception 'Remova os itens antes de alterar a loja ou data base da cotação';end if;
 end if;
 if new.modalidade_venda='intermediacao' then new.frete_volume_opcao:='dispensar';new.frete_volume_ativo:=false;new.frete_volume_valor:=0;new.frete_volume_detalhes:='[]';end if;
 return new;
end $$;
revoke all on function public.modalidade_pedido_296() from public,anon,authenticated,service_role;
do $$declare d text;antigo text:='q.dia is distinct from p.data_pedido';novo text:='q.dia is distinct from coalesce(p.orcamento_data,p.data_pedido)';begin
 select pg_get_functiondef('public.item_intermediacao_296()'::regprocedure) into d;
 if position(novo in d)=0 then
  if position(antigo in d)=0 then raise exception 'Validação da cotação incompatível com a fase297';end if;
  execute replace(d,antigo,novo);
 end if;
end $$;
-- Cotação é uma operação de precificação; configurar a loja continua com a permissão própria.
do $$declare d text;a text:='not public.can_manage(auth.uid()) or not public.pode_rotina(''configuracao_rotinas_editar'')';n text:='not ((public.can_manage(auth.uid()) and public.pode_rotina(''configuracao_rotinas_editar'')) or (public.can_operate(auth.uid()) and public.pode_alterar_preco(auth.uid())))';begin
 select pg_get_functiondef('public.salvar_cotacao_intermediacao_296(uuid,uuid,date,numeric)'::regprocedure) into d;
 if position(n in d)=0 then
  if position(a in d)=0 then raise exception 'Permissão da cotação incompatível com a fase297';end if;
  execute replace(d,a,n);
 end if;
end $$;
notify pgrst,'reload schema';
commit;
