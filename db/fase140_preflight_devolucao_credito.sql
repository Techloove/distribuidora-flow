-- Fase 140: preflight da reconciliacao devolucao -> credito de cliente.
-- Garante que a implementacao legada de credito negativo em contas_receber
-- esteja realmente supersedida pela arquitetura de creditos_clientes.
-- Nao altera dados de negocio.
begin;

do $$
declare
  r_confirmar regprocedure := to_regprocedure('public.confirmar_devolucao(uuid)');
  r_criar regprocedure := to_regprocedure('public.criar_credito_devolucao(uuid,uuid,uuid,numeric,text)');
  def_confirmar text;
  def_criar text;
begin
  if r_confirmar is null then
    raise exception 'Fase 140: confirmar_devolucao(uuid) ausente';
  end if;

  if r_criar is null then
    raise exception 'Fase 140: criar_credito_devolucao(uuid,uuid,uuid,numeric,text) ausente';
  end if;

  select pg_get_functiondef(r_confirmar::oid) into def_confirmar;
  select pg_get_functiondef(r_criar::oid) into def_criar;

  -- A confirmacao atual deve gerar credito estruturado, nao titulo negativo DEV-*.
  if position('criar_credito_devolucao' in def_confirmar) = 0 then
    raise exception 'Fase 140: confirmar_devolucao nao chama criar_credito_devolucao';
  end if;

  if position('DEV-' in def_confirmar) > 0
     or position('insert into public.contas_receber' in lower(def_confirmar)) > 0 then
    raise exception 'Fase 140: confirmar_devolucao ainda contem fluxo legado de credito negativo';
  end if;

  -- O credito deve ser idempotente por devolucao.
  if to_regclass('public.creditos_clientes_devolucao_uq') is null then
    raise exception 'Fase 140: indice unico por devolucao ausente em creditos_clientes';
  end if;

  if position('for update' in lower(def_criar)) = 0 then
    raise exception 'Fase 140: criar_credito_devolucao sem lock de concorrencia';
  end if;

  if position('devolucao_id = _devolucao_id' in def_criar) = 0 then
    raise exception 'Fase 140: criar_credito_devolucao sem busca idempotente por devolucao';
  end if;

  -- Nenhuma das tabelas de credito pode aceitar escrita direta do navegador.
  if has_table_privilege('anon','public.creditos_clientes','INSERT')
     or has_table_privilege('anon','public.creditos_clientes','UPDATE')
     or has_table_privilege('anon','public.creditos_clientes','DELETE')
     or has_table_privilege('authenticated','public.creditos_clientes','INSERT')
     or has_table_privilege('authenticated','public.creditos_clientes','UPDATE')
     or has_table_privilege('authenticated','public.creditos_clientes','DELETE') then
    raise exception 'Fase 140: creditos_clientes possui escrita direta de cliente';
  end if;

  if has_table_privilege('anon','public.creditos_clientes_aplicacoes','INSERT')
     or has_table_privilege('anon','public.creditos_clientes_aplicacoes','UPDATE')
     or has_table_privilege('anon','public.creditos_clientes_aplicacoes','DELETE')
     or has_table_privilege('authenticated','public.creditos_clientes_aplicacoes','INSERT')
     or has_table_privilege('authenticated','public.creditos_clientes_aplicacoes','UPDATE')
     or has_table_privilege('authenticated','public.creditos_clientes_aplicacoes','DELETE') then
    raise exception 'Fase 140: creditos_clientes_aplicacoes possui escrita direta de cliente';
  end if;

  -- As RPCs expostas devem estar protegidas de PUBLIC/anon.
  if has_function_privilege('anon', r_confirmar, 'EXECUTE') then
    raise exception 'Fase 140: anon ainda executa confirmar_devolucao';
  end if;

  if has_function_privilege('anon', r_criar, 'EXECUTE') then
    raise exception 'Fase 140: anon ainda executa criar_credito_devolucao';
  end if;

  if exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in (r_confirmar::oid, r_criar::oid)
      and a.grantee = 0
      and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'Fase 140: PUBLIC ainda executa RPC de devolucao/credito';
  end if;
end $$;

commit;
