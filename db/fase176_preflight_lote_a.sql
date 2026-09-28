-- Fase 176: preflight read-only para o Lote A (Fases 48, 51, 54-58).
-- Objetivo: falhar cedo se o schema base nao possuir dependencias exigidas pelo hardening.
-- Nao altera dados nem privilegios.

do $$
declare
  faltantes text[] := '{}'::text[];
  obj text;
begin
  foreach obj in array array[
    'public.papeis',
    'public.user_roles',
    'public.profiles',
    'public.usuario_centros',
    'public.produtos',
    'public.pedido_itens',
    'public.pedidos',
    'public.centros',
    'public.estoque_movimentos',
    'public.compras',
    'public.compra_itens',
    'public.boletos',
    'public.contas_receber',
    'public.contas_pagar',
    'public.comissoes',
    'public.auditoria'
  ] loop
    if to_regclass(obj) is null then
      faltantes := array_append(faltantes, obj);
    end if;
  end loop;

  if array_length(faltantes, 1) is not null then
    raise exception 'Fase 176: dependencias de tabela ausentes para o Lote A: %', array_to_string(faltantes, ', ');
  end if;

  if to_regprocedure('public.has_role(uuid,text)') is null
     and to_regprocedure('public.has_role(uuid,public.app_role)') is null then
    raise exception 'Fase 176: funcao has_role esperada nao foi encontrada';
  end if;

  if to_regprocedure('public.can_finance(uuid)') is null then
    raise exception 'Fase 176: funcao can_finance(uuid) ausente';
  end if;

  if to_regprocedure('public.can_stock(uuid)') is null then
    raise exception 'Fase 176: funcao can_stock(uuid) ausente';
  end if;

  if to_regprocedure('public.can_ship(uuid)') is null then
    raise exception 'Fase 176: funcao can_ship(uuid) ausente';
  end if;

  if to_regprocedure('public.tem_permissao(text)') is null then
    raise exception 'Fase 176: funcao tem_permissao(text) ausente';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='profiles' and column_name='todos_centros'
  ) then
    raise exception 'Fase 176: coluna profiles.todos_centros ausente';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='estoque_movimentos' and column_name='centro_id'
  ) then
    raise exception 'Fase 176: coluna estoque_movimentos.centro_id ausente';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='produtos' and column_name='centro_id'
  ) then
    raise exception 'Fase 176: coluna produtos.centro_id ausente';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='boletos' and column_name='conta_receber_id'
  ) then
    raise exception 'Fase 176: coluna boletos.conta_receber_id ausente';
  end if;

  raise notice 'Fase 176 OK: dependencias estruturais do Lote A presentes.';
end
$$;

-- Diagnostico complementar: informa se as estruturas do Lote A ja existem.
select
  to_regclass('public.estoque_saldos') is not null as estoque_saldos_existente,
  to_regclass('public.api_rate_limits') is not null as api_rate_limits_existente,
  to_regprocedure('public.usuario_pode_acessar_centro(uuid)') is not null as acesso_centro_existente,
  to_regprocedure('public.consumir_rate_limit(text,integer,integer)') is not null as rate_limit_rpc_existente,
  to_regclass('public.vw_sugestao_compras_centro') is not null as planejamento_centro_existente;