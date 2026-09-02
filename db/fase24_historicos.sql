-- Fase 24: históricos de compras do cliente e movimentação por produto.

create or replace view public.vw_historico_cliente as
select
  c.pessoa_id,
  c.id as cliente_id,
  p.id as pedido_id,
  p.numero as pedido_numero,
  p.data_pedido,
  p.status,
  p.total_itens,
  p.desconto_valor,
  p.total_liquido,
  coalesce(i.qtd_itens, 0) as qtd_itens,
  coalesce(i.quantidade_total, 0) as quantidade_total
from public.pedidos p
join public.clientes c on c.id = p.cliente_id
left join (
  select pedido_id, count(*) as qtd_itens, sum(quantidade) as quantidade_total
  from public.pedido_itens
  group by pedido_id
) i on i.pedido_id = p.id;

grant select on public.vw_historico_cliente to authenticated;

create or replace view public.vw_historico_produto as
select
  pi.produto_id,
  'venda'::text as tipo,
  p.id as documento_id,
  p.numero as documento_numero,
  p.data_pedido as data,
  p.status,
  coalesce(cl.razao_social, '') as parceiro,
  pi.quantidade,
  pi.preco_unitario as valor_unitario,
  pi.total
from public.pedido_itens pi
join public.pedidos p on p.id = pi.pedido_id
left join public.clientes cl on cl.id = p.cliente_id
union all
select
  ci.produto_id,
  'compra'::text as tipo,
  c.id as documento_id,
  c.numero as documento_numero,
  coalesce(c.data_entrada, c.data_emissao) as data,
  c.status,
  coalesce(f.razao_social, '') as parceiro,
  ci.quantidade,
  ci.custo_unitario as valor_unitario,
  ci.total
from public.compra_itens ci
join public.compras c on c.id = ci.compra_id
left join public.fornecedores f on f.id = c.fornecedor_id;

grant select on public.vw_historico_produto to authenticated;
