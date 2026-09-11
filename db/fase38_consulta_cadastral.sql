-- ============================================================
-- FASE 38 - Consulta automatica de clientes por CNPJ / CPF
-- Reutiliza public.clientes (nada e recriado). Acrescenta apenas
-- campos cadastrais, cache de consultas e historico/auditoria.
-- Idempotente.
-- ============================================================

-- ---------- campos cadastrais no cadastro existente ----------
alter table public.clientes add column if not exists situacao_cadastral text;
alter table public.clientes add column if not exists data_abertura date;
alter table public.clientes add column if not exists natureza_juridica text;
alter table public.clientes add column if not exists porte text;
alter table public.clientes add column if not exists cnae_principal text;
alter table public.clientes add column if not exists cnae_secundarios text;
alter table public.clientes add column if not exists data_nascimento date;
alter table public.clientes add column if not exists cadastro_provedor text;
alter table public.clientes add column if not exists cadastro_consultado_em timestamptz;
alter table public.clientes add column if not exists cadastro_atualizado_em timestamptz;

-- documento normalizado (somente digitos) para checagem de duplicidade
create or replace function public.so_digitos(_txt text)
returns text language sql immutable as $$
  select regexp_replace(coalesce(_txt,''), '[^0-9]', '', 'g')
$$;

grant execute on function public.so_digitos(text) to authenticated, anon;

create index if not exists clientes_documento_digitos_idx
  on public.clientes (public.so_digitos(cnpj_cpf));

-- ---------- cache dos dados cadastrais consultados ----------
create table if not exists public.consultas_cadastrais (
  documento   text primary key,
  tipo        text not null check (tipo in ('PJ','PF')),
  provedor    text not null,
  dados       jsonb not null default '{}'::jsonb,
  consultado_em timestamptz not null default now(),
  expira_em   timestamptz not null default now() + interval '30 days'
);

alter table public.consultas_cadastrais enable row level security;
grant select, insert, update on public.consultas_cadastrais to authenticated;
grant all on public.consultas_cadastrais to service_role;

drop policy if exists consultas_cadastrais_ler on public.consultas_cadastrais;
create policy consultas_cadastrais_ler on public.consultas_cadastrais
  for select to authenticated using (true);

drop policy if exists consultas_cadastrais_gravar on public.consultas_cadastrais;
create policy consultas_cadastrais_gravar on public.consultas_cadastrais
  for insert to authenticated with check (true);

drop policy if exists consultas_cadastrais_atualizar on public.consultas_cadastrais;
create policy consultas_cadastrais_atualizar on public.consultas_cadastrais
  for update to authenticated using (true) with check (true);

-- ---------- historico das consultas ----------
create table if not exists public.consultas_log (
  id          uuid primary key default gen_random_uuid(),
  documento   text not null,
  tipo        text,
  provedor    text,
  resultado   text not null,
  mensagem    text,
  cliente_id  uuid references public.clientes(id) on delete set null,
  origem_cache boolean not null default false,
  user_id     uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create index if not exists consultas_log_documento_idx on public.consultas_log(documento, created_at desc);

alter table public.consultas_log enable row level security;
grant select, insert on public.consultas_log to authenticated;
grant all on public.consultas_log to service_role;

drop policy if exists consultas_log_ler on public.consultas_log;
create policy consultas_log_ler on public.consultas_log
  for select to authenticated using (true);

drop policy if exists consultas_log_gravar on public.consultas_log;
create policy consultas_log_gravar on public.consultas_log
  for insert to authenticated with check (true);

-- ---------- duplicidade de documento ----------
create or replace function public.cliente_por_documento(_documento text)
returns table (id uuid, codigo text, razao_social text, cnpj_cpf text, status text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.codigo, c.razao_social, c.cnpj_cpf, c.status
  from public.clientes c
  where public.so_digitos(c.cnpj_cpf) = public.so_digitos(_documento)
    and public.so_digitos(_documento) <> ''
  limit 5
$$;

grant execute on function public.cliente_por_documento(text) to authenticated;

-- ---------- fim da fase 38 ----------
