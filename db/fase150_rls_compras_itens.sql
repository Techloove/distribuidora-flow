-- Fase 150: fecha explicitamente o RLS de compras/itens para o gate final.
-- Garante que o resultado da revisao paralela/Codex nao dependa de policies legadas.
begin;

alter table public.compras enable row level security;
alter table public.compra_itens enable row level security;

drop policy if exists compras_select_auth on public.compras;
create policy compras_select_auth
  on public.compras
  for select to authenticated
  using (public.usuario_pode_acessar_centro(centro_id));

drop policy if exists compra_itens_select_auth on public.compra_itens;
create policy compra_itens_select_auth
  on public.compra_itens
  for select to authenticated
  using (
    exists (
      select 1
      from public.compras c
      where c.id = compra_id
        and public.usuario_pode_acessar_centro(c.centro_id)
    )
  );

-- Escrita continua exclusivamente pelas RPCs controladas.
revoke insert, update, delete on public.compras from anon, authenticated;
revoke insert, update, delete on public.compra_itens from anon, authenticated;
grant select on public.compras to authenticated;
grant select on public.compra_itens to authenticated;

-- Preflight local para evitar divergencia com o gate final da Fase 147.
do $$
begin
  if not (select relrowsecurity from pg_class where oid='public.compras'::regclass) then
    raise exception 'Fase 150: RLS nao habilitado em compras';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.compra_itens'::regclass) then
    raise exception 'Fase 150: RLS nao habilitado em compra_itens';
  end if;
end $$;

commit;