-- Fase 160: remove EXECUTE direto de funcoes de trigger SECURITY DEFINER.
-- Triggers nao precisam ser executaveis via RPC pelo navegador; o PostgreSQL os chama internamente.
begin;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype = 'trigger'::regtype
       and p.prosecdef = true
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      r.assinatura
    );
  end loop;
end $$;

-- Preflight: nenhuma funcao de trigger SECURITY DEFINER deve permanecer executavel pelo cliente.
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
      raise exception 'Fase 160: funcao de trigger ainda exposta: %', r.assinatura;
    end if;
  end loop;
end $$;

commit;
