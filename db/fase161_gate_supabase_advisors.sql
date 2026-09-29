-- Fase 161: gate de segurança alinhado aos advisors do Supabase.
-- Falha se funções do schema public permanecerem com search_path mutável
-- ou se funções de trigger SECURITY DEFINER estiverem expostas ao cliente.
begin;

do $$
declare
  r record;
begin
  for r in
    select p.oid, p.oid::regprocedure as assinatura, p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
  loop
    if not exists (
      select 1
        from unnest(coalesce(r.proconfig,array[]::text[])) x
       where x like 'search_path=%'
    ) then
      raise exception 'Fase 161: funcao com search_path mutavel: %', r.assinatura;
    end if;
  end loop;
end $$;

do $$
declare
  r record;
begin
  for r in
    select p.oid, p.oid::regprocedure as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype = 'trigger'::regtype
       and p.prosecdef = true
  loop
    if has_function_privilege('anon', r.oid, 'EXECUTE')
       or has_function_privilege('authenticated', r.oid, 'EXECUTE')
       or exists (
         select 1
           from pg_proc p
           cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where p.oid = r.oid
            and a.grantee = 0
            and a.privilege_type = 'EXECUTE'
       ) then
      raise exception 'Fase 161: trigger SECURITY DEFINER exposta ao cliente: %', r.assinatura;
    end if;
  end loop;
end $$;

commit;
