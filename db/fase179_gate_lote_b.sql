-- Fase 179: gate read-only pos-Lote B.
-- Executar depois das Fases 59-76.

do $$
declare
  v_rls boolean;
begin
  if to_regclass('public.pedido_operacoes') is null then
    raise exception 'Fase 179: pedido_operacoes ausente';
  end if;
  if to_regclass('public.devolucao_operacoes') is null then
    raise exception 'Fase 179: devolucao_operacoes ausente';
  end if;
  if to_regclass('public.estornos_financeiros') is null then
    raise exception 'Fase 179: estornos_financeiros ausente';
  end if;

  if to_regprocedure('public.transferir_estoque(uuid,uuid,jsonb,text)') is not null then
    raise exception 'Fase 179: overload legado transferir_estoque(...,text) ainda existe';
  end if;
  if to_regprocedure('public.transferir_estoque(uuid,uuid,jsonb,text,text)') is null then
    raise exception 'Fase 179: transferencia de estoque idempotente ausente';
  end if;
  if to_regprocedure('public.confirmar_pedido(uuid)') is null then
    raise exception 'Fase 179: confirmar_pedido(uuid) ausente';
  end if;
  if to_regprocedure('public.receber_compra(uuid)') is null then
    raise exception 'Fase 179: receber_compra(uuid) ausente';
  end if;
  if to_regprocedure('public.estornar_movimento_financeiro(uuid,text)') is null then
    raise exception 'Fase 179: estornar_movimento_financeiro(uuid,text) ausente';
  end if;
  if to_regprocedure('public.estornar_transferencia_financeira(uuid,text)') is null then
    raise exception 'Fase 179: estornar_transferencia_financeira(uuid,text) ausente';
  end if;

  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='contas_pagar_compra_parcela_uq') then
    raise exception 'Fase 179: indice contas_pagar_compra_parcela_uq ausente';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='contas_receber_pedido_parcela_uq') then
    raise exception 'Fase 179: indice contas_receber_pedido_parcela_uq ausente';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='estornos_financeiros_mov_uq') then
    raise exception 'Fase 179: indice de idempotencia de estorno por movimento ausente';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='estornos_financeiros_transfer_uq') then
    raise exception 'Fase 179: indice de idempotencia de estorno por transferencia ausente';
  end if;

  select c.relrowsecurity into v_rls
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='movimentos_financeiros';
  if coalesce(v_rls,false)=false then
    raise exception 'Fase 179: RLS nao habilitado em movimentos_financeiros';
  end if;

  select c.relrowsecurity into v_rls
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='transferencias';
  if coalesce(v_rls,false)=false then
    raise exception 'Fase 179: RLS nao habilitado em transferencias';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema='public'
      and table_name in ('estoque_movimentos','movimentos_financeiros','transferencias','contas_receber','contas_pagar','comissoes')
      and grantee='authenticated'
      and privilege_type in ('INSERT','UPDATE','DELETE')
  ) then
    raise exception 'Fase 179: escrita direta permanece liberada em tabela transacional do Lote B';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='transferir_estoque'
      and p.prosecdef
      and exists (select 1 from unnest(coalesce(p.proconfig,'{}'::text[])) x where x like 'search_path=%public%')
  ) then
    raise exception 'Fase 179: transferir_estoque sem SECURITY DEFINER/search_path controlado';
  end if;

  raise notice 'Fase 179 OK: Lote B implantado com controles principais de concorrencia, idempotencia e minimo privilegio.';
end
$$;

select 'fase179_lote_b_ok' as gate, now() as checked_at;