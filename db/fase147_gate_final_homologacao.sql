-- Fase 147: gate final de homologacao antes de liberar producao.
-- Nao altera dados nem privilegios; apenas valida invariantes criticos.
begin;

-- 1) Tabelas criticas devem existir, usar RLS e nao aceitar escrita direta do navegador.
do $$
declare
  t text;
  rel regclass;
  rls boolean;
  protegidas text[] := array[
    'pedidos','pedido_itens','compras','compra_itens',
    'estoque_movimentos','estoque_saldos','transferencias_estoque','transferencias_estoque_itens',
    'contas_receber','contas_pagar','comissoes','movimentos_financeiros','transferencias','boletos',
    'creditos_clientes','creditos_clientes_aplicacoes',
    'expedicoes','pedido_separacoes','cargas','carga_pedidos',
    'estornos_financeiros','pedido_operacoes','devolucao_operacoes'
  ];
begin
  foreach t in array protegidas loop
    rel := to_regclass('public.' || t);
    if rel is null then
      raise exception 'Fase 147: tabela critica ausente: %', t;
    end if;

    select c.relrowsecurity into rls
    from pg_class c
    where c.oid = rel;

    if coalesce(rls,false) = false then
      raise exception 'Fase 147: RLS desabilitado em public.%', t;
    end if;

    if has_table_privilege('anon', rel, 'INSERT')
       or has_table_privilege('anon', rel, 'UPDATE')
       or has_table_privilege('anon', rel, 'DELETE')
       or has_table_privilege('authenticated', rel, 'INSERT')
       or has_table_privilege('authenticated', rel, 'UPDATE')
       or has_table_privilege('authenticated', rel, 'DELETE') then
      raise exception 'Fase 147: escrita direta de cliente ainda liberada em public.%', t;
    end if;
  end loop;
end $$;

-- 2) Todas as SECURITY DEFINER chamaveis devem ter search_path controlado e negar PUBLIC/anon.
do $$
declare
  r record;
begin
  for r in
    select p.oid, p.oid::regprocedure as assinatura, p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
      and p.prorettype <> 'trigger'::regtype
  loop
    if not exists (
      select 1
      from unnest(coalesce(r.proconfig,array[]::text[])) x
      where x like 'search_path=%'
    ) then
      raise exception 'Fase 147: SECURITY DEFINER sem search_path: %', r.assinatura;
    end if;

    if exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = r.oid
        and a.grantee = 0
        and a.privilege_type = 'EXECUTE'
    ) then
      raise exception 'Fase 147: PUBLIC possui EXECUTE em %', r.assinatura;
    end if;

    if has_function_privilege('anon', r.oid, 'EXECUTE') then
      raise exception 'Fase 147: anon possui EXECUTE em %', r.assinatura;
    end if;
  end loop;
end $$;

-- 3) Overloads legados conhecidos nao podem existir.
do $$
begin
  if to_regprocedure('public.transferir_estoque(uuid,uuid,jsonb,text)') is not null then
    raise exception 'Fase 147: overload legado de transferir_estoque ainda existe';
  end if;

  if to_regprocedure('public.criar_pedido_rascunho(uuid,uuid,uuid,uuid,date,text,uuid)') is not null then
    raise exception 'Fase 147: overload legado de criar_pedido_rascunho ainda existe';
  end if;
end $$;

-- 4) Barreiras de unicidade/idempotencia indispensaveis.
do $$
begin
  if to_regclass('public.transferencias_estoque_idempotencia_uq') is null then
    raise exception 'Fase 147: indice de idempotencia de transferencias ausente';
  end if;
  if to_regclass('public.credito_aplicacao_idempotencia_uq') is null then
    raise exception 'Fase 147: indice de idempotencia de creditos ausente';
  end if;
  if to_regclass('public.contas_receber_pedido_parcela_uq') is null then
    raise exception 'Fase 147: indice unico de parcelas de pedido ausente';
  end if;
  if to_regclass('public.comissoes_pedido_ativa_uq') is null then
    raise exception 'Fase 147: indice unico de comissao ativa ausente';
  end if;
  if to_regclass('public.boletos_conta_ativa_uq') is null then
    raise exception 'Fase 147: indice de boleto ativo por titulo ausente';
  end if;
end $$;

-- 5) RPCs essenciais devem existir nas assinaturas endurecidas.
do $$
declare
  assinatura text;
  essenciais text[] := array[
    'public.transferir_estoque(uuid,uuid,jsonb,text,text)',
    'public.confirmar_pedido(uuid)',
    'public.cancelar_pedido(uuid)',
    'public.aplicar_creditos_cliente_pedido(uuid,numeric,text)',
    'public.emitir_boleto(uuid)',
    'public.liquidar_boleto(uuid,numeric,date)',
    'public.atualizar_dados_expedicao(uuid,uuid,text,text,date,numeric,numeric,uuid,text,text)'
  ];
begin
  foreach assinatura in array essenciais loop
    if to_regprocedure(assinatura) is null then
      raise exception 'Fase 147: RPC essencial ausente: %', assinatura;
    end if;
  end loop;
end $$;

-- 6) Segredos/configuracao Sicredi permanecem server-only.
do $$
begin
  if to_regclass('public.sicredi_config') is null then
    raise exception 'Fase 147: sicredi_config ausente';
  end if;

  if has_table_privilege('anon','public.sicredi_config','SELECT')
     or has_table_privilege('anon','public.sicredi_config','INSERT')
     or has_table_privilege('anon','public.sicredi_config','UPDATE')
     or has_table_privilege('anon','public.sicredi_config','DELETE')
     or has_table_privilege('authenticated','public.sicredi_config','SELECT')
     or has_table_privilege('authenticated','public.sicredi_config','INSERT')
     or has_table_privilege('authenticated','public.sicredi_config','UPDATE')
     or has_table_privilege('authenticated','public.sicredi_config','DELETE') then
    raise exception 'Fase 147: sicredi_config exposta ao cliente';
  end if;
end $$;

commit;
