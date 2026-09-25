-- Fase 111: hardening da transicao de compra rascunho -> comprado.
-- Corrige escopo por centro e fecha EXECUTE implicito de PUBLIC/anon.
begin;

create or replace function public.marcar_compra_comprada(_compra_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cmp public.compras;
begin
  if not public.can_stock(auth.uid()) and not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para alterar compras';
  end if;

  select * into cmp
  from public.compras
  where id = _compra_id
  for update;

  if cmp.id is null then
    raise exception 'Compra nao encontrada';
  end if;

  if cmp.centro_id is null or not public.usuario_pode_acessar_centro(cmp.centro_id) then
    raise exception 'Compra pertence a outro centro ou nao possui centro';
  end if;

  if cmp.status <> 'rascunho' then
    raise exception 'Somente compras em rascunho podem ser marcadas como compradas';
  end if;

  if not exists (select 1 from public.compra_itens where compra_id = _compra_id) then
    raise exception 'Inclua ao menos um item na compra';
  end if;

  perform public.recalcular_compra(_compra_id);
  update public.compras
     set status = 'comprado'
   where id = _compra_id;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values(
    'compras',_compra_id,'marcar_comprada',
    jsonb_build_object('centro_id',cmp.centro_id,'status_anterior',cmp.status),
    auth.uid()
  );
end;
$$;

revoke all on function public.marcar_compra_comprada(uuid) from public, anon;
grant execute on function public.marcar_compra_comprada(uuid) to authenticated, service_role;

-- Preflight local: a RPC deve existir, estar fechada para PUBLIC/anon e manter search_path.
do $$
declare
  r regprocedure;
  cfg text[];
begin
  r := to_regprocedure('public.marcar_compra_comprada(uuid)');
  if r is null then
    raise exception 'Fase 111: RPC marcar_compra_comprada(uuid) ausente';
  end if;

  if has_function_privilege('anon', r, 'EXECUTE') then
    raise exception 'Fase 111: anon ainda executa %', r;
  end if;

  if exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = r::oid
      and a.grantee = 0
      and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'Fase 111: PUBLIC ainda executa %', r;
  end if;

  select p.proconfig into cfg from pg_proc p where p.oid = r::oid;
  if not exists (
    select 1 from unnest(coalesce(cfg,array[]::text[])) x
    where x like 'search_path=%'
  ) then
    raise exception 'Fase 111: SECURITY DEFINER sem search_path controlado: %', r;
  end if;
end $$;

commit;