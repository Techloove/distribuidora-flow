begin;
-- Consulta comercial por loja: nenhuma informação de custo ou margem é retornada.
do $$declare tipo_role text;begin
 if not exists(select 1 from public.auditoria where tabela='fase371' and acao='instalada') then
  select format_type(atttypid,atttypmod) into tipo_role from pg_attribute where attrelid='public.role_menus'::regclass and attname='role';
  execute format('insert into public.role_menus(role,path) select codigo::%s,''/tabela-precos'' from public.papeis on conflict do nothing',tipo_role);
  insert into public.auditoria(tabela,acao,detalhe) values('fase371','instalada','{}');
 end if;
end $$;
create or replace function public.tabela_precos_loja_371(_loja uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare loja public.centros;resultado jsonb;
begin
 if auth.uid() is null or not coalesce(public.usuario_ativo(),false) or public.complemento_pendente_238()
 or not coalesce(public.usuario_pode_acessar_centro(_loja),false) or not (
 public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'gestor') or exists(
 select 1 from public.user_roles u join public.role_menus m on m.role::text=u.role::text
 where u.user_id=auth.uid() and m.path='/tabela-precos')) then raise exception 'Sem acesso à tabela de preços desta loja';end if;
 select * into loja from public.centros where id=_loja and ativo;
 if loja.id is null then raise exception 'Selecione uma loja ativa';end if;
 select jsonb_build_object(
 'loja',jsonb_build_object('id',loja.id,'nome',loja.nome),
 'consultado_em',now(),
 'faixas',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'nome',f.nome,'categoria',f.categoria,'peso_min',f.peso_min,'peso_max',f.peso_max,'percentual',f.percentual,'ordem',f.ordem,'ativo',f.ativo) order by f.ordem,f.peso_min,f.id) from public.desconto_faixas_peso f where f.centro_id=_loja and f.ativo),'[]'::jsonb),
 'itens',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'codigo',p.codigo,'descricao',p.descricao,'unidade',p.unidade,'categoria',p.categoria,'peso_kg',p.peso_kg,'preco_normal',p.preco_venda) order by p.descricao,p.id)
 from public.loja_produtos l join public.produtos p on p.id=l.produto_id
 where l.centro_id=_loja and l.disponivel and p.ativo and public.produto_categoria_loja_246(_loja,p.id)),'[]'::jsonb)
 ) into resultado;
 return resultado;
end $$;
revoke all on function public.tabela_precos_loja_371(uuid) from public,anon,authenticated;
grant execute on function public.tabela_precos_loja_371(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
