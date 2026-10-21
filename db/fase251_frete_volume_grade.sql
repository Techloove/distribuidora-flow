-- Grade por cidade, com seleção de produtos por produto/grupo/categoria.
-- Preserva as tarifas individuais e o motor de cálculo da fase250.
begin;
do $$begin
 if to_regprocedure('public.salvar_frete_volume_250(uuid,text,text,uuid,numeric,boolean)') is null or to_regprocedure('public.produto_categoria_loja_246(uuid,uuid)') is null then raise exception 'Aplique as fases246 e250 antes da fase251';end if;
end $$;
create or replace function public.produtos_frete_volume_251(_loja uuid)
returns table(id uuid,codigo text,descricao text,unidade text,grupo text,categoria text)
language plpgsql stable security definer set search_path=public as $$begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('lojas_frete_volume_configurar') or not public.usuario_pode_acessar_centro(_loja) then raise exception 'Sem acesso à configuração de frete';end if;
 return query select p.id,p.codigo::text,p.descricao::text,p.unidade::text,coalesce(p.grupo,''),coalesce(p.categoria,'')
 from public.produtos p join public.loja_produtos l on l.produto_id=p.id
 where l.centro_id=_loja and l.disponivel and public.produto_categoria_loja_246(_loja,p.id)
 order by p.descricao,p.id;
end $$;
revoke all on function public.produtos_frete_volume_251(uuid) from public,anon;
grant execute on function public.produtos_frete_volume_251(uuid) to authenticated;
create or replace function public.salvar_grade_frete_volume_251(_loja uuid,_produtos uuid[],_cidades jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare produto251 uuid;cidade251 jsonb;quantidade251 integer:=0;unidades251 integer;begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('lojas_frete_volume_configurar') or not public.usuario_pode_acessar_centro(_loja) then raise exception 'Sem permissão para configurar frete nesta loja';end if;
 if coalesce(cardinality(_produtos),0)=0 or array_position(_produtos,null) is not null or cardinality(_produtos)>5000 then raise exception 'Selecione produtos válidos';end if;
 if jsonb_typeof(_cidades) is distinct from 'array' then raise exception 'Lista de cidades inválida';end if;
 if jsonb_array_length(_cidades)=0 or jsonb_array_length(_cidades)>5000 or cardinality(_produtos)::bigint*jsonb_array_length(_cidades)>5000 then raise exception 'Selecione entre 1 e 5.000 tarifas por salvamento';end if;
 if exists(select 1 from unnest(_produtos) p(id) where not public.produto_categoria_loja_246(_loja,p.id) or not exists(select 1 from public.loja_produtos l where l.centro_id=_loja and l.produto_id=p.id and l.disponivel)) then raise exception 'Produto fora do catálogo disponível da loja';end if;
 -- Unidades distintas não podem receber acidentalmente a mesma cobrança no lote.
 select count(distinct public.chave_cidade_250(p.unidade)) into unidades251 from public.produtos p where p.id=any(_produtos);
 if unidades251>1 then raise exception 'Selecione produtos com a mesma unidade de venda para aplicar a tarifa em lote';end if;
 if exists(select 1 from jsonb_array_elements(_cidades) c group by public.chave_cidade_250(c->>'cidade'),public.chave_cidade_250(c->>'uf') having count(*)>1) then raise exception 'Cidade/UF repetida no lote';end if;
 for cidade251 in select value from jsonb_array_elements(_cidades) loop
  if jsonb_typeof(cidade251) is distinct from 'object' or jsonb_typeof(cidade251->'valor') is distinct from 'number' or jsonb_typeof(cidade251->'ativo') is distinct from 'boolean' then raise exception 'Informe valor e situação de cada cidade';end if;
  for produto251 in select distinct p from unnest(_produtos) p order by p loop
   perform public.salvar_frete_volume_250(_loja,cidade251->>'cidade',cidade251->>'uf',produto251,(cidade251->>'valor')::numeric,(cidade251->>'ativo')::boolean);
   quantidade251:=quantidade251+1;
  end loop;
 end loop;
 return quantidade251;
end $$;
revoke all on function public.salvar_grade_frete_volume_251(uuid,uuid[],jsonb) from public,anon;
grant execute on function public.salvar_grade_frete_volume_251(uuid,uuid[],jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
