-- Fase 177: gate read-only pos-Lote A.
-- Executar depois das Fases 48, 51 e 54-58.

do $$
declare
  v_ok boolean;
begin
  if to_regclass('public.estoque_saldos') is null then
    raise exception 'Fase 177: estoque_saldos nao foi criado';
  end if;

  if to_regclass('public.api_rate_limits') is null then
    raise exception 'Fase 177: api_rate_limits nao foi criado';
  end if;

  select c.relrowsecurity into v_ok
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='estoque_saldos';
  if coalesce(v_ok,false)=false then
    raise exception 'Fase 177: RLS nao habilitado em estoque_saldos';
  end if;

  select c.relrowsecurity into v_ok
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='api_rate_limits';
  if coalesce(v_ok,false)=false then
    raise exception 'Fase 177: RLS nao habilitado em api_rate_limits';
  end if;

  if to_regprocedure('public.usuario_pode_acessar_centro(uuid)') is null then
    raise exception 'Fase 177: usuario_pode_acessar_centro(uuid) ausente';
  end if;

  if to_regprocedure('public.pode_alterar_preco(uuid)') is null then
    raise exception 'Fase 177: pode_alterar_preco(uuid) ausente';
  end if;

  if to_regprocedure('public.consumir_rate_limit(text,integer,integer)') is null then
    raise exception 'Fase 177: consumir_rate_limit(...) ausente';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='usuario_pode_acessar_centro'
      and p.prosecdef
      and exists (select 1 from unnest(coalesce(p.proconfig,'{}'::text[])) x where x like 'search_path=%public%')
  ) then
    raise exception 'Fase 177: usuario_pode_acessar_centro sem SECURITY DEFINER/search_path controlado';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='consumir_rate_limit'
      and p.prosecdef
      and exists (select 1 from unnest(coalesce(p.proconfig,'{}'::text[])) x where x like 'search_path=%public%')
  ) then
    raise exception 'Fase 177: consumir_rate_limit sem SECURITY DEFINER/search_path controlado';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='pedido_itens'
      and t.tgname='trg_pedido_itens_preco_permitido' and not t.tgisinternal
  ) then
    raise exception 'Fase 177: trigger de protecao de preco ausente';
  end if;

  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='boletos_banco_seu_numero_uq') then
    raise exception 'Fase 177: indice unico de idempotencia de boletos ausente';
  end if;

  if to_regclass('public.vw_sugestao_compras_centro') is null then
    raise exception 'Fase 177: view de planejamento por centro ausente';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema='public' and table_name='api_rate_limits'
      and grantee in ('anon','authenticated')
      and privilege_type in ('INSERT','UPDATE','DELETE')
  ) then
    raise exception 'Fase 177: api_rate_limits possui escrita direta para anon/authenticated';
  end if;

  raise notice 'Fase 177 OK: Lote A implantado com os gates estruturais principais.';
end
$$;

select 'fase177_lote_a_ok' as gate, now() as checked_at;