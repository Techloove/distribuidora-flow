-- Cidades sem tarifa ativa, por loja e produtos que já usam frete por volume.
-- Somente leitura: não altera preços, pedidos nem estoque.
begin;
do $$begin
 if to_regprocedure('public.salvar_grade_frete_volume_251(uuid,uuid[],jsonb)') is null then raise exception 'Aplique a fase251 antes da fase252';end if;
end $$;
create or replace function public.pendencias_frete_volume_252(_loja uuid default null)
returns table(centro_id uuid,loja text,cidade text,uf text,produtos_sem_tarifa bigint,produtos_previstos bigint)
language plpgsql stable security definer set search_path=public as $$begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('lojas_frete_volume_configurar') or (_loja is not null and not public.usuario_pode_acessar_centro(_loja)) then raise exception 'Sem acesso às pendências de frete';end if;
 return query
 with cidades as (
  select distinct public.chave_cidade_250(c.cidade) cidade,public.chave_cidade_250(c.uf) uf
  from public.clientes c where public.chave_cidade_250(c.cidade)<>''
 ), previstos as (
  select distinct f.centro_id,f.produto_id,c.nome::text loja
  from public.loja_fretes_volume f join public.centros c on c.id=f.centro_id
  join public.loja_produtos l on l.centro_id=f.centro_id and l.produto_id=f.produto_id
  where f.ativo and l.disponivel and c.ativo and public.usuario_pode_acessar_centro(f.centro_id)
   and (_loja is null or f.centro_id=_loja) and public.produto_categoria_loja_246(f.centro_id,f.produto_id)
 )
 select p.centro_id,p.loja,c.cidade,c.uf,
  count(*) filter(where f.produto_id is null),count(*)
 from previstos p cross join cidades c
 left join public.loja_fretes_volume f on f.centro_id=p.centro_id and f.produto_id=p.produto_id
  and f.cidade=c.cidade and f.uf=c.uf and f.ativo
 group by p.centro_id,p.loja,c.cidade,c.uf
 having count(*) filter(where f.produto_id is null)>0
 order by p.loja,p.centro_id,c.cidade,c.uf;
end $$;
revoke all on function public.pendencias_frete_volume_252(uuid) from public,anon;
grant execute on function public.pendencias_frete_volume_252(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
