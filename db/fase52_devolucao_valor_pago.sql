-- Fase 52: devolução usa o valor efetivamente pago pelo cliente no pedido
-- (preço do item com descontos/acréscimos do pedido e da forma de pagamento, sem frete).
create or replace function public.devolucao_itens_calc()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  preco_pago numeric;
begin
  select round(
           (sum(pi.total) / nullif(sum(pi.quantidade), 0))
           * ((p.total_liquido - p.frete_valor) / nullif(p.total_itens, 0)), 2)
    into preco_pago
    from public.devolucoes d
    join public.pedidos p on p.id = d.pedido_id
    join public.pedido_itens pi on pi.pedido_id = p.id and pi.produto_id = new.produto_id
   where d.id = new.devolucao_id
   group by p.total_liquido, p.frete_valor, p.total_itens;

  if preco_pago is not null and preco_pago > 0 then
    new.preco_unitario := preco_pago;
  end if;

  new.total := round(new.quantidade * new.preco_unitario, 2);
  return new;
end;
$$;
