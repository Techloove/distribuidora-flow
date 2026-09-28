-- Fase 183: gate read-only pos-Lote D (Fases 99-118).

do $$
declare
  r regprocedure;
begin
  r := to_regprocedure('public.usuario_ativo()');
  if r is null then
    raise exception 'Fase 183: usuario_ativo() ausente';
  end if;

  if has_function_privilege('anon', r, 'EXECUTE') then
    raise exception 'Fase 183: anon ainda executa usuario_ativo()';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where p.oid=r::oid
      and n.nspname='public'
      and p.prosecdef
      and exists (
        select 1 from unnest(coalesce(p.proconfig,'{}'::text[])) x
        where x like 'search_path=%'
      )
  ) then
    raise exception 'Fase 183: usuario_ativo sem SECURITY DEFINER/search_path controlado';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='profiles'
      and t.tgname='trg_proteger_campos_perfil'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception 'Fase 183: trigger de protecao de profiles ausente';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema='public'
      and table_name='user_roles'
      and grantee in ('anon','authenticated')
      and privilege_type in ('INSERT','UPDATE','DELETE')
  ) then
    raise exception 'Fase 183: escrita direta em user_roles permanece liberada';
  end if;

  if to_regprocedure('public.criar_compra_rascunho(uuid,uuid,date,text,text,text,numeric)') is null
     or to_regprocedure('public.adicionar_item_compra(uuid,uuid,numeric,numeric,text,date)') is null
     or to_regprocedure('public.atualizar_item_compra(uuid,numeric,numeric)') is null
     or to_regprocedure('public.remover_item_compra(uuid)') is null
     or to_regprocedure('public.cancelar_compra(uuid)') is null then
    raise exception 'Fase 183: CRUD controlado de compras incompleto';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema='public'
      and table_name in ('compras','compra_itens')
      and grantee in ('anon','authenticated')
      and privilege_type in ('INSERT','UPDATE','DELETE')
  ) then
    raise exception 'Fase 183: escrita direta em compras/compra_itens permanece liberada';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where n.nspname='public'
      and p.prosecdef
      and a.grantee=0
      and a.privilege_type='EXECUTE'
  ) then
    raise exception 'Fase 183: existe SECURITY DEFINER publicamente executavel';
  end if;

  raise notice 'Fase 183 OK: Lote D com acesso, compras e RPCs no perimetro esperado.';
end
$$;

select 'fase183_lote_d_ok' as gate, now() as checked_at;
