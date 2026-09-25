-- Fase 130: hardening da operação administrativa de limpeza total.
-- Preserva a implementação original, mas força confirmação explícita e papel admin no banco.
begin;

do $$
begin
  if to_regprocedure('public.admin_limpar_dados_interno_f130(text)') is null then
    if to_regprocedure('public.admin_limpar_dados(text)') is null then
      raise exception 'Fase 130: RPC admin_limpar_dados(text) ausente';
    end if;

    execute 'alter function public.admin_limpar_dados(text) rename to admin_limpar_dados_interno_f130';
  end if;
end $$;

-- A implementação original fica inacessível ao cliente.
revoke execute on function public.admin_limpar_dados_interno_f130(text)
  from public, anon, authenticated;
grant execute on function public.admin_limpar_dados_interno_f130(text)
  to service_role;

create or replace function public.admin_limpar_dados(_confirmacao text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'Apenas administradores podem limpar os dados do sistema';
  end if;

  if btrim(coalesce(_confirmacao,'')) <> 'LIMPAR' then
    raise exception 'Confirmação inválida. Digite LIMPAR';
  end if;

  perform public.admin_limpar_dados_interno_f130(_confirmacao);
end;
$$;

revoke execute on function public.admin_limpar_dados(text)
  from public, anon;
grant execute on function public.admin_limpar_dados(text)
  to authenticated, service_role;

-- Preflight do perímetro destrutivo.
do $$
declare
  r regprocedure;
  ri regprocedure;
  definicao text;
begin
  r := to_regprocedure('public.admin_limpar_dados(text)');
  ri := to_regprocedure('public.admin_limpar_dados_interno_f130(text)');

  if r is null or ri is null then
    raise exception 'Fase 130: wrapper ou implementação interna de limpeza ausente';
  end if;

  select pg_get_functiondef(r::oid) into definicao;
  if position('has_role(auth.uid(), ''admin'')' in definicao) = 0
     or position('LIMPAR' in definicao) = 0 then
    raise exception 'Fase 130: wrapper de limpeza sem guardas obrigatórias';
  end if;

  if has_function_privilege('anon',r,'EXECUTE') then
    raise exception 'Fase 130: anon ainda executa admin_limpar_dados';
  end if;

  if not has_function_privilege('authenticated',r,'EXECUTE') then
    raise exception 'Fase 130: authenticated sem acesso ao wrapper administrativo';
  end if;

  if has_function_privilege('anon',ri,'EXECUTE')
     or has_function_privilege('authenticated',ri,'EXECUTE') then
    raise exception 'Fase 130: implementação destrutiva interna exposta ao cliente';
  end if;

  if exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in (r::oid,ri::oid)
      and a.grantee=0
      and a.privilege_type='EXECUTE'
  ) then
    raise exception 'Fase 130: PUBLIC ainda executa função destrutiva';
  end if;
end $$;

commit;
