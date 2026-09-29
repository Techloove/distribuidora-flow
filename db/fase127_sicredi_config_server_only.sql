-- Fase 127: credenciais/configuracao Sicredi somente pelo servidor.
-- O navegador nao pode ler API key/senha nem escrever diretamente nesta tabela.
begin;

alter table public.sicredi_config enable row level security;

revoke all on table public.sicredi_config from anon, authenticated;
grant all on table public.sicredi_config to service_role;

drop policy if exists "sicredi_config_select" on public.sicredi_config;
drop policy if exists "sicredi_config_write" on public.sicredi_config;

-- Preflight: nenhum cliente pode consultar ou alterar segredos bancarios diretamente.
do $$
begin
  if has_table_privilege('anon','public.sicredi_config','SELECT')
     or has_table_privilege('anon','public.sicredi_config','INSERT')
     or has_table_privilege('anon','public.sicredi_config','UPDATE')
     or has_table_privilege('anon','public.sicredi_config','DELETE')
     or has_table_privilege('authenticated','public.sicredi_config','SELECT')
     or has_table_privilege('authenticated','public.sicredi_config','INSERT')
     or has_table_privilege('authenticated','public.sicredi_config','UPDATE')
     or has_table_privilege('authenticated','public.sicredi_config','DELETE') then
    raise exception 'Fase 127: sicredi_config ainda possui privilegio direto para cliente';
  end if;

  if not has_table_privilege('service_role','public.sicredi_config','SELECT')
     or not has_table_privilege('service_role','public.sicredi_config','INSERT')
     or not has_table_privilege('service_role','public.sicredi_config','UPDATE') then
    raise exception 'Fase 127: service_role sem privilegios necessarios em sicredi_config';
  end if;
end $$;

commit;
