-- Fase 144: preflight global de funções SECURITY DEFINER expostas no schema public.
-- Não altera dados nem privilégios. Aborta em homologação se houver função sensível sem search_path controlado
-- ou executável por PUBLIC/anon. Funções de trigger são ignoradas porque não são RPCs chamáveis pelo cliente.
begin;

do $$
declare
  r record;
  cfg text[];
begin
  for r in
    select p.oid, p.oid::regprocedure as assinatura, p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
      and p.prorettype <> 'trigger'::regtype
    order by p.proname, p.oid
  loop
    cfg := r.proconfig;

    if not exists (
      select 1
      from unnest(coalesce(cfg, array[]::text[])) x
      where x like 'search_path=%'
    ) then
      raise exception 'Fase 144: SECURITY DEFINER sem search_path controlado: %', r.assinatura;
    end if;

    if exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = r.oid
        and a.grantee = 0
        and a.privilege_type = 'EXECUTE'
    ) then
      raise exception 'Fase 144: PUBLIC possui EXECUTE em SECURITY DEFINER: %', r.assinatura;
    end if;

    if has_function_privilege('anon', r.oid, 'EXECUTE') then
      raise exception 'Fase 144: anon possui EXECUTE em SECURITY DEFINER: %', r.assinatura;
    end if;
  end loop;
end $$;

commit;