-- Fase 139: preflight de idempotencia e concorrencia apos reconciliacao com revisoes externas/Codex.
-- Nao altera dados de negocio; aborta se as barreiras criticas nao estiverem presentes.
begin;

-- 1) Transferencia de estoque: assinatura unica, contexto persistido e lock por chave.
do $$
declare
  r regprocedure := to_regprocedure('public.transferir_estoque(uuid,uuid,jsonb,text,text)');
  def text;
  cfg text[];
begin
  if r is null then
    raise exception 'Fase 139: transferir_estoque(uuid,uuid,jsonb,text,text) ausente';
  end if;

  if to_regprocedure('public.transferir_estoque(uuid,uuid,jsonb,text)') is not null then
    raise exception 'Fase 139: overload legado de transferir_estoque ainda existe';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='transferencias_estoque'
      and column_name='idempotencia_contexto'
  ) then
    raise exception 'Fase 139: transferencias_estoque.idempotencia_contexto ausente';
  end if;

  if to_regclass('public.transferencias_estoque_idempotencia_uq') is null then
    raise exception 'Fase 139: indice unico de idempotencia de transferencia ausente';
  end if;

  select pg_get_functiondef(p.oid), p.proconfig
    into def, cfg
    from pg_proc p
   where p.oid = r::oid;

  if position('pg_advisory_xact_lock' in def) = 0
     or position('idempotencia_contexto' in def) = 0 then
    raise exception 'Fase 139: transferir_estoque sem lock/contexto de idempotencia esperado';
  end if;

  if not exists (select 1 from unnest(coalesce(cfg,array[]::text[])) x where x like 'search_path=%') then
    raise exception 'Fase 139: transferir_estoque sem search_path controlado';
  end if;

  if has_function_privilege('anon', r, 'EXECUTE') then
    raise exception 'Fase 139: anon ainda executa transferir_estoque';
  end if;
end $$;

-- 2) Creditos: contexto persistido, chave reutilizavel por credito e serializacao da operacao logica.
do $$
declare
  r regprocedure := to_regprocedure('public.aplicar_creditos_cliente_pedido(uuid,numeric,text)');
  def text;
  cfg text[];
begin
  if r is null then
    raise exception 'Fase 139: aplicar_creditos_cliente_pedido(uuid,numeric,text) ausente';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='creditos_clientes_aplicacoes'
      and column_name='idempotencia_contexto'
  ) then
    raise exception 'Fase 139: creditos_clientes_aplicacoes.idempotencia_contexto ausente';
  end if;

  if to_regclass('public.credito_aplicacao_idempotencia_uq') is null then
    raise exception 'Fase 139: indice de idempotencia de aplicacao de credito ausente';
  end if;

  select pg_get_functiondef(p.oid), p.proconfig
    into def, cfg
    from pg_proc p
   where p.oid = r::oid;

  if position('pg_advisory_xact_lock' in def) = 0
     or position('idempotencia_contexto' in def) = 0 then
    raise exception 'Fase 139: aplicacao multipla de creditos sem lock/contexto de idempotencia esperado';
  end if;

  if not exists (select 1 from unnest(coalesce(cfg,array[]::text[])) x where x like 'search_path=%') then
    raise exception 'Fase 139: aplicar_creditos_cliente_pedido sem search_path controlado';
  end if;

  if has_function_privilege('anon', r, 'EXECUTE') then
    raise exception 'Fase 139: anon ainda executa aplicar_creditos_cliente_pedido';
  end if;
end $$;

-- 3) Barreiras finais de duplicidade no faturamento.
do $$
begin
  if to_regclass('public.contas_receber_pedido_parcela_uq') is null then
    raise exception 'Fase 139: indice unico de parcela por pedido ausente';
  end if;
  if to_regclass('public.comissoes_pedido_uq') is null then
    raise exception 'Fase 139: indice unico de comissao por pedido ausente';
  end if;
end $$;

commit;