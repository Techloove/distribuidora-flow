-- Executar este arquivo SQL inteiro, manualmente no Supabase.
begin;
create or replace function public.salvar_observacoes_pedido_274(
  _pedido uuid, _observacoes text, _anterior text
) returns public.pedidos
language plpgsql security definer set search_path=public as $$
declare p public.pedidos; antes text;
begin
  if auth.uid() is null or not coalesce(public.usuario_ativo(),false)
     or not coalesce(public.can_operate(auth.uid()),false)
     or not coalesce(public.pode_rotina('pedidos_acompanhar'),false) then
    raise exception 'Sem permissão para editar observações';
  end if;
  select * into p from public.pedidos where id=_pedido for update;
  if p.id is null or p.centro_id is null
     or not coalesce(public.usuario_pode_acessar_centro(p.centro_id),false)
     or (public.escopo_representante() and not coalesce(public.documento_na_minha_carteira('pedidos',p.id),false)) then
    raise exception 'Pedido não encontrado ou sem acesso à loja/carteira';
  end if;
  if p.status not in ('rascunho','digitacao') then
    raise exception 'Observações só podem ser editadas durante a digitação';
  end if;
  if p.tipo_documento='orcamento' and (
     not coalesce(public.orcamento_acessivel_236(p.id),false)
     or p.orcamento_situacao is distinct from 'negociacao'
     or p.orcamento_validade is null
     or p.orcamento_validade<(now() at time zone 'America/Sao_Paulo')::date) then
    raise exception 'Revise e reabra o orçamento antes de editar';
  end if;
  if length(coalesce(_observacoes,''))>4000 then
    raise exception 'Informe até 4000 caracteres';
  end if;
  if coalesce(p.observacoes,'') is distinct from coalesce(_anterior,'') then
    raise exception 'As observações foram alteradas por outro usuário. Reabra o pedido antes de editar';
  end if;
  antes:=p.observacoes;
  update public.pedidos set observacoes=nullif(btrim(_observacoes),'')
    where id=p.id returning * into p;
  insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe)
    values('pedidos',p.id,'observacoes_pedido_274',auth.uid(),
      jsonb_build_object('antes',antes,'depois',p.observacoes));
  return p;
end $$;
revoke all on function public.salvar_observacoes_pedido_274(uuid,text,text) from public,anon;
grant execute on function public.salvar_observacoes_pedido_274(uuid,text,text) to authenticated;
commit;
