-- Catálogo da loja definido pela categoria já cadastrada nos produtos.
begin;
do $$begin
 if to_regprocedure('public.validar_oferta_loja_245()') is null then raise exception 'Aplique a fase245 antes da fase246';end if;
end $$;
alter table public.centros add column if not exists categoria_produtos_id uuid references public.cad_categorias(id);
-- Sem seleção inicial não muda o catálogo existente. Não adivinha pelo nome da loja.
create or replace function public.produto_categoria_loja_246(_loja uuid,_produto uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.centros c join public.produtos p on p.id=_produto left join public.cad_categorias k on k.id=c.categoria_produtos_id where c.id=_loja and (c.categoria_produtos_id is null or public.norm_txt(p.categoria)=k.nome_norm));
$$;
revoke all on function public.produto_categoria_loja_246(uuid,uuid) from public,anon,authenticated;
create or replace function public.salvar_categoria_loja_246(_loja uuid,_categoria uuid) returns void
language plpgsql security definer set search_path=public as $$declare antes uuid;begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('lojas_catalogo_configurar') or not public.usuario_pode_acessar_centro(_loja) or not exists(select 1 from public.centros where id=_loja and ativo) then raise exception 'Sem permissão para configurar a categoria desta loja';end if;
 if _categoria is not null and not exists(select 1 from public.cad_categorias where id=_categoria and ativo) then raise exception 'Selecione uma categoria ativa existente';end if;
 select categoria_produtos_id into antes from public.centros where id=_loja for update;
 update public.centros set categoria_produtos_id=_categoria where id=_loja;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('centros',_loja,'configurar_categoria_loja_246',auth.uid(),jsonb_build_object('categoria_anterior',antes,'categoria_atual',_categoria));
end $$;
revoke all on function public.salvar_categoria_loja_246(uuid,uuid) from public,anon;
grant execute on function public.salvar_categoria_loja_246(uuid,uuid) to authenticated;
create or replace function public.proteger_categoria_loja_246() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if auth.uid() is not null and new.categoria_produtos_id is distinct from old.categoria_produtos_id and (not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('lojas_catalogo_configurar') or not public.usuario_pode_acessar_centro(new.id)) then raise exception 'Categoria da loja sem permissão de alteração';end if;return new;
end $$;
revoke all on function public.proteger_categoria_loja_246() from public,anon,authenticated;
drop trigger if exists proteger_categoria_loja_246 on public.centros;
create trigger proteger_categoria_loja_246 before update of categoria_produtos_id on public.centros for each row execute function public.proteger_categoria_loja_246();
-- Integra às consultas e guardas existentes preservando OIDs, ACLs e carteira.
do $$declare d text;r regprocedure;antigo text;novo text;begin
 foreach r in array array[
 'public.listar_catalogo_loja_244(uuid,text,boolean)'::regprocedure,
 'public.preco_item_pedido_244(uuid,uuid)'::regprocedure,
 'public.validar_item_catalogo_244()'::regprocedure,
 'public.validar_pedido_catalogo_244()'::regprocedure,
 'public.validar_pedido(uuid)'::regprocedure,
 'public.salvar_produto_loja_244(uuid,uuid,boolean,numeric,numeric)'::regprocedure] loop
  select pg_get_functiondef(r) into d;
  if position('produto_categoria_loja_246' in d)>0 then continue;end if;
  case r::oid
  when 'public.listar_catalogo_loja_244(uuid,text,boolean)'::regprocedure::oid then
   antigo:='where l.centro_id=_loja and';novo:='where public.produto_categoria_loja_246(_loja,p.id) and l.centro_id=_loja and';
  when 'public.preco_item_pedido_244(uuid,uuid)'::regprocedure::oid then
   antigo:='if l.produto_id is null or not l.disponivel then';novo:='if l.produto_id is null or not l.disponivel or not public.produto_categoria_loja_246(p.centro_id,_produto) then';
  when 'public.validar_item_catalogo_244()'::regprocedure::oid then
   antigo:='if ok is distinct from true then';novo:='if ok is distinct from true or not public.produto_categoria_loja_246(loja,new.produto_id) then';
  when 'public.validar_pedido_catalogo_244()'::regprocedure::oid then
   antigo:='if ok is distinct from true then';novo:='if ok is distinct from true or not public.produto_categoria_loja_246(new.centro_id,it.produto_id) then';
  when 'public.validar_pedido(uuid)'::regprocedure::oid then
   antigo:='and l.disponivel is distinct from true';novo:='and (l.disponivel is distinct from true or not public.produto_categoria_loja_246(p.centro_id,i.produto_id))';
  else
   antigo:='select to_jsonb(l) into antes';novo:='if not public.produto_categoria_loja_246(_loja,_produto) then raise exception ''O produto não pertence à categoria desta loja'';end if; select to_jsonb(l) into antes';
  end case;
  if position(antigo in d)=0 then raise exception 'Rotina incompatível com a fase246: %',r;end if;
  execute replace(d,antigo,novo);
 end loop;
end $$;
-- Ofertas exibidas também respeitam a categoria da loja.
create or replace view public.vw_promocoes with(security_invoker=true) as
select i.id as item_id,t.id as tabela_id,t.nome as tabela_nome,t.ativo,t.cliente_id,t.uf,t.prioridade,t.vigencia_inicio,t.vigencia_fim,
 p.id as produto_id,p.codigo as produto_codigo,p.descricao as produto_descricao,coalesce(l.preco_venda,p.preco_venda)::numeric(14,4) as preco_normal,
 i.preco as preco_promocional,i.desconto_maximo,
 case when coalesce(l.preco_venda,p.preco_venda,0)>0 then round(((i.preco-coalesce(l.preco_venda,p.preco_venda))/coalesce(l.preco_venda,p.preco_venda))*100,2) else 0 end as variacao_percentual,
 (t.ativo and t.vigencia_inicio<=current_date and (t.vigencia_fim is null or t.vigencia_fim>=current_date)) as vigente,t.centro_id
from public.tabela_preco_itens i join public.tabelas_preco t on t.id=i.tabela_id join public.produtos p on p.id=i.produto_id
left join public.loja_produtos l on l.produto_id=p.id and l.centro_id=t.centro_id
join public.centros c on c.id=t.centro_id left join public.cad_categorias k on k.id=c.categoria_produtos_id
where c.categoria_produtos_id is null or public.norm_txt(p.categoria)=k.nome_norm;
grant select on public.vw_promocoes to authenticated;
notify pgrst,'reload schema';
commit;
