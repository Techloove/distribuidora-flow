-- Fase 180: preflight read-only para o Lote C (Fases 80-89).
-- Objetivo: validar dependencias antes de aplicar creditos de cliente,
-- CRUD controlado de pedidos e hardening de expedicao/cargas.
-- Nao altera dados nem privilegios.

do $$
declare
  faltantes text[] := '{}'::text[];
  obj text;
begin
  foreach obj in array array[
    'public.pedidos',
    'public.pedido_itens',
    'public.produtos',
    'public.clientes',
    'public.centros',
    'public.devolucoes',
    'public.devolucao_itens',
    'public.contas_receber',
    'public.comissoes',
    'public.expedicoes',
    'public.pedido_separacoes',
    'public.cargas',
    'public.carga_pedidos',
    'public.auditoria'
  ] loop
    if to_regclass(obj) is null then
      faltantes := array_append(faltantes, obj);
    end if;
  end loop;

  if array_length(faltantes,1) is not null then
    raise exception 'Fase 180: dependencias ausentes para o Lote C: %', array_to_string(faltantes, ', ');
  end if;

  if to_regprocedure('public.usuario_pode_acessar_centro(uuid)') is null then
    raise exception 'Fase 180: usuario_pode_acessar_centro(uuid) ausente';
  end if;
  if to_regprocedure('public.can_operate(uuid)') is null then
    raise exception 'Fase 180: can_operate(uuid) ausente';
  end if;
  if to_regprocedure('public.can_ship(uuid)') is null then
    raise exception 'Fase 180: can_ship(uuid) ausente';
  end if;
  if to_regprocedure('public.registrar_movimento_estoque_controlado(uuid,uuid,text,numeric,numeric,text,uuid,text)') is null then
    raise exception 'Fase 180: motor de estoque controlado ausente';
  end if;
  if to_regprocedure('public.cancelar_pedido(uuid)') is null then
    raise exception 'Fase 180: cancelar_pedido(uuid) ausente';
  end if;
  if to_regprocedure('public.confirmar_devolucao(uuid)') is null then
    raise exception 'Fase 180: confirmar_devolucao(uuid) ausente';
  end if;

  raise notice 'Fase 180 OK: dependencias estruturais do Lote C presentes.';
end
$$;

select
  to_regclass('public.creditos_clientes') is not null as creditos_clientes_existente,
  to_regclass('public.creditos_clientes_aplicacoes') is not null as aplicacoes_credito_existente,
  to_regprocedure('public.criar_pedido_rascunho(uuid,uuid,uuid,uuid,date,text,uuid,date)') is not null as crud_pedido_controlado_existente,
  to_regprocedure('public.atualizar_dados_expedicao(uuid,uuid,text,text,date,numeric,numeric,uuid,text,text)') is not null as expedicao_controlada_existente;
