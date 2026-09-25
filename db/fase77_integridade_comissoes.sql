-- Fase 77: integridade estrutural das comissoes por pedido.
-- Garante que um pedido nao gere duas comissoes por retry, rotina antiga
-- ou chamada concorrente. Nao altera dados existentes; aborta se houver
-- duplicidades historicas para permitir saneamento manual.

begin;

do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
    from (
      select pedido_id
        from public.comissoes
       where pedido_id is not null
       group by pedido_id
      having count(*) > 1
    ) x;

  if v_count > 0 then
    raise exception
      'Existem % pedidos com comissoes duplicadas. Corrija os dados antes da restricao.',
      v_count;
  end if;
end $$;

create unique index if not exists comissoes_pedido_uq
  on public.comissoes(pedido_id)
  where pedido_id is not null;

create index if not exists comissoes_pedido_status_idx
  on public.comissoes(pedido_id, status);

commit;
