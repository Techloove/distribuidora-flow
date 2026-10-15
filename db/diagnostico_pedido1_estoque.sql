-- Somente leitura: saldo e política dos produtos do pedido número1.
with itens as (
  select pedido_id,produto_id,sum(quantidade) quantidade
  from public.pedido_itens group by pedido_id,produto_id
)
select p.numero,p.id pedido_id,p.status,c.nome centro,
  pr.descricao produto,i.quantidade quantidade_pedido,
  coalesce(s.quantidade,0) saldo_no_centro,
  coalesce(r.quantidade,0) reservado_outros_pedidos,
  coalesce(s.quantidade,0)-coalesce(r.quantidade,0) disponivel,
  coalesce(pr.permite_estoque_negativo,false) permite_venda_negativa
from public.pedidos p
join itens i on i.pedido_id=p.id
join public.produtos pr on pr.id=i.produto_id
left join public.centros c on c.id=p.centro_id
left join public.estoque_saldos s on s.centro_id=p.centro_id and s.produto_id=i.produto_id
left join lateral (
  select sum(quantidade) quantidade from public.estoque_reservas
  where centro_id=p.centro_id and produto_id=i.produto_id and pedido_id<>p.id
) r on true
where p.numero=1
order by p.id,pr.descricao;
