-- Vistoria somente leitura. Executar com read_only:true na API administrativa.
-- Valores são confrontados com o próprio documento, sem reprecificar vendas históricas.
with itens as (
 select i.pedido_id,count(*) quantidade_itens,round(sum(coalesce(i.total,0)),2) soma,
 count(*) filter(where abs(coalesce(i.total,0)-round(i.quantidade*i.preco_unitario*(1-coalesce(i.desconto_percentual,0)/100),2))>0.01) divergencias_total,
 count(*) filter(where coalesce(i.quantidade,0)<=0 or coalesce(i.preco_unitario,0)<0 or coalesce(i.desconto_percentual,0) not between 0 and 100) itens_invalidos,
 sum(i.quantidade*i.custo_unitario_base) custo_gravado,
 count(*) filter(where i.custo_unitario_base is null) custos_nao_gravados
 from public.pedido_itens i group by i.pedido_id
), base as (
 select p.*,coalesce(i.quantidade_itens,0) quantidade_itens,coalesce(i.soma,0) soma_itens,
 coalesce(i.divergencias_total,0) divergencias_itens,coalesce(i.itens_invalidos,0) itens_invalidos,
 i.custo_gravado,coalesce(i.custos_nao_gravados,0) custos_nao_gravados,
 greatest(coalesce(i.soma,0)-coalesce(p.desconto_valor,0),0) base_calculo
 from public.pedidos p left join itens i on i.pedido_id=p.id
), totais as (
 select b.*,greatest(base_calculo+coalesce(frete_valor,0)+coalesce(forma_acrescimo_valor,0)-coalesce(forma_desconto_valor,0)+coalesce(frete_volume_valor,0)+coalesce(outras_despesas,0),0) total_esperado
 from base b
), operacionais as (
 select * from totais where tipo_documento='pedido' and status in('confirmado','separacao','separado','conferido','faturado','nf_emitida','em_carga','em_rota','entregue','parcial','nao_entregue')
), financeiros as (
 select p.id,p.numero,p.status,p.modalidade_venda,p.total_liquido,p.ciclo_reabertura_289,
 coalesce((select sum(t.valor) from contas_receber t where t.pedido_id=p.id and t.status<>'cancelado' and coalesce(t.ciclo_pedido_289,0)=coalesce(p.ciclo_reabertura_289,0)),0) valor_titulos,
 coalesce((select sum(a.valor) from creditos_clientes_aplicacoes a where a.pedido_id=p.id and a.status='aplicado'),0) credito_aplicado,
 exists(select 1 from devolucoes d where d.pedido_id=p.id) possui_devolucao,
 exists(select 1 from contas_receber t where t.pedido_id=p.id and t.acordo_id is not null) possui_renegociacao
 from operacionais p
), custos as (
 select p.id,p.numero,p.status,p.modalidade_venda,
 sum(i.quantidade*i.custo_unitario_base) gravado,
 sum(i.quantidade*coalesce(pr.custo_medio,pr.preco_custo,pr.ultimo_custo,0)) cadastro,
 count(*) filter(where i.custo_unitario_base is null) sem_snapshot
 from operacionais p join pedido_itens i on i.pedido_id=p.id join produtos pr on pr.id=i.produto_id
 where p.modalidade_venda='estoque' group by p.id,p.numero,p.status,p.modalidade_venda
)
select jsonb_build_object(
 'conexao',jsonb_build_object('usuario_sql',current_user,'pedidos_visiveis',(select count(*) from pedidos),'produtos_visiveis',(select count(*) from produtos)),
 'situacoes',(select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from (select tipo_documento,modalidade_venda,status,count(*) quantidade from pedidos group by 1,2,3 order by 1,2,3) s),
 'resumo',jsonb_build_object(
   'pedidos',(select count(*) from pedidos),
   'itens_com_total_divergente',(select coalesce(sum(divergencias_total),0) from itens),
   'itens_com_quantidade_preco_desconto_invalidos',(select coalesce(sum(itens_invalidos),0) from itens),
   'pedidos_com_total_itens_divergente',(select count(*) from totais where abs(coalesce(total_itens,0)-soma_itens)>0.01),
   'pedidos_com_total_liquido_divergente',(select count(*) from totais where abs(coalesce(total_liquido,0)-total_esperado)>0.01),
   'titulo_em_loja_diferente_pedido',(select count(*) from contas_receber t join pedidos p on p.id=t.pedido_id where t.centro_id is distinct from p.centro_id),
   'titulo_em_cliente_diferente_pedido',(select count(*) from contas_receber t join pedidos p on p.id=t.pedido_id where t.cliente_id is distinct from p.cliente_id),
   'parcelas_ativas_duplicadas',(select count(*) from (select t.pedido_id,t.ciclo_pedido_289,t.parcela from contas_receber t where t.pedido_id is not null and t.status<>'cancelado' and t.acordo_id is null group by 1,2,3 having count(*)>1) d),
   'estoque_confirmado_sem_custo_gravado',(select count(*) from custos where sem_snapshot>0),
   'estoque_com_custo_atual_diferente_gravado',(select count(*) from custos where sem_snapshot=0 and abs(coalesce(gravado,0)-coalesce(cadastro,0))>0.01),
   'financeiro_divergente_sem_devolucao_renegociacao',(select count(*) from financeiros where not possui_devolucao and not possui_renegociacao and abs(total_liquido-credito_aplicado-valor_titulos)>0.01),
   'intermediacao_com_saida_estoque',(select count(distinct p.id) from pedidos p join estoque_movimentos m on m.documento_id=p.id and m.origem='pedido' and m.tipo='saida' where p.modalidade_venda='intermediacao')
 ),
 'revisar_totais',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select numero,tipo_documento,status,total_itens,soma_itens,total_liquido,total_esperado from totais where abs(coalesce(total_itens,0)-soma_itens)>0.01 or abs(coalesce(total_liquido,0)-total_esperado)>0.01 order by numero limit 100) r),
 'revisar_financeiro',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select numero,status,modalidade_venda,total_liquido,valor_titulos,credito_aplicado from financeiros where not possui_devolucao and not possui_renegociacao and abs(total_liquido-credito_aplicado-valor_titulos)>0.01 order by numero limit 100) r),
 'comparacao_custos',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select numero,status,gravado,cadastro,sem_snapshot from custos where sem_snapshot>0 or abs(coalesce(gravado,0)-coalesce(cadastro,0))>0.01 order by numero limit 100) r)
) resultado;
