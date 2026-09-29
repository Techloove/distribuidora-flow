-- Fase 122: protege a view de boletos pendentes e fecha o vínculo servidor -> título/centro.
begin;

do $$
begin
  if to_regclass('public.vw_boletos_pendentes') is not null then
    execute 'alter view public.vw_boletos_pendentes set (security_invoker = on)';
  end if;
end $$;

-- Preflight local: a view de faturamento não pode executar com privilégios do owner.
do $$
declare
  opts text[];
begin
  if to_regclass('public.vw_boletos_pendentes') is null then
    raise exception 'Fase 122: view public.vw_boletos_pendentes ausente';
  end if;

  select c.reloptions into opts
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public'
    and c.relname='vw_boletos_pendentes'
    and c.relkind='v';

  if not ('security_invoker=true' = any(coalesce(opts,array[]::text[]))) then
    raise exception 'Fase 122: vw_boletos_pendentes sem security_invoker=true';
  end if;
end $$;

commit;
