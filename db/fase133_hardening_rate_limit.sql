-- Fase 133: hardening do rate limit usado pelas funcoes server-side.
begin;

create or replace function public.consumir_rate_limit(
  _acao text,
  _limite integer default 30,
  _janela_segundos integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_acao text := btrim(coalesce(_acao,''));
  v_janela timestamptz;
  v_qtd integer;
begin
  if v_user is null then
    raise exception 'Usuario nao autenticado';
  end if;

  if v_acao = '' or length(v_acao) > 100
     or v_acao !~ '^[a-zA-Z0-9:_-]+$' then
    raise exception 'Acao de rate limit invalida';
  end if;

  if _limite < 1 or _limite > 1000 then
    raise exception 'Limite invalido';
  end if;

  if _janela_segundos < 1 or _janela_segundos > 86400 then
    raise exception 'Janela invalida';
  end if;

  v_janela := to_timestamp(
    floor(extract(epoch from now()) / _janela_segundos) * _janela_segundos
  );

  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':' || v_acao || ':' || v_janela::text, 0)
  );

  insert into public.api_rate_limits(user_id,acao,janela_inicio,quantidade)
  values(v_user,v_acao,v_janela,1)
  on conflict(user_id,acao,janela_inicio)
  do update
     set quantidade=public.api_rate_limits.quantidade+1,
         updated_at=now()
  returning quantidade into v_qtd;

  return v_qtd <= _limite;
end;
$$;

revoke execute on function public.consumir_rate_limit(text,integer,integer)
  from public, anon;
grant execute on function public.consumir_rate_limit(text,integer,integer)
  to authenticated, service_role;

do $$
declare
  r regprocedure := to_regprocedure('public.consumir_rate_limit(text,integer,integer)');
begin
  if r is null then raise exception 'Fase 133: consumir_rate_limit ausente'; end if;
  if has_function_privilege('anon',r,'EXECUTE')
     or not has_function_privilege('authenticated',r,'EXECUTE') then
    raise exception 'Fase 133: perimetro incorreto em consumir_rate_limit';
  end if;
  if exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=r::oid and a.grantee=0 and a.privilege_type='EXECUTE'
  ) then
    raise exception 'Fase 133: PUBLIC ainda executa consumir_rate_limit';
  end if;
end $$;

commit;
