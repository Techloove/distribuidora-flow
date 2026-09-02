-- Fase 20: expõe a data limite da promoção e a lista de produtos em promoção.

create or replace function public.preco_produto_info(_produto_id uuid, _cliente_id uuid default null)
returns table (
  preco numeric,
  preco_normal numeric,
  tabela_nome text,
  vigencia_inicio date,
  vigencia_fim date,
  promocao boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  cli record;
  normal numeric;
begin
  select * into cli from public.clientes where id = _cliente_id;
  select p.preco_venda into normal from public.produtos p where p.id = _produto_id;

  return query
  select i.preco,
         coalesce(normal, 0) as preco_normal,
         t.nome::text,
         t.vigencia_inicio,
         t.vigencia_fim,
         true as promocao
  from public.tabela_preco_itens i
  join public.tabelas_preco t on t.id = i.tabela_id
  where i.produto_id = _produto_id
    and t.ativo
    and t.vigencia_inicio <= current_date
    and (t.vigencia_fim is null or t.vigencia_fim >= current_date)
    and (t.cliente_id is null or t.cliente_id = _cliente_id)
    and (t.uf is null or t.uf = coalesce(cli.uf, t.uf))
  order by (t.cliente_id is not null) desc, (t.uf is not null) desc, t.prioridade desc
  limit 1;

  if not found then
    return query select coalesce(normal, 0), coalesce(normal, 0), null::text, null::date, null::date, false;
  end if;
end;
$$;

grant execute on function public.preco_produto_info(uuid, uuid) to authenticated;

create or replace view public.vw_promocoes as
select i.id                as item_id,
       t.id                as tabela_id,
       t.nome              as tabela_nome,
       t.ativo,
       t.cliente_id,
       t.uf,
       t.prioridade,
       t.vigencia_inicio,
       t.vigencia_fim,
       p.id                as produto_id,
       p.codigo            as produto_codigo,
       p.descricao         as produto_descricao,
       p.preco_venda       as preco_normal,
       i.preco             as preco_promocional,
       i.desconto_maximo,
       case
         when coalesce(p.preco_venda, 0) > 0
           then round(((i.preco - p.preco_venda) / p.preco_venda) * 100, 2)
         else 0
       end                 as variacao_percentual,
       (t.ativo
         and t.vigencia_inicio <= current_date
         and (t.vigencia_fim is null or t.vigencia_fim >= current_date)) as vigente
from public.tabela_preco_itens i
join public.tabelas_preco t on t.id = i.tabela_id
join public.produtos p on p.id = i.produto_id;

grant select on public.vw_promocoes to authenticated;
