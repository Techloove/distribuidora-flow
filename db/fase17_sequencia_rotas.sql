-- Fase 17: sequência de rotas para ordenar a separação
alter table public.rotas add column if not exists sequencia integer;

-- numera as rotas existentes que ainda não têm sequência
with ordenadas as (
  select id, row_number() over (order by codigo, nome) as n
    from public.rotas
   where sequencia is null
)
update public.rotas r set sequencia = o.n
  from ordenadas o
 where r.id = o.id;

create index if not exists rotas_sequencia_idx on public.rotas(sequencia);

-- view de separação passa a expor a sequência da rota e a sequência do cliente na rota
create or replace view public.vw_separacao as
select p.id as pedido_id, p.numero, p.status, p.centro_id, c.nome as centro,
       cli.razao_social as cliente, p.onda_id,
       pr.id as produto_id, pr.codigo as produto_codigo, pr.descricao as produto,
       sum(pi.quantidade) as quantidade, pr.estoque_atual,
       r.nome as rota, r.sequencia as rota_sequencia,
       cli.sequencia_entrega as sequencia_entrega
  from public.pedidos p
  join public.pedido_itens pi on pi.pedido_id = p.id
  join public.produtos pr on pr.id = pi.produto_id
  left join public.clientes cli on cli.id = p.cliente_id
  left join public.centros c on c.id = p.centro_id
  left join public.rotas r on r.id = p.rota_id
 where p.status in ('aprovado','confirmado','separacao','separado')
 group by p.id, p.numero, p.status, p.centro_id, c.nome, cli.razao_social, p.onda_id,
          pr.id, pr.codigo, pr.descricao, pr.estoque_atual, r.nome, r.sequencia,
          cli.sequencia_entrega;
grant select on public.vw_separacao to authenticated;
