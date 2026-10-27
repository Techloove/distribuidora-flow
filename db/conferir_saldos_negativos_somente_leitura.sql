-- SOMENTE LEITURA: identifica saldos negativos, sem ajustar estoque ou permissões.
-- Execute no SQL Editor administrativo do Supabase e confira com a contagem física.
select
  c.nome as loja,
  p.codigo,
  p.descricao as produto,
  p.categoria,
  s.quantidade as saldo_da_loja,
  p.estoque_atual as saldo_total_do_produto,
  p.permite_estoque_negativo as negativo_autorizado_no_cadastro,
  coalesce((select sum(r.quantidade) from public.estoque_reservas r
    where r.produto_id=p.id and r.centro_id=c.id),0) as reservado,
  coalesce((select sum(ds.quantidade) from public.deposito_saldos ds
    join public.depositos d on d.id=ds.deposito_id
    where ds.produto_id=p.id and d.centro_id=c.id),0) as saldo_dos_depositos,
  p.id as produto_id,
  c.id as loja_id
from public.estoque_saldos s
join public.produtos p on p.id=s.produto_id
join public.centros c on c.id=s.centro_id
where s.quantidade<0
order by c.nome,p.descricao,p.codigo;
