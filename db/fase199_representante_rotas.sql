-- FASE 199: um representante pode atender várias rotas
create table if not exists public.representante_rotas (
  id uuid primary key default gen_random_uuid(),
  representante_id uuid not null references public.representantes(id) on delete cascade,
  rota_id uuid not null references public.rotas(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (representante_id, rota_id)
);
grant select on public.representante_rotas to authenticated;
grant all on public.representante_rotas to service_role;
alter table public.representante_rotas enable row level security;
drop policy if exists representante_rotas_select on public.representante_rotas;
create policy representante_rotas_select on public.representante_rotas
  for select to authenticated
  using (public.usuario_ativo() and ((not public.escopo_representante()) or representante_id = public.meu_representante_id()));

create or replace function public.definir_rotas_representante(_pessoa_id uuid, _rotas uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare _rep uuid;
begin
  if not (public.usuario_ativo() and public.can_manage(auth.uid())) then
    raise exception 'Sem permissão para alterar rotas do representante';
  end if;
  select id into _rep from public.representantes where pessoa_id = _pessoa_id;
  if _rep is null then raise exception 'Representante não encontrado para esta pessoa'; end if;
  delete from public.representante_rotas where representante_id = _rep
    and not (rota_id = any(coalesce(_rotas, '{}')));
  insert into public.representante_rotas (representante_id, rota_id)
  select _rep, r from unnest(coalesce(_rotas, '{}')) r
  on conflict do nothing;
end $$;
revoke all on function public.definir_rotas_representante(uuid, uuid[]) from public, anon;
grant execute on function public.definir_rotas_representante(uuid, uuid[]) to authenticated;
