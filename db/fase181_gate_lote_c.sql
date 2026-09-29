-- Fase 181: gate read-only pos-Lote C.
-- Executar depois das Fases 80-89.

do $$
declare
  v_rls boolean;
begin
  if to_regclass('public.creditos_clientes') is null then
    raise exception 'Fase 181: creditos_clientes ausente';
  end if;
  if to_regclass('public.creditos_clientes_aplicacoes') is null then
    raise exception 'Fase 181: creditos_clientes_aplicacoes ausente';
  end if;

  if to_regprocedure('public.aplicar_creditos_cliente_pedido(uuid,numeric,text)') is null then
    raise exception 'Fase 181: aplicar_creditos_cliente_pedido(...) ausente';
  end if;
  if to_regprocedure('public.cancelar_aplicacao_credito(uuid)') is null then
    raise exception 'Fase 181: cancelar_aplicacao_credito(uuid) ausente';
  end if;
  if to_regprocedure('public.criar_pedido_rascunho(uuid,uuid,uuid,uuid,date,text,uuid,date)') is null then
    raise exception 'Fase 181: criar_pedido_rascunho(...) ausente';
  end if;
  if to_regprocedure('public.adicionar_item_pedido(uuid,uuid,numeric,numeric,numeric)') is null then
    raise exception 'Fase 181: adicionar_item_pedido(...) ausente';
  end if;
  if to_regprocedure('public.atualizar_item_pedido(uuid,numeric,numeric,numeric)') is null then
    raise exception 'Fase 181: atualizar_item_pedido(...) ausente';
  end if;
  if to_regprocedure('public.remover_item_pedido(uuid)') is null then
    raise exception 'Fase 181: remover_item_pedido(uuid) ausente';
  end if;
  if to_regprocedure('public.atualizar_dados_expedicao(uuid,uuid,text,text,date,numeric,numeric,uuid,text,text)') is null then
    raise exception 'Fase 181: atualizar_dados_expedicao(...) ausente';
  end if;

  select c.relrowsecurity into v_rls
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='creditos_clientes';
  if coalesce(v_rls,false)=false then
    raise exception 'Fase 181: RLS nao habilitado em creditos_clientes';
  end if;

  select c.relrowsecurity into v_rls
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='creditos_clientes_aplicacoes';
  if coalesce(v_rls,false)=false then
    raise exception 'Fase 181: RLS nao habilitado em creditos_clientes_aplicacoes';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and indexname='credito_aplicacao_idempotencia_uq'
  ) then
    raise exception 'Fase 181: indice de idempotencia de aplicacao de credito ausente';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and indexname='contas_receber_pedido_parcela_uq'
  ) then
    raise exception 'Fase 181: indice unico de recebiveis por pedido/parcela ausente';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and indexname='comissoes_pedido_uq'
  ) then
    raise exception 'Fase 181: indice unico de comissao por pedido ausente';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema='public'
      and table_name in ('pedidos','pedido_itens','creditos_clientes','creditos_clientes_aplicacoes','expedicoes','pedido_separacoes','cargas','carga_pedidos')
      and grantee in ('anon','authenticated')
      and privilege_type in ('INSERT','UPDATE','DELETE')
  ) then
    raise exception 'Fase 181: escrita direta permanece liberada em tabela protegida do Lote C';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='aplicar_creditos_cliente_pedido'
      and p.prosecdef
      and exists (select 1 from unnest(coalesce(p.proconfig,'{}'::text[])) x where x like 'search_path=%public%')
  ) then
    raise exception 'Fase 181: aplicar_creditos_cliente_pedido sem SECURITY DEFINER/search_path controlado';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='atualizar_dados_expedicao'
      and p.prosecdef
      and exists (select 1 from unnest(coalesce(p.proconfig,'{}'::text[])) x where x like 'search_path=%public%')
  ) then
    raise exception 'Fase 181: atualizar_dados_expedicao sem SECURITY DEFINER/search_path controlado';
  end if;

  raise notice 'Fase 181 OK: Lote C implantado com creditos, pedidos e logistica protegidos.';
end
$$;

select 'fase181_lote_c_ok' as gate, now() as checked_at;
