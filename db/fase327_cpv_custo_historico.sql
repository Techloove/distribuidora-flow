-- Corrige somente a leitura do CPV. Não atualiza pedidos, itens ou lançamentos.
-- O snapshot zero é preservado; custo alternativo só vale sem snapshot.
begin;
do $$ declare nome text; d text; novo text; opcoes text; begin
 if to_regprocedure('public.pode_ver_custos_produto_324()') is null then
  raise exception 'Aplique a proteção de custos da fase324 antes da fase327';
 end if;
 foreach nome in array array['vw_cpv','vw_cpv_mod_300'] loop
  if to_regclass('public.'||nome) is null then raise exception 'View ausente: %',nome; end if;
  d:=pg_get_viewdef(to_regclass('public.'||nome),true);
  if position('pode_ver_custos_produto_324' in d)>0 then
   if position('NULLIF(pr.custo_medio' in d)=0 or position('i.custo_unitario_base, NULLIF' in d)=0 then
    raise exception 'Revise a definição já protegida de %',nome;
   end if;
   continue;
  end if;
  novo:=regexp_replace(d,
   'sum\(i.quantidade \*[[:space:]]*CASE[[:space:]]*WHEN p.modalidade_venda = ''intermediacao''::text THEN COALESCE\(i.custo_unitario_base, 0::numeric\)[[:space:]]*ELSE COALESCE\(pr.custo_medio, pr.preco_custo, pr.ultimo_custo, 0::numeric\)[[:space:]]*END\)',
   'sum(i.quantidade * case when public.pode_ver_custos_produto_324() then case when p.modalidade_venda = ''intermediacao'' then coalesce(i.custo_unitario_base,0::numeric) else coalesce(i.custo_unitario_base,nullif(pr.custo_medio,0),nullif(pr.preco_custo,0),nullif(pr.ultimo_custo,0),0::numeric) end else null::numeric end)',
   'i');
  if novo=d then raise exception 'Definição incompatível de %, nenhuma alteração aplicada',nome; end if;
  -- Reaplica opções explicitamente; preserva dependências e privilégios existentes.
  select array_to_string(reloptions,',') into opcoes from pg_class where oid=to_regclass('public.'||nome);
  execute format('create or replace view public.%I %s as %s',nome,
   case when opcoes is not null then 'with ('||opcoes||')' else '' end,novo);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
