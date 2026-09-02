-- ============================================================
-- ERP DISTRIBUIDORA - FASE 18
-- Configuracao da API de Cobranca do Sicredi (chaves + juros, multa,
-- desconto, protesto e demais parametros do boleto), editavel em
-- Configuracoes. Idempotente.
-- ============================================================

create table if not exists public.sicredi_config (
  id uuid primary key default gen_random_uuid(),
  -- credenciais da API
  api_key text,
  username text,
  password text,
  cooperativa text,
  posto text,
  codigo_beneficiario text,
  ambiente text not null default 'homologacao',
  -- parametros do boleto (conforme API de cobranca do Sicredi)
  tipo_cobranca text not null default 'HIBRIDO',
  especie_documento text not null default 'DUPLICATA_MERCANTIL_INDICACAO',
  -- juros
  tipo_juro text not null default 'ISENTO',            -- ISENTO | PERCENTUAL | VALOR
  juros numeric(9,4) not null default 0,               -- % ao mes ou valor por dia
  -- multa
  multa numeric(9,4) not null default 0,               -- % apos o vencimento
  dias_multa integer not null default 0,               -- dias apos vencimento p/ multa
  -- desconto
  tipo_desconto text not null default 'NAO_TEM_DESCONTO', -- NAO_TEM_DESCONTO | VALOR | PERCENTUAL
  valor_desconto1 numeric(14,4) not null default 0,
  dias_desconto1 integer not null default 0,           -- dias antes do vencimento
  -- protesto / negativacao
  tipo_protesto text not null default 'SEM_PROTESTO',  -- SEM_PROTESTO | PROTESTAR | NEGATIVAR
  dias_protesto integer not null default 0,
  -- validade e mensagens
  validade_apos_vencimento integer not null default 0, -- dias que o boleto aceita pagamento
  informativo text,
  mensagem text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.sicredi_config to authenticated;
grant all on public.sicredi_config to service_role;

alter table public.sicredi_config enable row level security;

-- credenciais sao sensiveis: somente gestores leem/escrevem
drop policy if exists "sicredi_config_select" on public.sicredi_config;
create policy "sicredi_config_select" on public.sicredi_config
for select to authenticated using (public.can_manage(auth.uid()));

drop policy if exists "sicredi_config_write" on public.sicredi_config;
create policy "sicredi_config_write" on public.sicredi_config
for all to authenticated
using (public.can_manage(auth.uid()))
with check (public.can_manage(auth.uid()));

drop trigger if exists trg_sicredi_config_updated on public.sicredi_config;
create trigger trg_sicredi_config_updated
before update on public.sicredi_config
for each row execute function public.set_updated_at();

-- garante uma unica linha de configuracao
insert into public.sicredi_config (ambiente)
select 'homologacao'
where not exists (select 1 from public.sicredi_config);
