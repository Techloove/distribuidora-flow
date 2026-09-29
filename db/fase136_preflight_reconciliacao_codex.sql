-- Fase 136: reconciliacao/preflight das alteracoes de hardening mais recentes.
-- Valida o perimetro server-only do Sicredi e a operacao destrutiva administrativa.
-- Nao altera dados de negocio.
begin;

-- 1) A reserva de emissao Sicredi deve existir e ser exclusiva do service_role.
do $$
declare
  r regprocedure := to_regprocedure('public.preparar_boleto_sicredi_servidor(uuid,uuid)');
  cfg text[];
begin
  if r is null then
    raise exception 'Fase 136: preparar_boleto_sicredi_servidor(uuid,uuid) ausente';
  end if;

  if has_function_privilege('anon', r, 'EXECUTE')
     or has_function_privilege('authenticated', r, 'EXECUTE') then
    raise exception 'Fase 136: preparar_boleto_sicredi_servidor exposta ao cliente';
  end if;

  if not has_function_privilege('service_role', r, 'EXECUTE') then
    raise exception 'Fase 136: service_role sem EXECUTE em preparar_boleto_sicredi_servidor';
  end if;

  if exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = r::oid
      and a.grantee = 0
      and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'Fase 136: PUBLIC ainda executa preparar_boleto_sicredi_servidor';
  end if;

  select p.proconfig into cfg from pg_proc p where p.oid = r::oid;
  if not exists (
    select 1 from unnest(coalesce(cfg,array[]::text[])) x
    where x like 'search_path=%'
  ) then
    raise exception 'Fase 136: preparar_boleto_sicredi_servidor sem search_path controlado';
  end if;
end $$;

-- 2) Barreiras de concorrencia/idempotencia do boleto devem existir.
do $$
begin
  if to_regclass('public.boletos_conta_ativa_uq') is null then
    raise exception 'Fase 136: indice boletos_conta_ativa_uq ausente';
  end if;

  if to_regclass('public.boletos_banco_seu_numero_uq') is null then
    raise exception 'Fase 136: indice boletos_banco_seu_numero_uq ausente';
  end if;
end $$;

-- 3) Credenciais Sicredi permanecem inacessiveis ao navegador.
do $$
begin
  if to_regclass('public.sicredi_config') is null then
    raise exception 'Fase 136: tabela sicredi_config ausente';
  end if;

  if has_table_privilege('anon','public.sicredi_config','SELECT')
     or has_table_privilege('anon','public.sicredi_config','INSERT')
     or has_table_privilege('anon','public.sicredi_config','UPDATE')
     or has_table_privilege('anon','public.sicredi_config','DELETE')
     or has_table_privilege('authenticated','public.sicredi_config','SELECT')
     or has_table_privilege('authenticated','public.sicredi_config','INSERT')
     or has_table_privilege('authenticated','public.sicredi_config','UPDATE')
     or has_table_privilege('authenticated','public.sicredi_config','DELETE') then
    raise exception 'Fase 136: sicredi_config possui privilegio direto de cliente';
  end if;

  if to_regclass('public.sicredi_config_singleton_uq') is null then
    raise exception 'Fase 136: indice singleton de sicredi_config ausente';
  end if;

  if (select count(*) from public.sicredi_config) <> 1 then
    raise exception 'Fase 136: sicredi_config deve possuir exatamente uma linha';
  end if;
end $$;

-- 4) A rotina de limpeza total deve permanecer encapsulada.
do $$
declare
  wrapper regprocedure := to_regprocedure('public.admin_limpar_dados(text)');
  interno regprocedure := to_regprocedure('public.admin_limpar_dados_interno_f130(text)');
begin
  if wrapper is null or interno is null then
    raise exception 'Fase 136: perimetro de admin_limpar_dados incompleto';
  end if;

  if has_function_privilege('anon', wrapper, 'EXECUTE')
     or not has_function_privilege('authenticated', wrapper, 'EXECUTE') then
    raise exception 'Fase 136: privilegios incorretos no wrapper admin_limpar_dados';
  end if;

  if has_function_privilege('anon', interno, 'EXECUTE')
     or has_function_privilege('authenticated', interno, 'EXECUTE') then
    raise exception 'Fase 136: implementacao interna de limpeza exposta ao cliente';
  end if;

  if not has_function_privilege('service_role', interno, 'EXECUTE') then
    raise exception 'Fase 136: service_role sem EXECUTE na implementacao interna de limpeza';
  end if;
end $$;

commit;
