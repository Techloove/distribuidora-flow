-- Fase 51: correção de inconsistências encontradas na auditoria de integração.
-- Idempotente: cada correção só é aplicada se ainda for necessária.
begin;

-- 1) Pedido 5: baixa de estoque e contas a receber que faltaram (Boleto 30/60/90)
insert into public.estoque_movimentos (produto_id, centro_id, tipo, quantidade, origem, documento_id, observacao)
select pi.produto_id, p.centro_id, 'saida', pi.quantidade, 'pedido', p.id, 'Correção fase 51 - baixa não registrada'
  from public.pedidos p join public.pedido_itens pi on pi.pedido_id = p.id
 where p.numero = 5
   and not exists (select 1 from public.estoque_movimentos m where m.documento_id = p.id);

insert into public.contas_receber (cliente_id, pedido_id, documento, parcela, valor, vencimento, centro_id, data_emissao, forma_pagamento_id, descricao)
select p.cliente_id, p.id, 'PED-5', g.n,
       case when g.n = 3 then p.total_liquido - 2 * round(p.total_liquido / 3, 2) else round(p.total_liquido / 3, 2) end,
       p.data_pedido + g.n * 30, p.centro_id, p.data_pedido, p.forma_pagamento_id, 'Pedido 5 - parcela ' || g.n
  from public.pedidos p cross join generate_series(1, 3) g(n)
 where p.numero = 5
   and not exists (select 1 from public.contas_receber c where c.pedido_id = p.id);

-- 2) Pedido 13: parcelas em aberto recalculadas para bater com o total (231,00)
update public.contas_receber c
   set valor = case when c.parcela = 3 then 77.00 else 77.00 end
  from public.pedidos p
 where p.id = c.pedido_id and p.numero = 13 and c.status = 'aberto'
   and (select sum(valor) from public.contas_receber x where x.pedido_id = p.id and x.status <> 'cancelado') <> p.total_liquido;

-- 3) Ajuste de histórico de estoque: saldo atual é mantido, movimentos passam a somar o saldo
do $$
declare r record; saldo numeric;
begin
  for r in
    select pr.id, pr.estoque_atual,
           coalesce(pr.estoque_atual, 0) - coalesce((select sum(case when tipo='entrada' then abs(quantidade)
                     when tipo='saida' then -abs(quantidade) else quantidade end)
                  from public.estoque_movimentos m where m.produto_id = pr.id), 0) as dif
      from public.produtos pr
  loop
    if abs(r.dif) > 0.001 then
      saldo := r.estoque_atual;
      insert into public.estoque_movimentos (produto_id, tipo, quantidade, origem, observacao)
      values (r.id, 'ajuste', r.dif, 'ajuste', 'Saldo inicial / conciliação (fase 51)');
      update public.produtos set estoque_atual = saldo where id = r.id;
    end if;
  end loop;
end $$;

-- 4) Rota do pedido conforme cadastro do cliente, quando faltar
update public.pedidos p set rota_id = c.rota_id
  from public.clientes c
 where c.id = p.cliente_id and p.rota_id is null and c.rota_id is not null and p.status <> 'rascunho';

commit;
