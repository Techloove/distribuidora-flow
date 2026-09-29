-- Fase 110: preflight do perimetro de compras controladas.
-- Valida ausencia de escrita direta e disponibilidade das RPCs da Fase 109.
begin;

do $$
declare
  t text;
  tabelas text[] := array['compras','compra_itens'];
begin
  foreach t in array tabelas loop
    if to_regclass('public.' || t) is null then
      raise exception 'Preflight compras: tabela ausente: public.%', t;
    end if;

    if has_table_privilege('authenticated', format('public.%I',t), 'INSERT')
       or has_table_privilege('authenticated', format('public.%I',t), 'UPDATE')
       or has_table_privilege('authenticated', format('public.%I',t), 'DELETE')
       or has_table_privilege('anon', format('public.%I',t), 'INSERT')
       or has_table_privilege('anon', format('public.%I',t), 'UPDATE')
       or has_table_privilege('anon', format('public.%I',t), 'DELETE') then
      raise exception 'Preflight compras: escrita direta ainda permitida em public.%', t;
    end if;
  end loop;
end $$;

do $$
declare
  sig text;
  r regprocedure;
  funcoes text[] := array[
    'public.criar_compra_rascunho(uuid,uuid,date,text,text,text,numeric)',
    'public.atualizar_compra_comercial(uuid,uuid,numeric,numeric)',
    'public.adicionar_item_compra(uuid,uuid,numeric,numeric,text,date)',
    'public.atualizar_item_compra(uuid,numeric,numeric)',
    'public.remover_item_compra(uuid)',
    'public.cancelar_compra(uuid)'
  ];
begin
  foreach sig in array funcoes loop
    r := to_regprocedure(sig);
    if r is null then
      raise exception 'Preflight compras: RPC obrigatoria ausente: %', sig;
    end if;

    if has_function_privilege('anon', r, 'EXECUTE') then
      raise exception 'Preflight compras: anon ainda executa %', r;
    end if;

    if not has_function_privilege('authenticated', r, 'EXECUTE') then
      raise exception 'Preflight compras: authenticated sem EXECUTE em %', r;
    end if;

    if exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = r::oid
        and a.grantee = 0
        and a.privilege_type = 'EXECUTE'
    ) then
      raise exception 'Preflight compras: PUBLIC ainda executa %', r;
    end if;
  end loop;
end $$;

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
        'criar_compra_rascunho','atualizar_compra_comercial','adicionar_item_compra',
        'atualizar_item_compra','remover_item_compra','cancelar_compra'
      )
  loop
    if not exists (
      select 1
      from unnest(coalesce(f.proconfig,array[]::text[])) cfg
      where cfg like 'search_path=%'
    ) then
      raise exception 'Preflight compras: SECURITY DEFINER sem search_path controlado: %', f.assinatura;
    end if;
  end loop;
end $$;

commit;
