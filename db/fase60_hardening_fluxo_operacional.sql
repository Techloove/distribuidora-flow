-- Fase 60: isolamento por centro e integridade do fluxo operacional.
-- Não altera dados existentes.

do $$
begin
  if to_regclass('public.pedido_status_historico') is not null then
    alter table public.pedido_status_historico enable row level security;
    drop policy if exists "psh_select" on public.pedido_status_historico;
    create policy "psh_select_center" on public.pedido_status_historico
      for select to authenticated
      using (exists (
        select 1 from public.pedidos p
        where p.id = pedido_id and public.usuario_pode_acessar_centro(p.centro_id)
      ));
  end if;

  if to_regclass('public.pedido_separacoes') is not null then
    alter table public.pedido_separacoes enable row level security;
    drop policy if exists "sep_select" on public.pedido_separacoes;
    create policy "sep_select_center" on public.pedido_separacoes
      for select to authenticated
      using (exists (
        select 1 from public.pedidos p
        where p.id = pedido_id and public.usuario_pode_acessar_centro(p.centro_id)
      ));
    drop policy if exists "sep_write" on public.pedido_separacoes;
    create policy "sep_write_center" on public.pedido_separacoes
      for all to authenticated
      using (
        public.can_stock(auth.uid())
        and exists (
          select 1 from public.pedidos p
          where p.id = pedido_id and public.usuario_pode_acessar_centro(p.centro_id)
        )
      )
      with check (
        public.can_stock(auth.uid())
        and exists (
          select 1 from public.pedidos p
          where p.id = pedido_id and public.usuario_pode_acessar_centro(p.centro_id)
        )
      );
  end if;

  if to_regclass('public.cargas') is not null then
    alter table public.cargas enable row level security;
    drop policy if exists "cargas_select" on public.cargas;
    create policy cargas_select_center on public.cargas
      for select to authenticated
      using (public.usuario_pode_acessar_centro(centro_id));
    drop policy if exists "cargas_write" on public.cargas;
    create policy cargas_write_center on public.cargas
      for all to authenticated
      using (public.can_ship(auth.uid()) and public.usuario_pode_acessar_centro(centro_id))
      with check (public.can_ship(auth.uid()) and public.usuario_pode_acessar_centro(centro_id));
  end if;

  if to_regclass('public.carga_pedidos') is not null then
    alter table public.carga_pedidos enable row level security;
    drop policy if exists "carga_pedidos_select" on public.carga_pedidos;
    create policy carga_pedidos_select_center on public.carga_pedidos
      for select to authenticated
      using (exists (
        select 1
        from public.cargas c
        where c.id = carga_id and public.usuario_pode_acessar_centro(c.centro_id)
      ));
    drop policy if exists "carga_pedidos_write" on public.carga_pedidos;
    create policy carga_pedidos_write_center on public.carga_pedidos
      for all to authenticated
      using (
        public.can_ship(auth.uid()) and exists (
          select 1 from public.cargas c
          where c.id = carga_id and public.usuario_pode_acessar_centro(c.centro_id)
        )
      )
      with check (
        public.can_ship(auth.uid()) and exists (
          select 1 from public.cargas c
          where c.id = carga_id and public.usuario_pode_acessar_centro(c.centro_id)
        )
      );
  end if;
end $$;

create index if not exists pedido_status_hist_pedido_created_idx
  on public.pedido_status_historico(pedido_id, created_at desc);
create index if not exists carga_pedidos_pedido_idx
  on public.carga_pedidos(pedido_id);
