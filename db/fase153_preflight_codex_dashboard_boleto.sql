-- Fase 153: preflight das correcoes reconciliadas com a revisao Codex.
-- Nao altera dados; falha se dashboard ou liquidacao de boleto estiverem fora do perimetro esperado.
begin;

do $$
declare
  r regprocedure;
  def text;
  secdef boolean;
begin
  r := to_regprocedure('public.dashboard_resumo(uuid)');
  if r is null then
    raise exception 'Fase 153: dashboard_resumo(uuid) ausente';
  end if;

  select pg_get_functiondef(r::oid), p.prosecdef
    into def, secdef
    from pg_proc p
   where p.oid = r::oid;

  if secdef then
    raise exception 'Fase 153: dashboard_resumo deve executar como SECURITY INVOKER';
  end if;

  if position('usuario_pode_acessar_centro' in def) = 0
     or position('estoque_saldos' in def) = 0
     or position('contas_receber' in def) = 0
     or position('contas_pagar' in def) = 0 then
    raise exception 'Fase 153: dashboard_resumo nao contem os controles/aggregacoes esperados';
  end if;

  if has_function_privilege('anon', r, 'EXECUTE') then
    raise exception 'Fase 153: anon executa dashboard_resumo';
  end if;

  if not has_function_privilege('authenticated', r, 'EXECUTE') then
    raise exception 'Fase 153: authenticated sem EXECUTE em dashboard_resumo';
  end if;
end $$;

do $$
declare
  r regprocedure;
  def text;
  cfg text[];
begin
  r := to_regprocedure('public.liquidar_boleto(uuid,numeric,date)');
  if r is null then
    raise exception 'Fase 153: liquidar_boleto(uuid,numeric,date) ausente';
  end if;

  select pg_get_functiondef(p.oid), p.proconfig
    into def, cfg
    from pg_proc p
   where p.oid = r::oid;

  if position('security definer' in lower(def)) = 0 then
    raise exception 'Fase 153: liquidar_boleto nao e SECURITY DEFINER';
  end if;

  if not exists (
    select 1 from unnest(coalesce(cfg,array[]::text[])) x
     where x like 'search_path=%'
  ) then
    raise exception 'Fase 153: liquidar_boleto sem search_path controlado';
  end if;

  if position('if b.status = ''liquidado''' in lower(def)) = 0
     or position('valor_liquidado' in lower(def)) = 0
     or position('receber_titulo' in lower(def)) = 0 then
    raise exception 'Fase 153: liquidar_boleto sem idempotencia/baixa centralizada esperada';
  end if;

  if has_function_privilege('anon', r, 'EXECUTE') then
    raise exception 'Fase 153: anon executa liquidar_boleto';
  end if;

  if not has_function_privilege('authenticated', r, 'EXECUTE') then
    raise exception 'Fase 153: authenticated sem EXECUTE em liquidar_boleto';
  end if;
end $$;

do $$
begin
  if has_table_privilege('anon','public.boletos','INSERT')
     or has_table_privilege('anon','public.boletos','UPDATE')
     or has_table_privilege('anon','public.boletos','DELETE')
     or has_table_privilege('authenticated','public.boletos','INSERT')
     or has_table_privilege('authenticated','public.boletos','UPDATE')
     or has_table_privilege('authenticated','public.boletos','DELETE') then
    raise exception 'Fase 153: escrita direta em boletos ainda liberada ao cliente';
  end if;
end $$;

commit;
