-- Fase 112: fecha RPCs legadas de baixa financeira e endurece a transicao de expedicao.
-- As baixas antigas atualizam apenas o titulo e podem contornar o fluxo financeiro atual
-- (receber_titulo/pagar_titulo), que tambem registra movimento bancario/caixa.
begin;

-- RPCs legadas: nao devem mais ser chamaveis pelo cliente.
do $$
declare
  r regprocedure;
begin
  r := to_regprocedure('public.baixar_receber(uuid,numeric,date)');
  if r is not null then
    execute format('revoke execute on function %s from public, anon, authenticated', r);
    execute format('grant execute on function %s to service_role', r);
  end if;

  r := to_regprocedure('public.baixar_pagar(uuid,numeric,date)');
  if r is not null then
    execute format('revoke execute on function %s from public, anon, authenticated', r);
    execute format('grant execute on function %s to service_role', r);
  end if;
end $$;

-- A transicao operacional de expedicao continua publica para usuarios autenticados,
-- mas nao pode herdar EXECUTE implicito de PUBLIC/anon.
do $$
declare
  r regprocedure;
begin
  r := to_regprocedure('public.avancar_expedicao(uuid,text,date)');
  if r is null then
    raise exception 'Fase 112: RPC avancar_expedicao(uuid,text,date) ausente';
  end if;

  execute format('revoke execute on function %s from public, anon', r);
  execute format('grant execute on function %s to authenticated, service_role', r);
end $$;

-- Helper de escopo usado por RLS/RPCs: apenas papeis internos autenticados precisam executa-lo.
do $$
declare
  r regprocedure;
begin
  r := to_regprocedure('public.usuario_pode_acessar_centro(uuid)');
  if r is null then
    raise exception 'Fase 112: helper usuario_pode_acessar_centro(uuid) ausente';
  end if;

  execute format('revoke execute on function %s from public, anon', r);
  execute format('grant execute on function %s to authenticated, service_role', r);
end $$;

-- Preflight local do perimetro.
do $$
declare
  r regprocedure;
begin
  foreach r in array array[
    to_regprocedure('public.baixar_receber(uuid,numeric,date)'),
    to_regprocedure('public.baixar_pagar(uuid,numeric,date)')
  ] loop
    if r is not null and (
      has_function_privilege('anon', r, 'EXECUTE')
      or has_function_privilege('authenticated', r, 'EXECUTE')
      or exists (
        select 1
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = r::oid
          and a.grantee = 0
          and a.privilege_type = 'EXECUTE'
      )
    ) then
      raise exception 'Fase 112: RPC legada ainda exposta ao cliente: %', r;
    end if;
  end loop;

  r := to_regprocedure('public.avancar_expedicao(uuid,text,date)');
  if has_function_privilege('anon', r, 'EXECUTE')
     or not has_function_privilege('authenticated', r, 'EXECUTE') then
    raise exception 'Fase 112: perimetro incorreto em avancar_expedicao: %', r;
  end if;

  r := to_regprocedure('public.usuario_pode_acessar_centro(uuid)');
  if has_function_privilege('anon', r, 'EXECUTE')
     or not has_function_privilege('authenticated', r, 'EXECUTE') then
    raise exception 'Fase 112: perimetro incorreto em usuario_pode_acessar_centro: %', r;
  end if;
end $$;

commit;
