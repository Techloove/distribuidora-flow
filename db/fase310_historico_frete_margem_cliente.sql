-- Consulta contextual: apenas negociações aprovadas do mesmo cliente e da mesma loja.
begin;
create or replace function public.historico_intermediacao_cliente_310(_pedido_atual uuid,_limite integer default 10) returns jsonb
language plpgsql stable security invoker set search_path=public as $$declare atual public.pedidos;resultado jsonb;begin
 select * into atual from public.pedidos where id=_pedido_atual;
 if not public.usuario_ativo() or not public.can_operate(auth.uid()) or atual.id is null or not public.usuario_pode_acessar_centro(atual.centro_id) or not public.vendedor_intermediacao_autorizado_298(atual.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',atual.id)) then raise exception 'Pedido sem acesso ao histórico de intermediação';end if;
 if atual.modalidade_venda<>'intermediacao' then raise exception 'Histórico disponível apenas em Vendas Intermediação';end if;
 if atual.cliente_id is null or atual.centro_id is null then raise exception 'Informe o cliente e a loja do documento';end if;
 if _limite is null or _limite<1 or _limite>20 then raise exception 'Consulte entre 1 e 20 pedidos';end if;
 with ultimos as materialized (
  select p.id,p.numero,p.data_pedido,public.data_comissao_305(p.id) data_aprovacao,p.status,p.responsavel_frete_intermediacao,p.created_at
  from public.pedidos p where p.id<>atual.id and p.cliente_id=atual.cliente_id and p.centro_id=atual.centro_id
   and p.modalidade_venda='intermediacao' and public.status_comissao_valido_302(p.tipo_documento,p.status)
   and public.usuario_pode_acessar_centro(p.centro_id) and (not public.escopo_representante() or public.documento_na_minha_carteira('pedidos',p.id))
  order by public.data_comissao_305(p.id) desc nulls last,p.created_at desc nulls last,p.id desc limit _limite
 ), detalhes as (
  select p.*,coalesce((select jsonb_agg(jsonb_build_object('produto_id',i.produto_id,'produto',coalesce(pr.descricao,'Produto não disponível'),'quantidade',i.quantidade,'frete_saco',i.frete_saca,'margem_saco',i.margem_saca) order by pr.descricao nulls last,i.id) from public.pedido_itens i left join public.produtos pr on pr.id=i.produto_id where i.pedido_id=p.id),'[]'::jsonb) itens from ultimos p
 ) select jsonb_build_object('cliente_id',atual.cliente_id,'cliente',coalesce((select razao_social from public.clientes where id=atual.cliente_id),'Cliente'),'loja_id',atual.centro_id,'loja',coalesce((select nome from public.centros where id=atual.centro_id),'Loja'),'limite',_limite,'pedidos',coalesce((select jsonb_agg(to_jsonb(d) order by d.data_aprovacao desc nulls last,d.created_at desc nulls last,d.id desc) from detalhes d),'[]'::jsonb)) into resultado;
 return resultado;
end $$;
revoke all on function public.historico_intermediacao_cliente_310(uuid,integer) from public,anon;
grant execute on function public.historico_intermediacao_cliente_310(uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
