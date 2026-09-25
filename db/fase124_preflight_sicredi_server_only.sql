-- Fase 124: preflight da persistencia Sicredi server-only.
-- Nao altera dados; valida que o navegador nao consegue forjar retorno bancario.
begin;

do $$
declare
  sig text;
  r regprocedure;
  funcoes_servidor text[] := array[
    'public.ator_financeiro_pode_acessar_centro(uuid,uuid)',
    'public.registrar_boleto_sicredi_servidor(uuid,uuid,text,text,text,text,text,text,text,text,text,text,jsonb)',
    'public.registrar_erro_boleto_sicredi_servidor(uuid,uuid,text,text)',
    'public.sincronizar_boleto_sicredi_servidor(uuid,uuid,text,jsonb)'
  ];
begin
  foreach sig in array funcoes_servidor loop
    r := to_regprocedure(sig);
    if r is null then
      raise exception 'Preflight Sicredi: RPC server-only ausente: %', sig;
    end if;

    if exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = r::oid
        and a.grantee = 0
        and a.privilege_type = 'EXECUTE'
    ) then
      raise exception 'Preflight Sicredi: PUBLIC ainda executa %', r;
    end if;

    if has_function_privilege('anon', r, 'EXECUTE')
       or has_function_privilege('authenticated', r, 'EXECUTE') then
      raise exception 'Preflight Sicredi: cliente ainda executa RPC server-only %', r;
    end if;

    if not has_function_privilege('service_role', r, 'EXECUTE') then
      raise exception 'Preflight Sicredi: service_role sem EXECUTE em %', r;
    end if;
  end loop;
end $$;

-- RPCs antigas podem permanecer para compatibilidade interna, mas nunca expostas ao navegador.
do $$
declare
  sig text;
  r regprocedure;
  antigas text[] := array[
    'public.registrar_boleto_sicredi(uuid,text,text,text,text,text,text,text,text,text,text,jsonb)',
    'public.registrar_erro_boleto_sicredi(uuid,text,text)',
    'public.sincronizar_boleto_sicredi(uuid,text,jsonb)'
  ];
begin
  foreach sig in array antigas loop
    r := to_regprocedure(sig);
    if r is not null and (
      has_function_privilege('anon', r, 'EXECUTE')
      or has_function_privilege('authenticated', r, 'EXECUTE')
      or exists (
        select 1
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = r::oid
          and a.grantee = 0
          and a.privilege_type = 'EXECUTE'
      )
    ) then
      raise exception 'Preflight Sicredi: RPC legada ainda exposta ao cliente: %', r;
    end if;
  end loop;
end $$;

-- Funcoes SECURITY DEFINER do perimetro Sicredi devem fixar search_path.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as assinatura, p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prosecdef
      and p.proname in (
        'ator_financeiro_pode_acessar_centro',
        'registrar_boleto_sicredi_servidor',
        'registrar_erro_boleto_sicredi_servidor',
        'sincronizar_boleto_sicredi_servidor'
      )
  loop
    if not exists (
      select 1
      from unnest(coalesce(f.proconfig,array[]::text[])) cfg
      where cfg like 'search_path=%'
    ) then
      raise exception 'Preflight Sicredi: SECURITY DEFINER sem search_path controlado: %', f.assinatura;
    end if;
  end loop;
end $$;

commit;