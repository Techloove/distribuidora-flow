-- Itens herdam a loja do pedido. Não altera itens, saldos, aprovação ou financeiro.
begin;
do $$begin
 if not exists(select 1 from pg_policy where polrelid='public.pedido_itens'::regclass and polname='acesso_centro_restrito' and not polpermissive) then
  raise exception 'Revise a política de acesso por loja dos itens antes de instalar';end if;
end $$;
alter policy acesso_centro_restrito on public.pedido_itens using (
 exists(select 1 from public.pedidos pedido_332 where pedido_332.id=pedido_itens.pedido_id
  and public.usuario_pode_acessar_centro(pedido_332.centro_id)
  and (pedido_itens.centro_id is null or pedido_itens.centro_id=pedido_332.centro_id))
) with check (
 exists(select 1 from public.pedidos pedido_332 where pedido_332.id=pedido_itens.pedido_id
  and public.usuario_pode_acessar_centro(pedido_332.centro_id)
  and (pedido_itens.centro_id is null or pedido_itens.centro_id=pedido_332.centro_id))
);
create or replace function public.alertas_estoque_pedido_332(_pedido uuid)
returns table(item_id uuid,estoque_disponivel numeric,quantidade_pedido numeric,insuficiente boolean)
language plpgsql stable security definer set search_path=public as $$
declare p public.pedidos;
begin
 select * into p from public.pedidos where id=_pedido;
 if auth.uid() is null or not public.usuario_ativo() or not public.saas_acesso_330() or p.id is null
 or not public.usuario_pode_acessar_centro(p.centro_id)
 or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',p.id)) then
  raise exception 'Pedido não encontrado ou sem acesso' using errcode='42501';end if;
 if p.modalidade_venda<>'estoque' or p.tipo_documento<>'pedido' or p.status not in('rascunho','digitacao','aguardando_aprovacao','aprovado') then return;end if;
 return query with totais as (
  select i.produto_id,sum(i.quantidade) quantidade from public.pedido_itens i where i.pedido_id=p.id and (i.centro_id is null or i.centro_id=p.centro_id) group by i.produto_id
 ), disponiveis as (
  select t.produto_id,t.quantidade,greatest(coalesce(s.quantidade,0)-coalesce((select sum(r.quantidade) from public.estoque_reservas r
   where r.produto_id=t.produto_id and r.centro_id=p.centro_id and r.pedido_id is distinct from p.id),0),0) disponivel
  from totais t left join public.estoque_saldos s on s.produto_id=t.produto_id and s.centro_id=p.centro_id
 )
 select i.id,d.disponivel,d.quantidade,d.quantidade>d.disponivel from public.pedido_itens i join disponiveis d on d.produto_id=i.produto_id where i.pedido_id=p.id and (i.centro_id is null or i.centro_id=p.centro_id);
end $$;
revoke all on function public.alertas_estoque_pedido_332(uuid) from public,anon,authenticated;
grant execute on function public.alertas_estoque_pedido_332(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
