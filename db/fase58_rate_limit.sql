-- Fase 58: rate limit server-side para consultas externas.
create table if not exists public.api_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  acao text not null,
  janela_inicio timestamptz not null,
  quantidade integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, acao, janela_inicio)
);

create index if not exists api_rate_limits_updated_idx
  on public.api_rate_limits (updated_at);

alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from anon, authenticated;

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
  v_janela timestamptz;
  v_qtd integer;
begin
  if v_user is null then
    raise exception 'Usuário não autenticado';
  end if;
  if coalesce(trim(_acao), '') = '' then
    raise exception 'Ação de rate limit inválida';
  end if;
  if _limite < 1 or _limite > 1000 then
    raise exception 'Limite inválido';
  end if;
  if _janela_segundos < 1 or _janela_segundos > 86400 then
    raise exception 'Janela inválida';
  end if;

  v_janela := to_timestamp(
    floor(extract(epoch from now()) / _janela_segundos) * _janela_segundos
  );

  perform pg_advisory_xact_lock(hashtext(v_user::text || ':' || _acao || ':' || v_janela::text));

  insert into public.api_rate_limits(user_id, acao, janela_inicio, quantidade)
  values (v_user, trim(_acao), v_janela, 1)
  on conflict (user_id, acao, janela_inicio)
  do update set quantidade = public.api_rate_limits.quantidade + 1,
                updated_at = now()
  returning quantidade into v_qtd;

  if v_qtd > _limite then
    return false;
  end if;
  return true;
end;
$$;

grant execute on function public.consumir_rate_limit(text, integer, integer) to authenticated;
