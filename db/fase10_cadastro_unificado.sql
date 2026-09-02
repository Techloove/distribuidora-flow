-- ============================================================
-- ERP DISTRIBUIDORA - FASE 10: CADASTRO UNIFICADO DE PESSOAS
-- Um unico cadastro (pessoas) com marcacao de papeis:
-- cliente / fornecedor / representante / usuario.
-- O sistema continua usando clientes, fornecedores e representantes:
-- gatilhos espelham automaticamente o cadastro unificado nessas tabelas.
-- Rode este arquivo INTEIRO no SQL Editor do Supabase.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- tabela unificada ----------
create table if not exists public.pessoas (
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
  -- papeis
  is_cliente boolean not null default false,
  is_fornecedor boolean not null default false,
  is_representante boolean not null default false,
  is_usuario boolean not null default false,
  -- dados de cliente
  limite_credito numeric(14,2) not null default 0,
  condicao_pagamento text,
  tabela_preco text,
  representante_id uuid references public.representantes(id) on delete set null,
  status text not null default 'ativo' check (status in ('ativo', 'inativo', 'bloqueado')),
  -- dados de representante
  regiao text,
  comissao_percentual numeric(5,2) not null default 0,
  -- dados de usuario
  profile_id uuid references public.profiles(id) on delete set null,
  observacoes text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pessoas_razao_idx on public.pessoas(razao_social);

grant select, insert, update, delete on public.pessoas to authenticated;
grant all on public.pessoas to service_role;
alter table public.pessoas enable row level security;

drop policy if exists "pessoas_select_auth" on public.pessoas;
create policy "pessoas_select_auth" on public.pessoas
for select to authenticated using (true);

drop policy if exists "pessoas_insert_manage" on public.pessoas;
create policy "pessoas_insert_manage" on public.pessoas
for insert to authenticated with check (public.can_manage(auth.uid()));

drop policy if exists "pessoas_update_manage" on public.pessoas;
create policy "pessoas_update_manage" on public.pessoas
for update to authenticated using (public.can_manage(auth.uid()));

drop policy if exists "pessoas_delete_manage" on public.pessoas;
create policy "pessoas_delete_manage" on public.pessoas
for delete to authenticated using (public.can_manage(auth.uid()));

drop trigger if exists set_updated_at on public.pessoas;
create trigger set_updated_at before update on public.pessoas
for each row execute function public.set_updated_at();

-- ---------- codigo sequencial numerico ----------
create sequence if not exists public.seq_codigo_pessoa;

create or replace function public.gerar_codigo_pessoa()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  _novo text;
begin
  if new.codigo is not null and new.codigo <> '' then
    return new;
  end if;
  loop
    _novo := nextval('public.seq_codigo_pessoa')::text;
    exit when not exists (select 1 from public.pessoas where codigo = _novo);
  end loop;
  new.codigo := _novo;
  return new;
end;
$fn$;

drop trigger if exists trg_codigo_pessoas on public.pessoas;
create trigger trg_codigo_pessoas before insert on public.pessoas
for each row execute function public.gerar_codigo_pessoa();

-- ---------- vinculo com as tabelas existentes ----------
alter table public.clientes add column if not exists pessoa_id uuid references public.pessoas(id) on delete set null;
alter table public.fornecedores add column if not exists pessoa_id uuid references public.pessoas(id) on delete set null;
alter table public.representantes add column if not exists pessoa_id uuid references public.pessoas(id) on delete set null;

create unique index if not exists clientes_pessoa_uidx on public.clientes(pessoa_id) where pessoa_id is not null;
create unique index if not exists fornecedores_pessoa_uidx on public.fornecedores(pessoa_id) where pessoa_id is not null;
create unique index if not exists representantes_pessoa_uidx on public.representantes(pessoa_id) where pessoa_id is not null;

-- ---------- espelhamento ----------
create or replace function public.sincronizar_pessoa()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  _id uuid;
begin
  -- CLIENTE
  select id into _id from public.clientes where pessoa_id = new.id limit 1;
  if new.is_cliente then
    if _id is null then
      insert into public.clientes (
        pessoa_id, razao_social, nome_fantasia, tipo_pessoa, cnpj_cpf, inscricao_estadual,
        email, telefone, logradouro, numero, complemento, bairro, cidade, uf, cep,
        limite_credito, condicao_pagamento, tabela_preco, representante_id, status, observacoes
      ) values (
        new.id, new.razao_social, new.nome_fantasia, new.tipo_pessoa, new.cnpj_cpf, new.inscricao_estadual,
        new.email, new.telefone, new.logradouro, new.numero, new.complemento, new.bairro, new.cidade, new.uf, new.cep,
        new.limite_credito, new.condicao_pagamento, new.tabela_preco, new.representante_id,
        case when new.ativo then new.status else 'inativo' end, new.observacoes
      );
    else
      update public.clientes set
        razao_social = new.razao_social, nome_fantasia = new.nome_fantasia,
        tipo_pessoa = new.tipo_pessoa, cnpj_cpf = new.cnpj_cpf,
        inscricao_estadual = new.inscricao_estadual, email = new.email, telefone = new.telefone,
        logradouro = new.logradouro, numero = new.numero, complemento = new.complemento,
        bairro = new.bairro, cidade = new.cidade, uf = new.uf, cep = new.cep,
        limite_credito = new.limite_credito, condicao_pagamento = new.condicao_pagamento,
        tabela_preco = new.tabela_preco, representante_id = new.representante_id,
        status = case when new.ativo then new.status else 'inativo' end,
        observacoes = new.observacoes
      where id = _id;
    end if;
  elsif _id is not null then
    update public.clientes set status = 'inativo' where id = _id;
  end if;

  -- FORNECEDOR
  select id into _id from public.fornecedores where pessoa_id = new.id limit 1;
  if new.is_fornecedor then
    if _id is null then
      insert into public.fornecedores (
        pessoa_id, razao_social, nome_fantasia, cnpj_cpf, email, telefone,
        cidade, uf, condicao_pagamento, ativo
      ) values (
        new.id, new.razao_social, new.nome_fantasia, new.cnpj_cpf, new.email, new.telefone,
        new.cidade, new.uf, new.condicao_pagamento, new.ativo
      );
    else
      update public.fornecedores set
        razao_social = new.razao_social, nome_fantasia = new.nome_fantasia,
        cnpj_cpf = new.cnpj_cpf, email = new.email, telefone = new.telefone,
        cidade = new.cidade, uf = new.uf, condicao_pagamento = new.condicao_pagamento,
        ativo = new.ativo
      where id = _id;
    end if;
  elsif _id is not null then
    update public.fornecedores set ativo = false where id = _id;
  end if;

  -- REPRESENTANTE
  select id into _id from public.representantes where pessoa_id = new.id limit 1;
  if new.is_representante then
    if _id is null then
      insert into public.representantes (
        pessoa_id, profile_id, nome, email, telefone, regiao, comissao_percentual, ativo
      ) values (
        new.id, new.profile_id, new.razao_social, new.email, new.telefone,
        new.regiao, new.comissao_percentual, new.ativo
      );
    else
      update public.representantes set
        profile_id = new.profile_id, nome = new.razao_social, email = new.email,
        telefone = new.telefone, regiao = new.regiao,
        comissao_percentual = new.comissao_percentual, ativo = new.ativo
      where id = _id;
    end if;
  elsif _id is not null then
    update public.representantes set ativo = false where id = _id;
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_sincronizar_pessoa on public.pessoas;
create trigger trg_sincronizar_pessoa after insert or update on public.pessoas
for each row execute function public.sincronizar_pessoa();

-- ---------- migracao dos cadastros existentes ----------
-- clientes -> pessoas
do $mig$
declare r record; _pid uuid;
begin
  for r in select * from public.clientes where pessoa_id is null loop
    select id into _pid from public.pessoas
      where cnpj_cpf is not null and cnpj_cpf = r.cnpj_cpf limit 1;
    if _pid is null then
      insert into public.pessoas (
        razao_social, nome_fantasia, tipo_pessoa, cnpj_cpf, inscricao_estadual, email, telefone,
        logradouro, numero, complemento, bairro, cidade, uf, cep,
        is_cliente, limite_credito, condicao_pagamento, tabela_preco, representante_id, status, observacoes
      ) values (
        r.razao_social, r.nome_fantasia, r.tipo_pessoa, r.cnpj_cpf, r.inscricao_estadual, r.email, r.telefone,
        r.logradouro, r.numero, r.complemento, r.bairro, r.cidade, r.uf, r.cep,
        true, r.limite_credito, r.condicao_pagamento, r.tabela_preco, r.representante_id, r.status, r.observacoes
      ) returning id into _pid;
    else
      update public.pessoas set is_cliente = true where id = _pid;
    end if;
    update public.clientes set pessoa_id = _pid where id = r.id;
  end loop;

  for r in select * from public.fornecedores where pessoa_id is null loop
    select id into _pid from public.pessoas
      where cnpj_cpf is not null and cnpj_cpf = r.cnpj_cpf limit 1;
    if _pid is null then
      insert into public.pessoas (
        razao_social, nome_fantasia, cnpj_cpf, email, telefone, cidade, uf,
        is_fornecedor, condicao_pagamento, ativo
      ) values (
        r.razao_social, r.nome_fantasia, r.cnpj_cpf, r.email, r.telefone, r.cidade, r.uf,
        true, r.condicao_pagamento, coalesce(r.ativo, true)
      ) returning id into _pid;
    else
      update public.pessoas set is_fornecedor = true where id = _pid;
    end if;
    update public.fornecedores set pessoa_id = _pid where id = r.id;
  end loop;

  for r in select * from public.representantes where pessoa_id is null loop
    select id into _pid from public.pessoas
      where (r.email is not null and email = r.email) or razao_social = r.nome limit 1;
    if _pid is null then
      insert into public.pessoas (
        razao_social, email, telefone, is_representante, regiao, comissao_percentual, profile_id, ativo
      ) values (
        r.nome, r.email, r.telefone, true, r.regiao, r.comissao_percentual, r.profile_id,
        coalesce(r.ativo, true)
      ) returning id into _pid;
    else
      update public.pessoas set
        is_representante = true, regiao = coalesce(regiao, r.regiao),
        comissao_percentual = greatest(comissao_percentual, coalesce(r.comissao_percentual, 0))
      where id = _pid;
    end if;
    update public.representantes set pessoa_id = _pid where id = r.id;
  end loop;
end $mig$;

-- alinha a sequencia com os codigos ja usados
select setval(
  'public.seq_codigo_pessoa',
  greatest(1, coalesce((select max(codigo::bigint) from public.pessoas where codigo ~ '^[0-9]+$'), 0))
);

-- preenche codigos vazios
update public.pessoas set codigo = nextval('public.seq_codigo_pessoa')::text
where codigo is null or codigo = '';
