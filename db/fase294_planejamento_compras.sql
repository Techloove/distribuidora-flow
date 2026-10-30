-- Planejamento somente leitura por loja. Não cria compras nem movimenta estoque/financeiro.
begin;
create or replace view public.vw_planejamento_compras_294
with(security_invoker=on,security_barrier=on) as
with referencia as (select (now() at time zone 'America/Sao_Paulo')::date hoje),
retornos as (
 select d.pedido_id,di.produto_id,sum(di.quantidade) quantidade
 from public.devolucoes d join public.devolucao_itens di on di.devolucao_id=d.id
 where d.status='confirmada' group by d.pedido_id,di.produto_id
),
itens_vendidos as (
 select ped.id,ped.centro_id,ped.data_pedido,pi.produto_id,sum(pi.quantidade) quantidade
 from public.pedidos ped join public.pedido_itens pi on pi.pedido_id=ped.id cross join referencia r
 where ped.status in('aprovado','confirmado','separacao','separado','conferido','faturado','nf_emitida','em_carga','em_rota','entregue','parcial','nao_entregue','devolvido')
 and ped.data_pedido<=r.hoje
 group by ped.id,ped.centro_id,ped.data_pedido,pi.produto_id
),
vendas as (
 select v.centro_id,v.produto_id,min(v.data_pedido) primeira_venda,
 coalesce(sum(greatest(v.quantidade-coalesce(d.quantidade,0),0)) filter(where v.data_pedido>=r.hoje-29),0) venda_30,
 coalesce(sum(greatest(v.quantidade-coalesce(d.quantidade,0),0)) filter(where v.data_pedido>=r.hoje-59),0) venda_60,
 coalesce(sum(greatest(v.quantidade-coalesce(d.quantidade,0),0)) filter(where v.data_pedido>=r.hoje-89),0) venda_90,
 coalesce(sum(greatest(v.quantidade-coalesce(d.quantidade,0),0)) filter(where v.data_pedido>=r.hoje-119),0) venda_120
 from itens_vendidos v left join retornos d on d.pedido_id=v.id and d.produto_id=v.produto_id cross join referencia r
 group by v.centro_id,v.produto_id
),
pendencias as (
 select ped.centro_id,pi.produto_id,
 sum(pi.quantidade) aprovadas
 from public.pedidos ped join public.pedido_itens pi on pi.pedido_id=ped.id
 where ped.status='aprovado'
 group by ped.centro_id,pi.produto_id
),
transito as (
 select cp.centro_id,ci.produto_id,sum(ci.quantidade) quantidade
 from public.compras cp join public.compra_itens ci on ci.compra_id=cp.id
 where cp.status='comprado' group by cp.centro_id,ci.produto_id
),
fornecedor_anterior as (
 select distinct on(cp.centro_id,ci.produto_id) cp.centro_id,ci.produto_id,f.razao_social fornecedor
 from public.compras cp join public.compra_itens ci on ci.compra_id=cp.id
 join public.fornecedores f on f.id=cp.fornecedor_id
 where cp.status in('comprado','recebida')
 order by cp.centro_id,ci.produto_id,cp.data_entrada desc nulls last,cp.created_at desc,cp.id desc
)
select p.id produto_id,p.codigo,p.descricao,p.unidade,p.grupo,p.marca,c.id centro_id,c.nome centro,
 coalesce(s.quantidade,0)::numeric(14,3) estoque_atual,
 coalesce(pe.aprovadas,0)::numeric(14,3) pendencia_aprovada,
 coalesce(t.quantidade,0)::numeric(14,3) em_transito,
 coalesce(p.estoque_minimo,0) estoque_minimo,coalesce(p.estoque_maximo,0) estoque_maximo,
 greatest(coalesce(p.prazo_fornecedor_dias,0),0) prazo_fornecedor_dias,
 coalesce(v.venda_30,0)::numeric(14,3) venda_30,coalesce(v.venda_60,0)::numeric(14,3) venda_60,
 coalesce(v.venda_90,0)::numeric(14,3) venda_90,coalesce(v.venda_120,0)::numeric(14,3) venda_120,
 v.primeira_venda,
 case when v.primeira_venda is null then 0 else least(r.hoje-v.primeira_venda+1,120) end dias_historico,
 case when p.ultimo_custo>0 then p.ultimo_custo when p.custo_medio>0 then p.custo_medio else null end custo_referencia,
 case when p.ultimo_custo>0 then 'Último custo de compra' when p.custo_medio>0 then 'Custo médio' else 'Sem custo informado' end origem_custo,
 f.fornecedor,r.hoje data_referencia
from public.produtos p cross join public.centros c cross join referencia r
left join public.estoque_saldos s on s.produto_id=p.id and s.centro_id=c.id
left join vendas v on v.produto_id=p.id and v.centro_id=c.id
left join pendencias pe on pe.produto_id=p.id and pe.centro_id=c.id
left join transito t on t.produto_id=p.id and t.centro_id=c.id
left join fornecedor_anterior f on f.produto_id=p.id and f.centro_id=c.id
where p.ativo and c.ativo and public.pode_rotina('compras_planejar') and public.usuario_pode_acessar_centro(c.id)
and exists(select 1 from public.cad_categorias k where k.id=c.categoria_produtos_id and k.nome_norm=public.norm_txt(p.categoria));
revoke all on public.vw_planejamento_compras_294 from public,anon,authenticated;
grant select on public.vw_planejamento_compras_294 to authenticated,service_role;
notify pgrst,'reload schema';
commit;
