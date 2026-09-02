-- ============================================================
-- FASE 29 - Perfis de acesso editaveis (incluir / renomear / excluir)
-- Idempotente.
-- ============================================================

create table if not exists public.papeis (
  codigo text primary key,
  nome text not null,
  sistema boolean not null default false,
  ordem integer not null default 100,
  created_at timestamptz not null default now()
);

grant select on public.papeis to authenticated;
grant all on public.papeis to service_role;

alter table public.papeis enable row level security;

drop policy if exists papeis_select_auth on public.papeis;
create policy papeis_select_auth on public.papeis
  for select to authenticated using (true);

drop policy if exists papeis_write_admin on public.papeis;
create policy papeis_write_admin on public.papeis
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- semente a partir do enum atual
insert into public.papeis (codigo, nome, sistema, ordem) values
  ('admin', 'Administrador', true, 1),
  ('gestor', 'Gestor', true, 2),
  ('financeiro', 'Financeiro', false, 3),
  ('comercial', 'Comercial', false, 4),
  ('representante', 'Representante', false, 5),
  ('estoque', 'Estoque', false, 6),
  ('expedicao', 'Expedição', false, 7)
on conflict (codigo) do nothing;

-- ---------- criar perfil ----------
create or replace function public.papel_criar(_nome text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  cod text;
  nome_limpo text := trim(coalesce(_nome, ''));
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Apenas admin pode criar perfis';
  end if;
  if nome_limpo = '' then
    raise exception 'Informe o nome do perfil';
  end if;

  cod := lower(regexp_replace(
           translate(nome_limpo,
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),
           '[^a-zA-Z0-9]+', '_', 'g'));
  cod := trim(both '_' from cod);
  if cod = '' then
    raise exception 'Nome de perfil inválido';
  end if;
  if exists (select 1 from public.papeis p where p.codigo = cod) then
    raise exception 'Já existe um perfil com este nome';
  end if;

  -- adiciona o valor ao enum app_role quando ainda nao existir
  if not exists (
    select 1 from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'app_role' and e.enumlabel = cod
  ) then
    execute format('alter type public.app_role add value %L', cod);
  end if;

  insert into public.papeis (codigo, nome, sistema, ordem)
  values (cod, nome_limpo, false,
          coalesce((select max(ordem) from public.papeis), 0) + 1);

  return cod;
end;
$$;

grant execute on function public.papel_criar(text) to authenticated;

-- ---------- renomear perfil ----------
create or replace function public.papel_renomear(_codigo text, _nome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Apenas admin pode renomear perfis';
  end if;
  if trim(coalesce(_nome, '')) = '' then
    raise exception 'Informe o nome do perfil';
  end if;
  update public.papeis set nome = trim(_nome) where codigo = _codigo;
  if not found then
    raise exception 'Perfil não encontrado';
  end if;
end;
$$;

grant execute on function public.papel_renomear(text, text) to authenticated;

-- ---------- excluir perfil ----------
create or replace function public.papel_excluir(_codigo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Apenas admin pode excluir perfis';
  end if;
  if exists (select 1 from public.papeis p where p.codigo = _codigo and p.sistema) then
    raise exception 'Perfis do sistema não podem ser excluídos';
  end if;
  if not exists (select 1 from public.papeis p where p.codigo = _codigo) then
    raise exception 'Perfil não encontrado';
  end if;

  execute format('delete from public.user_roles where role = %L::public.app_role', _codigo);
  delete from public.role_menus where role::text = _codigo;
  delete from public.papeis where codigo = _codigo;
end;
$$;

grant execute on function public.papel_excluir(text) to authenticated;
