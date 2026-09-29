-- Fase 115: fecha RPCs operacionais de separação e remove o estorno financeiro legado do cliente.
begin;

-- O frontend agora usa estornar_movimento_financeiro(uuid,text).
-- Se a RPC antiga ainda existir, ela fica apenas para service_role/rotinas internas.
do $$
declare
  r regprocedure;
begin
  for r in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'estornar_movimento'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r);
    execute format('grant execute on function %s to service_role', r);
  end loop;
end $$;

-- RPCs da separação continuam disponíveis a usuários autenticados, mas nunca a anon/PUBLIC.
do $$
declare
  nome text;
  r regprocedure;
  encontrados integer;
  funcoes text[] := array[
    'iniciar_separacao',
    'concluir_separacao',
    'conferir_separacao',
    'registrar_separacao_item'
  ];
begin
  foreach nome in array funcoes loop
    select count(*)
      into encontrados
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = nome;

    if encontrados <> 1 then
      raise exception 'Perimetro inseguro: public.% possui % assinaturas; esperado exatamente 1 antes de conceder EXECUTE', nome, encontrados;
    end if;

    select p.oid::regprocedure
      into r
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = nome;

    execute format('revoke execute on function %s from public, anon', r);
    execute format('grant execute on function %s to authenticated, service_role', r);
  end loop;
end $$;

-- Preflight local do perímetro.
do $$
declare
  nome text;
  r regprocedure;
  funcoes text[] := array[
    'iniciar_separacao',
    'concluir_separacao',
    'conferir_separacao',
    'registrar_separacao_item'
  ];
begin
  foreach nome in array funcoes loop
    for r in
      select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = nome
    loop
      if has_function_privilege('anon', r, 'EXECUTE') then
        raise exception 'Fase 115: anon ainda executa %', r;
      end if;

      if not has_function_privilege('authenticated', r, 'EXECUTE') then
        raise exception 'Fase 115: authenticated sem EXECUTE em %', r;
      end if;

      if exists (
        select 1
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = r::oid
          and a.grantee = 0
          and a.privilege_type = 'EXECUTE'
      ) then
        raise exception 'Fase 115: PUBLIC ainda executa %', r;
      end if;
    end loop;
  end loop;

  for r in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'estornar_movimento'
  loop
    if has_function_privilege('anon', r, 'EXECUTE')
       or has_function_privilege('authenticated', r, 'EXECUTE') then
      raise exception 'Fase 115: RPC legada de estorno ainda exposta ao cliente: %', r;
    end if;
  end loop;
end $$;

commit;
