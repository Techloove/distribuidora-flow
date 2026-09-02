-- ============================================================
-- ERP DISTRIBUIDORA — FASE 1: CADASTROS BASE
-- Rode este arquivo inteiro no SQL Editor do seu projeto Supabase.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- helpers ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- papéis ----------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum (
      'admin', 'gestor', 'financeiro', 'comercial', 'representante', 'estoque', 'expedicao'
    );
  end if;
end $$;

-- ---------- empresas ----------
create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  razao_social text not null,
  nome_fantasia text,
  cnpj text unique,
  inscricao_estadual text,
  email text,
  telefone text,
  logradouro text,
  numero text,
  bairro text,
  cidade text,
  uf text,
  cep text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.empresas to authenticated;
grant all on public.empresas to service_role;
alter table public.empresas enable row level security;

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  email text,
  telefone text,
  empresa_id uuid references public.empresas(id) on delete set null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

-- ---------- user_roles ----------
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  );
$$;

create or replace function public.can_manage(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role in ('admin', 'gestor')
  );
$$;

-- ---------- trigger de novo usuário ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nome, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', ''), new.email)
  on conflict (id) do nothing;

  -- o primeiro usuário do sistema vira admin; os demais entram como comercial
  if not exists (select 1 from public.user_roles) then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  else
    insert into public.user_roles (user_id, role) values (new.id, 'comercial')
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------- representantes ----------
create table if not exists public.representantes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  codigo text unique,
  nome text not null,
  email text,
  telefone text,
  regiao text,
  comissao_percentual numeric(5,2) not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.representantes to authenticated;
grant all on public.representantes to service_role;
alter table public.representantes enable row level security;

-- ---------- clientes ----------
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  razao_social text not null,
  nome_fantasia text,
  tipo_pessoa text not null default 'PJ' check (tipo_pessoa in ('PJ', 'PF')),
  cnpj_cpf text unique,
  inscricao_estadual text,
  email text,
  telefone text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  cep text,
  limite_credito numeric(14,2) not null default 0,
  condicao_pagamento text,
  tabela_preco text,
  representante_id uuid references public.representantes(id) on delete set null,
  status text not null default 'ativo' check (status in ('ativo', 'inativo', 'bloqueado')),
  observacoes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clientes_representante_idx on public.clientes(representante_id);
create index if not exists clientes_razao_idx on public.clientes(razao_social);

grant select, insert, update, delete on public.clientes to authenticated;
grant all on public.clientes to service_role;
alter table public.clientes enable row level security;

-- ---------- produtos ----------
create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  descricao text not null,
  ean text,
  ncm text,
  categoria text,
  marca text,
  unidade text not null default 'UN',
  peso_kg numeric(12,3),
  custo_medio numeric(14,4) not null default 0,
  preco_venda numeric(14,4) not null default 0,
  estoque_minimo numeric(14,3) not null default 0,
  estoque_atual numeric(14,3) not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists produtos_descricao_idx on public.produtos(descricao);

grant select, insert, update, delete on public.produtos to authenticated;
grant all on public.produtos to service_role;
alter table public.produtos enable row level security;

-- ---------- triggers updated_at ----------
do $$
declare t text;
begin
  foreach t in array array['empresas','profiles','representantes','clientes','produtos'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------- POLICIES ----------
drop policy if exists "profiles_select_self_or_manager" on public.profiles;
create policy "profiles_select_self_or_manager" on public.profiles
for select to authenticated
using (id = auth.uid() or public.can_manage(auth.uid()));

drop policy if exists "profiles_update_self_or_manager" on public.profiles;
create policy "profiles_update_self_or_manager" on public.profiles
for update to authenticated
using (id = auth.uid() or public.can_manage(auth.uid()));

drop policy if exists "user_roles_select_self_or_manager" on public.user_roles;
create policy "user_roles_select_self_or_manager" on public.user_roles
for select to authenticated
using (user_id = auth.uid() or public.can_manage(auth.uid()));

-- empresas / representantes / clientes / produtos:
-- leitura para qualquer usuário autenticado, escrita apenas para admin/gestor
do $$
declare t text;
begin
  foreach t in array array['empresas','representantes','clientes','produtos'] loop
    execute format('drop policy if exists "%s_select_auth" on public.%I', t, t);
    execute format('create policy "%s_select_auth" on public.%I for select to authenticated using (true)', t, t);

    execute format('drop policy if exists "%s_insert_manage" on public.%I', t, t);
    execute format('create policy "%s_insert_manage" on public.%I for insert to authenticated with check (public.can_manage(auth.uid()))', t, t);

    execute format('drop policy if exists "%s_update_manage" on public.%I', t, t);
    execute format('create policy "%s_update_manage" on public.%I for update to authenticated using (public.can_manage(auth.uid()))', t, t);

    execute format('drop policy if exists "%s_delete_manage" on public.%I', t, t);
    execute format('create policy "%s_delete_manage" on public.%I for delete to authenticated using (public.can_manage(auth.uid()))', t, t);
  end loop;
end $$;
