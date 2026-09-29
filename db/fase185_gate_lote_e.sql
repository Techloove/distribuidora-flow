-- Fase 185: gate read-only pos-Lote E (Fases 119-135).

do $$
declare
  r regprocedure;
  v_rls boolean;
begin
  if to_regclass('public.boletos_conta_ativa_uq') is null then
    raise exception 'Fase 185: indice boletos_conta_ativa_uq ausente';
  end if;
  if to_regclass('public.boletos_banco_seu_numero_uq') is null then
    raise exception 'Fase 185: indice boletos_banco_seu_numero_uq ausente';
  end if;
  if to_regclass('public.sicredi_config_singleton_uq') is null then
    raise exception 'Fase 185: indice singleton de sicredi_config ausente';
  end if;

  select c.relrowsecurity into v_rls
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='sicredi_config';
  if coalesce(v_rls,false)=false then
    raise exception 'Fase 185: RLS nao habilitado em sicredi_config';
  end if;

  if has_table_privilege('anon','public.sicredi_config','SELECT')
     or has_table_privilege('authenticated','public.sicredi_config','SELECT')
     or has_table_privilege('anon','public.sicredi_config','INSERT')
     or has_table_privilege('authenticated','public.sicredi_config','INSERT')
     or has_table_privilege('anon','public.sicredi_config','UPDATE')
     or has_table_privilege('authenticated','public.sicredi_config','UPDATE')
     or has_table_privilege('anon','public.sicredi_config','DELETE')
     or has_table_privilege('authenticated','public.sicredi_config','DELETE') then
    raise exception 'Fase 185: sicredi_config exposta ao cliente';
  end if;

  r := to_regprocedure('public.preparar_boleto_sicredi_servidor(uuid,uuid)');
  if r is null then
    raise exception 'Fase 185: preparar_boleto_sicredi_servidor ausente';
  end if;
  if has_function_privilege('anon',r,'EXECUTE')
     or has_function_privilege('authenticated',r,'EXECUTE')
     or not has_function_privilege('service_role',r,'EXECUTE') then
    raise exception 'Fase 185: perimetro incorreto na reserva Sicredi';
  end if;

  if to_regprocedure('public.registrar_boleto_sicredi_servidor(uuid,uuid,text,text,text,text,text,text,text,text,text,text,jsonb)') is null then
    raise exception 'Fase 185: persistencia server-only do Sicredi ausente';
  end if;

  r := to_regprocedure('public.consumir_rate_limit(text,integer,integer)');
  if r is null then
    raise exception 'Fase 185: consumir_rate_limit ausente';
  end if;
  if has_function_privilege('anon',r,'EXECUTE')
     or not has_function_privilege('authenticated',r,'EXECUTE') then
    raise exception 'Fase 185: perimetro incorreto no rate limit';
  end if;

  if (select count(*) from public.sicredi_config) <> 1 then
    raise exception 'Fase 185: sicredi_config deve possuir exatamente uma linha';
  end if;

  raise notice 'Fase 185 OK: Lote E com Sicredi server-only, idempotencia e rate limit protegidos.';
end
$$;

select 'fase185_lote_e_ok' as gate, now() as checked_at;
