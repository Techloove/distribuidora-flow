-- ============================================================
-- FASE 27 - Acesso por centro de custo por usuario
-- Idempotente. Rode depois da Fase 26.
-- ============================================================

-- flag: usuario ve todos os centros (padrao true para nao quebrar acessos atuais)
alter table public.profiles
  add column if not exists todos_centros boolean not null default true;

create table if not exists public.usuario_centros (
  user_id uuid not null references auth.users(id) on delete cascade,
  centro_id uuid not null references public.centros(id) on delete cascade,
  primary key (user_id, centro_id)
);

grant select, insert, update, delete on public.usuario_centros to authenticated;
grant all on public.usuario_centros to service_role;
alter table public.usuario_centros enable row level security;

drop policy if exists "usuario_centros_select" on public.usuario_centros;
create policy "usuario_centros_select" on public.usuario_centros
for select to authenticated
using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'));

drop policy if exists "usuario_centros_write_admin" on public.usuario_centros;
create policy "usuario_centros_write_admin" on public.usuario_centros
for all to authenticated
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

create index if not exists usuario_centros_user_idx on public.usuario_centros (user_id);

-- ---------- centros liberados para o usuario logado ----------
create or replace function public.meus_centros()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.centros c
  where public.has_role(auth.uid(), 'admin')
     or coalesce((select p.todos_centros from public.profiles p where p.id = auth.uid()), true)
     or exists (
       select 1 from public.usuario_centros uc
       where uc.user_id = auth.uid() and uc.centro_id = c.id
     );
$$;

grant execute on function public.meus_centros() to authenticated;

-- ---------- definir acesso a centros (somente admin) ----------
create or replace function public.definir_centros_usuario(
  _user_id uuid,
  _todos boolean,
  _centros uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Apenas admin pode definir centros de acesso';
  end if;

  update public.profiles set todos_centros = coalesce(_todos, false) where id = _user_id;

  delete from public.usuario_centros where user_id = _user_id;

  if not coalesce(_todos, false) and _centros is not null then
    insert into public.usuario_centros (user_id, centro_id)
    select _user_id, x
    from unnest(_centros) as x
    on conflict do nothing;
  end if;
end;
$$;

grant execute on function public.definir_centros_usuario(uuid, boolean, uuid[]) to authenticated;
