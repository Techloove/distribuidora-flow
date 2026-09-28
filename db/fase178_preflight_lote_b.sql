-- Fase 178: preflight read-only para o Lote B (Fases 59-76).
-- Objetivo: validar dependencias antes de aplicar logistica, cancelamentos, financeiro,
-- concorrencia e idempotencia. Nao altera dados nem privilegios.

do $$
declare
  faltantes text[] := '{}'::text[];
  obj text;
begin
  foreach obj in array array[
    'public.pedidos',
    'public.pedido_itens',
    'public.compras',
    'public.compra_itens',
    'public.estoque_movimentos',
    'public.estoque_saldos',
    'public.transferencias_estoque',
    'public.transferencias_estoque_itens',
    'public.contas_receber',
    'public.contas_pagar',
    'public.contas_financeiras',
    'public.movimentos_financeiros',
    'public.transferencias',
    'public.comissoes',
    'public.boletos',
    'public.expedicoes',
    'public.pedido_separacoes',
    'public.cargas',
    'public.carga_pedidos',
    'public.devolucoes',
    'public.devolucao_itens',
    'public.auditoria'
  ] loop
    if to_regclass(obj) is null then
      faltantes := array_append(faltantes, obj);
    end if;
  end loop;

  if array_length(faltantes,1) is not null then
    raise exception 'Fase 178: dependencias ausentes para o Lote B: %', array_to_string(faltantes, ', ');
  end if;

  if to_regprocedure('public.usuario_pode_acessar_centro(uuid)') is null then
    raise exception 'Fase 178: usuario_pode_acessar_centro(uuid) ausente';
  end if;
  if to_regprocedure('public.can_operate(uuid)') is null then
    raise exception 'Fase 178: can_operate(uuid) ausente';
  end if;
  if to_regprocedure('public.can_stock(uuid)') is null then
    raise exception 'Fase 178: can_stock(uuid) ausente';
  end if;
  if to_regprocedure('public.can_finance(uuid)') is null then
    raise exception 'Fase 178: can_finance(uuid) ausente';
  end if;
  if to_regprocedure('public.can_ship(uuid)') is null then
    raise exception 'Fase 178: can_ship(uuid) ausente';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='pedidos' and column_name='centro_id') then
    raise exception 'Fase 178: pedidos.centro_id ausente';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='compras' and column_name='centro_id') then
    raise exception 'Fase 178: compras.centro_id ausente';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contas_receber' and column_name='centro_id') then
    raise exception 'Fase 178: contas_receber.centro_id ausente';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contas_pagar' and column_name='centro_id') then
    raise exception 'Fase 178: contas_pagar.centro_id ausente';
  end if;

  raise notice 'Fase 178 OK: dependencias estruturais do Lote B presentes.';
end
$$;

select
  to_regclass('public.pedido_operacoes') is not null as pedido_operacoes_existente,
  to_regclass('public.devolucao_operacoes') is not null as devolucao_operacoes_existente,
  to_regclass('public.estornos_financeiros') is not null as estornos_financeiros_existente,
  to_regprocedure('public.transferir_estoque(uuid,uuid,jsonb,text,text)') is not null as transferencia_idempotente_existente,
  to_regprocedure('public.registrar_movimento_estoque_controlado(uuid,uuid,text,numeric,numeric,text,uuid,text)') is not null as estoque_controlado_existente;