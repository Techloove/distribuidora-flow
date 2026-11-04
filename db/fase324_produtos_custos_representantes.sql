-- Custos não são enviados para representante sem perfil administrador.
-- Preserva tabela física, escrita administrativa, cálculos internos e valores históricos.
begin;
create or replace function public.pode_ver_custos_produto_324() returns boolean
language sql stable security definer set search_path=public as $$
 select public.usuario_ativo() and not public.complemento_pendente_238() and
 (public.has_role(auth.uid(),'admin') or not public.has_role(auth.uid(),'representante'));
$$;
revoke all on function public.pode_ver_custos_produto_324() from public,anon;
grant execute on function public.pode_ver_custos_produto_324() to authenticated,service_role;
-- Uma projeção por coluna conserva o contrato do produto e devolve NULL para os valores sigilosos.
do $$ declare cols text;safe text;secret text;begin
 select string_agg(case when a.attname in('ultimo_custo','custo_medio','markup_percentual','preco_custo','custo_reposicao','margem_minima') then format('case when public.pode_ver_custos_produto_324() then p.%I else null end',a.attname) else format('p.%I',a.attname) end,',' order by a.attnum),
 string_agg(format('%I',a.attname),',' order by a.attnum) filter(where a.attname not in('ultimo_custo','custo_medio','markup_percentual','preco_custo','custo_reposicao','margem_minima')),
 string_agg(format('%I',a.attname),',' order by a.attnum) filter(where a.attname in('ultimo_custo','custo_medio','markup_percentual','preco_custo','custo_reposicao','margem_minima'))
 into cols,safe,secret from pg_attribute a where a.attrelid='public.produtos'::regclass and a.attnum>0 and not a.attisdropped;
 execute format('create or replace function public.listar_produtos_visiveis_324() returns setof public.produtos language sql stable security definer set search_path=public as $func$ select %s from public.produtos p where public.usuario_ativo() and not public.complemento_pendente_238() and public.usuario_pode_acessar_centro(p.centro_id) $func$',cols);
 revoke select on public.produtos from public,anon,authenticated;
 execute format('revoke select(%s) on public.produtos from public,anon,authenticated',secret);
 execute format('grant select(%s) on public.produtos to authenticated',safe);
end $$;
revoke all on function public.listar_produtos_visiveis_324() from public,anon;
grant execute on function public.listar_produtos_visiveis_324() to authenticated,service_role;
create or replace view public.produtos_consulta_324 with(security_barrier=true) as select * from public.listar_produtos_visiveis_324();
revoke all on public.produtos_consulta_324 from public,anon,authenticated;
grant select on public.produtos_consulta_324 to authenticated,service_role;
-- Views com SELECT de custo passam pela mesma projeção, conservando seus filtros e opções.
do $$ declare r record;d text;novo text;begin
 for r in select distinct c.oid,c.relname from pg_class c join pg_depend dep on dep.objid in(select oid from pg_rewrite where ev_class=c.oid) join pg_attribute a on a.attrelid=dep.refobjid and a.attnum=dep.refobjsubid
 where c.relkind='v' and c.relnamespace='public'::regnamespace and c.relname<>'produtos_consulta_324' and dep.refobjid='public.produtos'::regclass and a.attname in('ultimo_custo','custo_medio','markup_percentual','preco_custo','custo_reposicao','margem_minima') loop
 d:=pg_get_viewdef(r.oid,true);
 novo:=regexp_replace(d,'((FROM|JOIN)[[:space:]]+)(public\.)?produtos([[:space:]]|$)','\1public.produtos_consulta_324\4','gi');
 if novo=d then raise exception 'Revise dependência de custos da view %',r.relname;end if;
 execute format('create or replace view public.%I as %s',r.relname,novo);
 end loop;
end $$;
-- O catálogo de leitura não revela custos, mas os cálculos internos continuam usando a tabela base.
do $$ declare d text;begin
 select pg_get_functiondef('public.listar_catalogo_loja_244(uuid,text,boolean)'::regprocedure) into d;
 if position('pode_ver_custos_produto_324' in d)=0 then
  if position('p.custo_medio' in d)=0 then raise exception 'Catálogo divergente: revisar proteção de custo';end if;
  execute replace(d,'p.custo_medio','case when public.pode_ver_custos_produto_324() then p.custo_medio else null::numeric end');
 end if;
end $$;
-- Custos também não aparecem nas compras do histórico de produto.
do $$ declare d text;begin
 select pg_get_viewdef('public.vw_historico_produto'::regclass,true) into d;
 if position('pode_ver_custos_produto_324' in d)=0 then
  execute 'create or replace view public.vw_historico_produto as select * from ('||rtrim(d,'; '||chr(10))||') historico where public.usuario_ativo() and not public.complemento_pendente_238() and (historico.tipo<>''compra'' or public.pode_ver_custos_produto_324())';
 end if;
end $$;
notify pgrst,'reload schema';
commit;
