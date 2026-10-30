-- Vínculos de consulta do cadastro de produtos, com a mesma regra de categoria da fase271.
-- Somente leitura: não muda categoria, estoque, compra ou vínculo existente.
begin;
create or replace view public.vw_produtos_lojas_295
with(security_invoker=on,security_barrier=on) as
 select p.id produto_id,c.id centro_id
 from public.produtos p
 join public.cad_categorias k on k.nome_norm=public.norm_txt(p.categoria)
 join public.centros c on c.categoria_produtos_id=k.id
 where c.ativo and public.usuario_ativo() and public.usuario_pode_acessar_centro(c.id);
revoke all on public.vw_produtos_lojas_295 from public,anon,authenticated;
grant select on public.vw_produtos_lojas_295 to authenticated,service_role;
-- O resumo antigo é consolidado e não possui centro_id. Não filtrar um total já agregado.
create or replace function public.resumo_comissoes_loja_295(_centro uuid)
returns jsonb language sql stable security invoker set search_path=public as $$
 with base as (
  select d.representante_id,d.representante,d.ano,d.mes_numero,d.mes,count(*) pedidos,
   sum(d.base_calculo) base_total,
   sum(case when d.status='prevista' then d.valor else 0 end) prevista,
   sum(case when d.status='liberada' then d.valor else 0 end) liberada,
   sum(case when d.status='paga' then d.valor else 0 end) paga,
   sum(case when d.status='cancelada' then d.valor else 0 end) cancelada,
   sum(case when d.status in('prevista','liberada') then d.valor else 0 end) a_pagar,
   sum(case when d.status<>'cancelada' then d.valor else 0 end) total
  from public.vw_comissoes_detalhe d
  where public.usuario_ativo() and public.usuario_pode_acessar_centro(_centro)
   and d.centro_id=_centro and d.ano is not null
  group by d.representante_id,d.representante,d.ano,d.mes_numero,d.mes
 ), vendas as (
  select representante_id,extract(year from data_pedido)::int ano,extract(month from data_pedido)::int mes,
   sum(coalesce(total_liquido,0)) realizado
  from public.pedidos where centro_id=_centro and status not in('cancelado','rascunho','digitacao','recusado')
  group by 1,2,3
 ), resultado as (
  -- Metas existentes são globais por representante, sem centro_id: não ratear ou duplicar por loja.
  select b.*,null::numeric valor_meta,coalesce(v.realizado,0) realizado,null::numeric atingimento_percentual
  from base b
  left join vendas v on v.representante_id=b.representante_id and v.ano=b.ano and v.mes=b.mes_numero
 ) select coalesce(jsonb_agg(to_jsonb(r) order by r.ano desc,r.mes_numero desc,r.representante),'[]'::jsonb) from resultado r;
$$;
revoke all on function public.resumo_comissoes_loja_295(uuid) from public,anon,authenticated;
grant execute on function public.resumo_comissoes_loja_295(uuid) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
