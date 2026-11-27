-- Dados comerciais de produtos já vinculados a documentos autorizados.
-- Não libera catálogo global, custos, margens ou pedidos de outras carteiras.
begin;
create or replace function public.produtos_impressao_pedidos_380(_pedidos uuid[])
returns table(id uuid,codigo text,descricao text,unidade text,peso_kg numeric)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.usuario_ativo() or public.complemento_pendente_238() then raise exception 'Usuário sem acesso à impressão';end if;
 if _pedidos is null or cardinality(_pedidos) not between 1 and 100 or array_position(_pedidos,null) is not null then raise exception 'Seleção de pedidos inválida';end if;
 if exists(select 1 from unnest(_pedidos) r(id) left join public.pedidos p on p.id=r.id
  where p.id is null or not coalesce(public.usuario_pode_acessar_centro(p.centro_id),false)
  or (public.escopo_representante() and not coalesce(public.documento_na_minha_carteira('pedidos',p.id),false))) then
  raise exception 'Pedido sem acesso para impressão';
 end if;
 return query select distinct pr.id,pr.codigo::text,pr.descricao::text,pr.unidade::text,pr.peso_kg::numeric
 from public.pedido_itens i join public.produtos pr on pr.id=i.produto_id
 where i.pedido_id=any(_pedidos);
end $$;
revoke all on function public.produtos_impressao_pedidos_380(uuid[]) from public,anon;
grant execute on function public.produtos_impressao_pedidos_380(uuid[]) to authenticated;
notify pgrst,'reload schema';
commit;
