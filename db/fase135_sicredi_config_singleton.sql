-- Fase 135: garante configuração Sicredi singleton.
-- Mais de uma linha tornaria a escolha de credenciais ambígua no servidor.
begin;

do $$
declare
  qtd integer;
begin
  select count(*) into qtd from public.sicredi_config;
  if qtd > 1 then
    raise exception 'Fase 135: existem % linhas em sicredi_config; consolide manualmente as credenciais antes de aplicar esta migration', qtd;
  end if;
end $$;

create unique index if not exists sicredi_config_singleton_uq
  on public.sicredi_config ((true));

insert into public.sicredi_config(ambiente)
select 'homologacao'
where not exists (select 1 from public.sicredi_config);

do $$
begin
  if (select count(*) from public.sicredi_config) <> 1 then
    raise exception 'Fase 135: sicredi_config deve possuir exatamente uma linha';
  end if;
end $$;

commit;
