-- Somente leitura. Execute antes de corrigir vencimentos já gerados.
select p.id pedido_id,p.numero,p.status,p.data_pedido,p.parcelas,
 f.nome forma,f.parcelas_padrao,f.dias_primeira_parcela,f.intervalo_dias,
 t.id titulo_id,t.parcela,t.valor,t.valor_pago,t.status status_titulo,
 t.vencimento vencimento_atual,
 p.data_pedido+(f.dias_primeira_parcela+(t.parcela-1)*f.intervalo_dias) vencimento_conforme_forma,
 exists(select 1 from public.boletos b where b.conta_receber_id=t.id) possui_registro_boleto
from public.pedidos p
left join public.formas_pagamento f on f.id=p.forma_pagamento_id
left join public.contas_receber t on t.pedido_id=p.id
where p.numero=1
order by p.id,t.parcela,t.id;
