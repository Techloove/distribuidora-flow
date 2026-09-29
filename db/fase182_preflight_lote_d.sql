-- Fase 182: preflight read-only para o Lote D (Fases 99-118).
-- Valida dependencias antes do hardening de acesso, minimo privilegio,
-- CRUD controlado de compras e fechamento de RPCs legadas.

do $$
declare
  faltantes text[] := '{}'::text[];
  obj text;
begin
  foreach obj in array array[
    'public.profiles',
    'public.user_roles',
    'public.usuario_centros',
    'public.pedidos',
    'public.pedido_itens',
    'public.compras',
    'public.compra_itens',
    'public.estoque_movimentos',
    'public.contas_receber',
    'public.contas_pagar',
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
    raise exception 'Fase 182: dependencias ausentes para o Lote D: %', array_to_string(faltantes, ', ');
  end if;

  if to_regprocedure('public.usuario_pode_acessar_centro(uuid)') is null then
    raise exception 'Fase 182: usuario_pode_acessar_centro(uuid) ausente';
  end if;
  if to_regprocedure('public.can_manage(uuid)') is null then
    raise exception 'Fase 182: can_manage(uuid) ausente';
  end if;
  if to_regprocedure('public.can_operate(uuid)') is null then
    raise exception 'Fase 182: can_operate(uuid) ausente';
  end if;
  if to_regprocedure('public.can_finance(uuid)') is null then
    raise exception 'Fase 182: can_finance(uuid) ausente';
  end if;
  if to_regprocedure('public.can_stock(uuid)') is null then
    raise exception 'Fase 182: can_stock(uuid) ausente';
  end if;
  if to_regprocedure('public.can_ship(uuid)') is null then
    raise exception 'Fase 182: can_ship(uuid) ausente';
  end if;

  raise notice 'Fase 182 OK: dependencias estruturais do Lote D presentes.';
end
$$;

select
  to_regprocedure('public.usuario_ativo()') is not null as usuario_ativo_existente,
  to_regprocedure('public.criar_compra_rascunho(uuid,uuid,date,text,text,text,numeric)') is not null as compra_controlada_existente,
  to_regprocedure('public.cancelar_compra(uuid)') is not null as cancelar_compra_existente;
