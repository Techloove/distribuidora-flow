-- ============================================================
-- FASE 46 - DRE por competencia: receita de vendas dos pedidos
-- Antes a receita vinha somente de movimentos financeiros (caixa),
-- enquanto o CPV vinha dos pedidos -> DRE mostrava custo sem receita.
-- Agora: receita bruta = faturamento dos pedidos (competencia) e os
-- recebimentos de titulos ligados a pedidos deixam de ser receita
-- (sao apenas caixa) para nao duplicar valores.
-- Idempotente: apenas recria views.
-- ============================================================

begin;

-- ---------- receita de vendas por competencia ----------
create or replace view public.vw_receita_vendas as
select
  p.data_pedido as data,
  p.centro_id,
  sum(p.total_liquido) as receita
from public.pedidos p
where p.status not in ('rascunho','cancelado','recusado')
group by p.data_pedido, p.centro_id;

alter view public.vw_receita_vendas set (security_invoker = on);
grant select on public.vw_receita_vendas to authenticated;

-- ---------- base da DRE ----------
create or replace view public.vw_dre_base as
select
  m.data,
  m.centro_id,
  coalesce(pai.grupo_dre, cat.grupo_dre,
           case when m.tipo = 'entrada' then 'receita_bruta' else 'despesa_operacional' end) as grupo_dre,
  coalesce(pai.nome, cat.nome, case when m.tipo = 'entrada' then 'Receitas' else 'Outras despesas' end) as categoria,
  cat.nome as subcategoria,
  case when m.tipo = 'entrada' then m.valor else -m.valor end as valor
from public.movimentos_financeiros m
left join public.categorias_financeiras cat on cat.id = m.categoria_id
left join public.categorias_financeiras pai on pai.id = cat.parent_id
where m.status = 'ativo'
  and m.dre_ignorar = false
  and m.origem <> 'transferencia'
  -- recebimento de titulo de pedido = caixa de receita ja reconhecida na venda
  and not (
    m.tipo = 'entrada'
    and m.origem = 'recebimento'
    and exists (
      select 1 from public.contas_receber cr
      where cr.id = m.conta_receber_id and cr.pedido_id is not null
    )
  )
union all
select
  v.data,
  v.centro_id,
  'receita_bruta' as grupo_dre,
  'Vendas de produtos' as categoria,
  null::text as subcategoria,
  v.receita as valor
from public.vw_receita_vendas v
union all
select
  c.data,
  c.centro_id,
  'cpv' as grupo_dre,
  'Custo dos produtos vendidos' as categoria,
  null::text as subcategoria,
  -c.custo as valor
from public.vw_cpv c;

alter view public.vw_dre_base set (security_invoker = on);
grant select on public.vw_dre_base to authenticated;

commit;

-- ---------- fim da fase 46 ----------
