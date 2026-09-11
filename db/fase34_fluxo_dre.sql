-- ============================================================
-- FASE 34 - Fluxo de caixa (realizado x previsto), CPV e DRE gerencial
-- Somente novas views/funcoes. Idempotente.
-- ============================================================

-- ---------- fluxo de caixa realizado (por dia / conta / centro) ----------
create or replace view public.vw_fluxo_realizado as
select
  m.data,
  m.conta_id,
  m.centro_id,
  sum(case when m.tipo = 'entrada' and m.origem <> 'transferencia' then m.valor else 0 end) as entradas,
  sum(case when m.tipo = 'saida' and m.origem <> 'transferencia' then m.valor else 0 end) as saidas,
  sum(case when m.origem = 'transferencia' and m.tipo = 'entrada' then m.valor
           when m.origem = 'transferencia' and m.tipo = 'saida' then -m.valor else 0 end) as transferencias,
  sum(case when m.tipo = 'entrada' then m.valor else -m.valor end) as resultado
from public.movimentos_financeiros m
where m.status = 'ativo'
group by m.data, m.conta_id, m.centro_id;

alter view public.vw_fluxo_realizado set (security_invoker = on);
grant select on public.vw_fluxo_realizado to authenticated;

-- ---------- fluxo previsto (titulos em aberto) ----------
create or replace view public.vw_fluxo_previsto as
select
  t.vencimento as data,
  t.centro_id,
  round(t.valor + t.juros + t.multa + t.acrescimo - t.desconto - coalesce(t.valor_pago,0), 2) as entradas,
  0::numeric as saidas
from public.contas_receber t
where t.status not in ('pago','cancelado')
union all
select
  t.vencimento,
  t.centro_id,
  0::numeric,
  round(t.valor + t.juros + t.multa + t.acrescimo - t.desconto - coalesce(t.valor_pago,0), 2)
from public.contas_pagar t
where t.status not in ('pago','cancelado');

alter view public.vw_fluxo_previsto set (security_invoker = on);
grant select on public.vw_fluxo_previsto to authenticated;

-- ---------- custo dos produtos vendidos ----------
create or replace view public.vw_cpv as
select
  p.data_pedido as data,
  p.centro_id,
  sum(i.quantidade * coalesce(pr.custo_medio, pr.preco_custo, pr.ultimo_custo, 0)) as custo
from public.pedidos p
join public.pedido_itens i on i.pedido_id = p.id
join public.produtos pr on pr.id = i.produto_id
where p.status not in ('rascunho','cancelado','recusado')
group by p.data_pedido, p.centro_id;

alter view public.vw_cpv set (security_invoker = on);
grant select on public.vw_cpv to authenticated;

-- ---------- base da DRE (movimentos reais + CPV) ----------
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
where m.status = 'ativo' and m.dre_ignorar = false
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

-- ---------- DRE mensal consolidada ----------
create or replace view public.vw_dre_mensal as
select
  to_char(d.data, 'YYYY-MM') as periodo,
  d.centro_id,
  sum(case when d.grupo_dre = 'receita_bruta' then d.valor else 0 end) as receita_bruta,
  sum(case when d.grupo_dre = 'deducao' then -d.valor else 0 end) as deducoes,
  sum(case when d.grupo_dre = 'cpv' then -d.valor else 0 end) as cpv,
  sum(case when d.grupo_dre = 'despesa_administrativa' then -d.valor else 0 end) as desp_administrativa,
  sum(case when d.grupo_dre = 'despesa_comercial' then -d.valor else 0 end) as desp_comercial,
  sum(case when d.grupo_dre = 'despesa_vendas' then -d.valor else 0 end) as desp_vendas,
  sum(case when d.grupo_dre = 'despesa_logistica' then -d.valor else 0 end) as desp_logistica,
  sum(case when d.grupo_dre in ('despesa_operacional','outras') and d.valor < 0 then -d.valor else 0 end) as desp_operacional,
  sum(case when d.grupo_dre = 'despesa_financeira' then -d.valor else 0 end) as desp_financeira,
  sum(case when d.grupo_dre = 'receita_financeira' then d.valor else 0 end) as receita_financeira,
  sum(case when d.grupo_dre = 'outras' and d.valor > 0 then d.valor else 0 end) as outras_receitas
from public.vw_dre_base d
group by 1, 2;

alter view public.vw_dre_mensal set (security_invoker = on);
grant select on public.vw_dre_mensal to authenticated;

-- ---------- despesas por categoria ----------
create or replace view public.vw_despesas_categoria as
select
  to_char(m.data, 'YYYY-MM') as periodo,
  m.data,
  m.centro_id,
  coalesce(pai.nome, cat.nome, 'Sem categoria') as categoria,
  coalesce(cat.nome, 'Sem subcategoria') as subcategoria,
  sum(m.valor) as valor
from public.movimentos_financeiros m
left join public.categorias_financeiras cat on cat.id = m.categoria_id
left join public.categorias_financeiras pai on pai.id = cat.parent_id
where m.status = 'ativo' and m.tipo = 'saida' and m.dre_ignorar = false
group by 1, 2, 3, 4, 5;

alter view public.vw_despesas_categoria set (security_invoker = on);
grant select on public.vw_despesas_categoria to authenticated;

-- ---------- indicadores do dashboard financeiro ----------
create or replace function public.dashboard_financeiro(_centro uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'saldo_contas', (select coalesce(sum(saldo_atual),0) from public.vw_conta_saldo
                      where (_centro is null or centro_id = _centro)),
    'a_receber', (select coalesce(sum(valor + juros + multa + acrescimo - desconto - coalesce(valor_pago,0)),0)
                    from public.contas_receber
                   where status not in ('pago','cancelado') and (_centro is null or centro_id = _centro)),
    'a_receber_vencido', (select coalesce(sum(valor + juros + multa + acrescimo - desconto - coalesce(valor_pago,0)),0)
                    from public.contas_receber
                   where status not in ('pago','cancelado') and vencimento < current_date
                     and (_centro is null or centro_id = _centro)),
    'a_pagar', (select coalesce(sum(valor + juros + multa + acrescimo - desconto - coalesce(valor_pago,0)),0)
                    from public.contas_pagar
                   where status not in ('pago','cancelado') and (_centro is null or centro_id = _centro)),
    'a_pagar_vencido', (select coalesce(sum(valor + juros + multa + acrescimo - desconto - coalesce(valor_pago,0)),0)
                    from public.contas_pagar
                   where status not in ('pago','cancelado') and vencimento < current_date
                     and (_centro is null or centro_id = _centro)),
    'recebido_mes', (select coalesce(sum(valor),0) from public.movimentos_financeiros
                      where status='ativo' and tipo='entrada' and origem='recebimento'
                        and data >= date_trunc('month', current_date)::date
                        and (_centro is null or centro_id = _centro)),
    'pago_mes', (select coalesce(sum(valor),0) from public.movimentos_financeiros
                      where status='ativo' and tipo='saida' and origem='pagamento'
                        and data >= date_trunc('month', current_date)::date
                        and (_centro is null or centro_id = _centro)),
    'faturamento_mes', (select coalesce(sum(total_liquido),0) from public.pedidos
                      where status not in ('rascunho','cancelado','recusado')
                        and data_pedido >= date_trunc('month', current_date)::date
                        and (_centro is null or centro_id = _centro)),
    'custo_mes', (select coalesce(sum(custo),0) from public.vw_cpv
                      where data >= date_trunc('month', current_date)::date
                        and (_centro is null or centro_id = _centro)),
    'recebimentos_hoje', (select coalesce(sum(valor + juros + multa + acrescimo - desconto - coalesce(valor_pago,0)),0)
                    from public.contas_receber
                   where status not in ('pago','cancelado') and vencimento = current_date
                     and (_centro is null or centro_id = _centro))
  );
$$;

grant execute on function public.dashboard_financeiro(uuid) to authenticated;

-- ---------- fim da fase 34 ----------
