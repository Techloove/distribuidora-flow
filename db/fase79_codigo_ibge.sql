-- Fase 79: código IBGE do município no cadastro
alter table public.pessoas add column if not exists codigo_ibge text;
alter table public.clientes add column if not exists codigo_ibge text;
