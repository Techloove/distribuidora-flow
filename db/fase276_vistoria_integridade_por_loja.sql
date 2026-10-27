-- Execute este SQL inteiro manualmente no Supabase. Apenas atualiza consultas de diagnóstico.
-- Não altera cadastros, preços, estoque, pedidos, títulos ou documentos fiscais.
begin;
do $$begin
 if to_regprocedure('public.loja_produto_estoque_271(uuid)') is null
 or to_regprocedure('public.salvar_observacoes_pedido_274(uuid,text,text)') is null
 or to_regprocedure('public.sincronizar_preco_produto_275()') is null then
   raise exception 'Confira as fases271,274 e275 antes da fase276';
 end if;
end $$;
create or replace function public.diagnostico_integridade_220()
returns table(verificacao text,pendencias bigint)
language plpgsql stable security definer set search_path=public as $$
begin
 if auth.uid() is null or not coalesce(public.usuario_ativo(),false)
 or not coalesce(public.pode_rotina('integridade_ver'),false)
 or not coalesce(public.can_manage(auth.uid()),false) then
   raise exception 'Diagnóstico restrito à gestão ativa e autorizada';end if;
 -- INICIO CONSULTA276 (também usada pelo diagnóstico SQL somente leitura).
 return query
 with lojas as (
   select c.id from public.centros c
   where auth.uid() is null or public.usuario_pode_acessar_centro(c.id)
 ), produtos_escopo as (
   select p.* from public.produtos p
   where auth.uid() is null or public.loja_produto_estoque_271(p.id) in(select id from lojas)
   or exists(select 1 from public.estoque_saldos s where s.produto_id=p.id and s.quantidade<>0 and s.centro_id in(select id from lojas))
 ), pedidos_escopo as (
   select p.* from public.pedidos p where p.centro_id in(select id from lojas)
   and (auth.uid() is null or not public.escopo_representante() or public.documento_na_minha_carteira('pedidos',p.id))
 ), compras_escopo as (
   select c.* from public.compras c where c.centro_id in(select id from lojas)
 ), reservas as (
   select r.produto_id,r.centro_id,sum(r.quantidade) quantidade
   from public.estoque_reservas r where r.centro_id in(select id from lojas)
   group by r.produto_id,r.centro_id
 ), depositos_soma as (
   select s.produto_id,d.centro_id,sum(s.quantidade) quantidade
   from public.deposito_saldos s join public.depositos d on d.id=s.deposito_id
   where d.centro_id in(select id from lojas) group by s.produto_id,d.centro_id
 ), posicoes as (
   select s.produto_id,s.centro_id,s.quantidade,coalesce(d.quantidade,0) deposito
   from public.estoque_saldos s left join depositos_soma d using(produto_id,centro_id)
   where s.centro_id in(select id from lojas)
   union all
   select d.produto_id,d.centro_id,0,d.quantidade from depositos_soma d
   where not exists(select 1 from public.estoque_saldos s where s.produto_id=d.produto_id and s.centro_id=d.centro_id)
 )
 select 'Atenção: estoque negativo sem permissão do produto'::text as verificacao,count(*) as pendencias
 from public.estoque_saldos s join public.produtos p on p.id=s.produto_id
 where s.centro_id in(select id from lojas) and s.quantidade<0 and not coalesce(p.permite_estoque_negativo,false)
 union all
 select 'Operação: estoque negativo permitido pelo cadastro',count(*)
 from public.estoque_saldos s join public.produtos p on p.id=s.produto_id
 where s.centro_id in(select id from lojas) and s.quantidade<0 and coalesce(p.permite_estoque_negativo,false)
 union all
 select 'Atenção: reservas acima do saldo da própria loja',count(*)
 from reservas r left join public.estoque_saldos s using(produto_id,centro_id)
 where r.quantidade>0 and r.quantidade>greatest(coalesce(s.quantidade,0),0)
 union all
 select 'Atenção: saldo da loja diferente dos depósitos',count(*) from posicoes where quantidade<>deposito
 union all
 select 'Atenção: saldo total do produto diferente da soma das lojas',count(*) from produtos_escopo p
 where coalesce(p.estoque_atual,0)<>coalesce((select sum(s.quantidade) from public.estoque_saldos s where s.produto_id=p.id),0)
 union all
 select 'Atenção: saldo em loja incompatível com a categoria',count(*) from public.estoque_saldos s
 where s.centro_id in(select id from lojas) and s.quantidade<>0
 and s.centro_id is distinct from public.loja_produto_estoque_271(s.produto_id)
 union all
 select 'Atenção: reservas sem vínculo válido com pedido e loja',count(*)
 from public.estoque_reservas r left join public.pedidos p on p.id=r.pedido_id
 where r.centro_id in(select id from lojas) and (
   p.id is null or p.status is distinct from 'aprovado' or p.centro_id is distinct from r.centro_id
   or r.centro_id is distinct from public.loja_produto_estoque_271(r.produto_id)
   or r.quantidade is distinct from (select sum(i.quantidade) from public.pedido_itens i where i.pedido_id=r.pedido_id and i.produto_id=r.produto_id))
 union all
 select 'Atenção: preço normal do catálogo diferente de Produtos',count(*)
 from public.loja_produtos l join public.produtos p on p.id=l.produto_id
 where l.centro_id in(select id from lojas) and l.centro_id=public.loja_produto_estoque_271(p.id)
 and l.preco_venda is distinct from p.preco_venda
 union all
 select 'Atenção: títulos a receber em loja diferente do pedido',count(*)
 from public.contas_receber t join pedidos_escopo p on p.id=t.pedido_id
 where t.centro_id is distinct from p.centro_id
 union all
 select 'Atenção: títulos a pagar em loja diferente da compra',count(*)
 from public.contas_pagar t join compras_escopo c on c.id=t.compra_id
 where t.centro_id is distinct from c.centro_id
 union all
 select 'Atenção: parcelas ativas duplicadas por pedido',count(*) from (
   select t.pedido_id,t.parcela from public.contas_receber t join pedidos_escopo p on p.id=t.pedido_id
   where t.status<>'cancelado' group by t.pedido_id,t.parcela having count(*)>1
 ) x
 union all
 select 'Atenção: parcelas ativas duplicadas por compra',count(*) from (
   select t.compra_id,t.parcela from public.contas_pagar t join compras_escopo c on c.id=t.compra_id
   where t.status<>'cancelado' group by t.compra_id,t.parcela having count(*)>1
 ) x
 union all
 select 'Revisar: pedidos confirmados sem baixa de estoque registrada',count(*) from pedidos_escopo p
 where p.status in('confirmado','separacao','separado','conferido','faturado','nf_emitida','em_carga','em_rota','entregue','parcial','nao_entregue')
 and p.tipo_documento='pedido' and p.status_regularizado_em is null
 and exists(select 1 from public.auditoria a where a.tabela='pedidos' and a.registro_id=p.id and a.acao='confirmar')
 and not exists(select 1 from public.estoque_movimentos m where m.origem='pedido' and m.documento_id=p.id and m.tipo='saida')
 union all
 select 'Revisar: pedidos confirmados sem recebíveis ou cobertura por crédito',count(*) from pedidos_escopo p
 where p.status in('confirmado','separacao','separado','conferido','faturado','nf_emitida','em_carga','em_rota','entregue','parcial','nao_entregue')
 and p.tipo_documento='pedido' and p.status_regularizado_em is null
 and exists(select 1 from public.auditoria a where a.tabela='pedidos' and a.registro_id=p.id and a.acao='confirmar')
 and p.total_liquido>coalesce((select sum(c.valor) from public.creditos_clientes_aplicacoes c where c.pedido_id=p.id and c.status='aplicado'),0)+0.01
 and not exists(select 1 from public.contas_receber t where t.pedido_id=p.id and t.status<>'cancelado')
 and not exists(select 1 from public.devolucoes d where d.pedido_id=p.id)
 union all
 select 'Operação: inventários em contagem',count(*) from public.inventarios i join public.depositos d on d.id=i.deposito_id
 where i.status='contagem' and d.centro_id in(select id from lojas)
 union all
 select 'Operação: recusas aguardando retorno conferido',count(distinct d.id)
 from public.devolucoes d join public.entrega_itens t on t.devolucao_id=d.id
 where d.status is distinct from 'confirmada' and d.centro_id in(select id from lojas)
 and (auth.uid() is null or not public.escopo_representante() or public.documento_na_minha_carteira('devolucoes',d.id));
 -- FIM CONSULTA276
end $$;
revoke all on function public.diagnostico_integridade_220() from public,anon;
grant execute on function public.diagnostico_integridade_220() to authenticated;
commit;
