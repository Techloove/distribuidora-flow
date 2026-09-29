-- Fase 56: planejamento de compras por centro
-- Substitui o cálculo global do planejamento quando o ERP opera com múltiplos centros.

drop view if exists public.vw_sugestao_compras_centro;
create view public.vw_sugestao_compras_centro
with (security_invoker = on) as
with centros_acessiveis as (
  select c.id, c.nome
    from public.centros c
   where c.ativo
     and public.usuario_pode_acessar_centro(c.id)
),
vendas as (
  select pi.produto_id, ped.centro_id,
    sum(case when ped.data_pedido >= current_date - interval '30 days' then pi.quantidade else 0 end) as v30,
    sum(case when ped.data_pedido >= current_date - interval '60 days' then pi.quantidade else 0 end) as v60,
    sum(case when ped.data_pedido >= current_date - interval '90 days' then pi.quantidade else 0 end) as v90
  from public.pedido_itens pi
  join public.pedidos ped on ped.id = pi.pedido_id
  where ped.centro_id is not null
    and ped.status not in ('cancelado','rascunho','digitacao','recusado')
  group by pi.produto_id, ped.centro_id
),
pendentes as (
  select pi.produto_id, ped.centro_id, sum(pi.quantidade) as qtd
    from public.pedido_itens pi
    join public.pedidos ped on ped.id = pi.pedido_id
   where ped.centro_id is not null
     and ped.status in ('rascunho','digitacao','aguardando_aprovacao','aprovado')
   group by pi.produto_id, ped.centro_id
),
transito as (
  select ci.produto_id, cp.centro_id, sum(ci.quantidade) as qtd
    from public.compra_itens ci
    join public.compras cp on cp.id = ci.compra_id
   where cp.centro_id is not null
     and cp.status in ('comprado')
   group by ci.produto_id, cp.centro_id
)
select
  p.id as produto_id,
  p.codigo,
  p.descricao,
  p.unidade,
  c.id as centro_id,
  c.nome as centro,
  coalesce(s.quantidade, 0)::numeric(14,3) as estoque_atual,
  p.estoque_minimo,
  p.estoque_maximo,
  p.prazo_fornecedor_dias,
  coalesce(v.v30,0)::numeric(14,3) as venda_30,
  coalesce(v.v60,0)::numeric(14,3) as venda_60,
  coalesce(v.v90,0)::numeric(14,3) as venda_90,
  round(coalesce(v.v90,0)/3.0, 2) as media_mensal,
  coalesce(pe.qtd,0)::numeric(14,3) as pedidos_pendentes,
  coalesce(t.qtd,0)::numeric(14,3) as em_transito,
  greatest(
    round(
      greatest(
        coalesce(p.estoque_maximo,0),
        round(coalesce(v.v90,0)/3.0,2) + coalesce(p.estoque_minimo,0)
      )
      + coalesce(pe.qtd,0)
      - coalesce(s.quantidade,0)
      - coalesce(t.qtd,0),
      2
    ),
    0
  ) as sugestao
from public.produtos p
cross join centros_acessiveis c
left join public.estoque_saldos s
  on s.produto_id = p.id and s.centro_id = c.id
left join vendas v
  on v.produto_id = p.id and v.centro_id = c.id
left join pendentes pe
  on pe.produto_id = p.id and pe.centro_id = c.id
left join transito t
  on t.produto_id = p.id and t.centro_id = c.id
where p.ativo;

grant select on public.vw_sugestao_compras_centro to authenticated;
grant select on public.vw_sugestao_compras_centro to service_role;
