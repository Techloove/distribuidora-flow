-- Fase207: CNAB Sicredi 3.0 (maio/2026), CPF/CNPJ alfanumérico.
-- Aplicar após fase206. Preserva RPCs, RLS, históricos e sequenciais.
begin;
alter table public.sicredi_cnab_config
  drop constraint if exists sicredi_cnab_config_documento_check;
alter table public.sicredi_cnab_config
  add constraint sicredi_cnab_config_documento_check
  check (documento ~ '^([0-9]{11}|[A-Z0-9]{12}[0-9]{2})$');
commit;
