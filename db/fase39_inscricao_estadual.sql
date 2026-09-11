-- ============================================================
-- FASE 39 - Consulta de Inscricao Estadual (IE) a partir do CNPJ
-- Extensao da fase 38. Reutiliza public.clientes, consultas_log e o
-- fluxo de consulta cadastral existente. Nada e recriado.
-- Idempotente.
-- ============================================================

-- ---------- campos fiscais no cadastro existente ----------
-- inscricao_estadual ja existe em public.clientes (nao recriar)
alter table public.clientes add column if not exists uf_inscricao_estadual text;
alter table public.clientes add column if not exists situacao_inscricao_estadual text;
alter table public.clientes add column if not exists indicador_contribuinte_icms text;
alter table public.clientes add column if not exists data_ultima_consulta_ie timestamptz;
alter table public.clientes add column if not exists ie_provedor text;

-- ---------- estrutura para mais de uma IE por cliente (expansao futura) ----------
create table if not exists public.cliente_inscricoes_estaduais (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  documento   text not null,
  inscricao   text not null,
  uf          text,
  situacao    text,
  contribuinte_icms text,
  principal   boolean not null default false,
  provedor    text,
  consultado_em timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (cliente_id, inscricao)
);

create index if not exists cliente_ies_cliente_idx
  on public.cliente_inscricoes_estaduais(cliente_id);

alter table public.cliente_inscricoes_estaduais enable row level security;
grant select, insert, update, delete on public.cliente_inscricoes_estaduais to authenticated;
grant all on public.cliente_inscricoes_estaduais to service_role;

drop policy if exists cliente_ies_ler on public.cliente_inscricoes_estaduais;
create policy cliente_ies_ler on public.cliente_inscricoes_estaduais
  for select to authenticated using (true);

drop policy if exists cliente_ies_gravar on public.cliente_inscricoes_estaduais;
create policy cliente_ies_gravar on public.cliente_inscricoes_estaduais
  for insert to authenticated with check (true);

drop policy if exists cliente_ies_atualizar on public.cliente_inscricoes_estaduais;
create policy cliente_ies_atualizar on public.cliente_inscricoes_estaduais
  for update to authenticated using (true) with check (true);

drop policy if exists cliente_ies_excluir on public.cliente_inscricoes_estaduais;
create policy cliente_ies_excluir on public.cliente_inscricoes_estaduais
  for delete to authenticated using (true);

-- ---------- cache das consultas fiscais ----------
create table if not exists public.consultas_ie (
  documento     text primary key,
  provedor      text not null,
  dados         jsonb not null default '{}'::jsonb,
  consultado_em timestamptz not null default now(),
  expira_em     timestamptz not null default now() + interval '15 days'
);

alter table public.consultas_ie enable row level security;
grant select, insert, update on public.consultas_ie to authenticated;
grant all on public.consultas_ie to service_role;

drop policy if exists consultas_ie_ler on public.consultas_ie;
create policy consultas_ie_ler on public.consultas_ie
  for select to authenticated using (true);

drop policy if exists consultas_ie_gravar on public.consultas_ie;
create policy consultas_ie_gravar on public.consultas_ie
  for insert to authenticated with check (true);

drop policy if exists consultas_ie_atualizar on public.consultas_ie;
create policy consultas_ie_atualizar on public.consultas_ie
  for update to authenticated using (true) with check (true);

-- ---------- historico: reaproveita consultas_log ----------
alter table public.consultas_log add column if not exists inscricao_estadual text;
alter table public.consultas_log add column if not exists uf_inscricao text;
alter table public.consultas_log add column if not exists situacao_inscricao text;

-- o check de tipo passa a aceitar consultas fiscais
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'consultas_cadastrais_tipo_check'
  ) then
    alter table public.consultas_cadastrais drop constraint consultas_cadastrais_tipo_check;
    alter table public.consultas_cadastrais
      add constraint consultas_cadastrais_tipo_check check (tipo in ('PJ','PF','IE'));
  end if;
end $$;

-- ---------- fim da fase 39 ----------
