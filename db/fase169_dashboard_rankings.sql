-- Fase 169: agrega rankings do dashboard no PostgreSQL.
-- Evita truncamento pelo limite REST e filtros/somas no navegador.
begin;

create or replace function public.dashboard_rankings(
  _centro_id uuid default null,
  _de date default date_trunc('month', current_date)::date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  resultado jsonb;
begin
  if not public.usuario_ativo() then
    raise exception 'Acesso nao autorizado' using errcode = '42501';
  end if;

  if _centro_id is not null and not public.usuario_pode_acessar_centro(_centro_id) then
    raise exception 'Centro nao autorizado' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'rotas',
      coalesce((
        select jsonb_agg(jsonb_build_object('nome', x.rota, 'valor', x.total) order by x.total desc)
        from (
          select coalesce(v.rota, '—') as rota, sum(v.total)::numeric as total
          from public.vw_vendas_rota v
          where v.data_pedido >= coalesce(_de, date_trunc('month', current_date)::date)
            and (_centro_id is null or v.centro_id = _centro_id)
          group by coalesce(v.rota, '—')
          order by total desc
          limit 5
        ) x
      ), '[]'::jsonb),
    'representantes',
      coalesce((
        select jsonb_agg(jsonb_build_object('nome', x.representante, 'valor', x.total) order by x.total desc)
        from (
          select coalesce(v.representante, '—') as representante, sum(v.total)::numeric as total
          from public.vw_vendas_representante_rota v
          where v.data_pedido >= coalesce(_de, date_trunc('month', current_date)::date)
            and (_centro_id is null or v.centro_id = _centro_id)
          group by coalesce(v.representante, '—')
          order by total desc
          limit 5
        ) x
      ), '[]'::jsonb),
    'produtos',
      coalesce((
        select jsonb_agg(jsonb_build_object('nome', x.produto, 'valor', x.quantidade) order by x.quantidade desc)
        from (
          select coalesce(v.produto, '—') as produto, sum(v.quantidade)::numeric as quantidade
          from public.vw_produtos_rota v
          where v.data_pedido >= coalesce(_de, date_trunc('month', current_date)::date)
            and (_centro_id is null or v.centro_id = _centro_id)
          group by coalesce(v.produto, '—')
          order by quantidade desc
          limit 5
        ) x
      ), '[]'::jsonb)
  )
  into resultado;

  return resultado;
end;
$$;

revoke execute on function public.dashboard_rankings(uuid,date) from public, anon;
grant execute on function public.dashboard_rankings(uuid,date) to authenticated;

commit;
