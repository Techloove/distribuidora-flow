-- SOMENTE LEITURA: investigar a origem dos saldos atualmente negativos.
-- Execute no SQL Editor administrativo do Supabase e exporte o resultado CSV.
-- O histórico é somado por produto em TODAS as lojas: houve redistribuição na fase271.
-- Diferença entre saldo atual e histórico NÃO prova erro: pode existir saldo inicial/legado.
-- Não recebe compras, não confirma pedidos e não ajusta saldo ou permissão.
with alvos as (
  select s.produto_id,s.centro_id,c.nome as loja,p.codigo,p.descricao as produto,
    p.unidade,p.permite_estoque_negativo,s.quantidade as saldo_da_loja,
    p.estoque_atual as saldo_total_do_produto
  from public.estoque_saldos s
  join public.produtos p on p.id=s.produto_id
  join public.centros c on c.id=s.centro_id
  where s.quantidade<0
), movimentos as (
  select m.*,
    case when m.tipo='entrada' then abs(m.quantidade)
         when m.tipo='saida' then -abs(m.quantidade)
         else m.quantidade end as delta
  from public.estoque_movimentos m
  where exists(select 1 from alvos a where a.produto_id=m.produto_id)
), totais as (
  select produto_id,count(*) as quantidade_de_movimentos,
    coalesce(sum(abs(quantidade)) filter(where tipo='entrada'),0) as entradas_registradas,
    coalesce(sum(abs(quantidade)) filter(where tipo='saida'),0) as saidas_registradas,
    coalesce(sum(quantidade) filter(where tipo='ajuste'),0) as ajustes_liquidos,
    sum(delta) as saldo_dos_movimentos,
    min(created_at) as primeiro_movimento,max(created_at) as ultimo_movimento
  from movimentos group by produto_id
), itens_compra as (
  select i.compra_id,i.produto_id,sum(i.quantidade) as quantidade
  from public.compra_itens i
  where exists(select 1 from alvos a where a.produto_id=i.produto_id)
  group by i.compra_id,i.produto_id
), compras as (
  select i.produto_id,c.id,c.numero,c.status,c.centro_id,c.data_entrada,
    i.quantidade,
    coalesce((select sum(abs(m.quantidade)) from movimentos m
      where m.produto_id=i.produto_id and m.documento_id=c.id
      and m.origem='compra' and m.tipo='entrada'),0) as entrada_registrada
  from itens_compra i join public.compras c on c.id=i.compra_id
)
select
  a.loja,a.codigo,a.produto,a.unidade,a.permite_estoque_negativo,
  a.saldo_da_loja,a.saldo_total_do_produto,
  coalesce(t.quantidade_de_movimentos,0) as quantidade_de_movimentos,
  coalesce(t.entradas_registradas,0) as entradas_registradas_todas_as_lojas,
  coalesce(t.saidas_registradas,0) as saidas_registradas_todas_as_lojas,
  coalesce(t.ajustes_liquidos,0) as ajustes_liquidos_todas_as_lojas,
  coalesce(t.saldo_dos_movimentos,0) as saldo_dos_movimentos_todas_as_lojas,
  a.saldo_total_do_produto-coalesce(t.saldo_dos_movimentos,0) as diferenca_saldo_atual_menos_historico,
  t.primeiro_movimento at time zone 'America/Sao_Paulo' as primeiro_movimento_brasilia,
  t.ultimo_movimento at time zone 'America/Sao_Paulo' as ultimo_movimento_brasilia,
  (select count(*) from movimentos m where m.produto_id=a.produto_id
    and m.centro_id is distinct from a.centro_id) as movimentos_em_outras_lojas_ou_sem_loja,
  coalesce((select jsonb_agg(jsonb_build_object(
    'compra',c.numero,'compra_id',c.id,'loja_id',c.centro_id,'data',c.data_entrada,
    'quantidade',c.quantidade,'entrada_registrada',c.entrada_registrada) order by c.data_entrada,c.id)
    from compras c where c.produto_id=a.produto_id and c.status='comprado'), '[]'::jsonb)
    as compras_aguardando_recebimento_conferir_entrega_fisica,
  coalesce((select jsonb_agg(jsonb_build_object(
    'compra',c.numero,'compra_id',c.id,'loja_id',c.centro_id,'data',c.data_entrada,
    'quantidade',c.quantidade,'entrada_registrada',c.entrada_registrada) order by c.data_entrada,c.id)
    from compras c where c.produto_id=a.produto_id and c.status='recebida'
    and c.quantidade is distinct from c.entrada_registrada),'[]'::jsonb)
    as compras_recebidas_com_quantidade_divergente_revisar_legado,
  coalesce((select jsonb_agg(jsonb_build_object(
    'movimento_id',m.id,'data_brasilia',m.created_at at time zone 'America/Sao_Paulo',
    'tipo',m.tipo,'quantidade',m.quantidade,'efeito_no_saldo',m.delta,
    'origem',m.origem,'loja_id',m.centro_id,'documento_id',m.documento_id,
    'observacao',m.observacao) order by m.created_at desc,m.id desc)
    from (select m.* from movimentos m where m.produto_id=a.produto_id
      order by m.created_at desc,m.id desc limit 15) m),'[]'::jsonb) as ultimos_15_movimentos,
  a.produto_id,a.centro_id as loja_id
from alvos a left join totais t on t.produto_id=a.produto_id
order by a.loja,a.produto,a.produto_id;
