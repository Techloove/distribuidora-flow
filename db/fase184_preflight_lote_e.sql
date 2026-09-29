-- Fase 184: preflight read-only para o Lote E (Fases 119-135).
-- Valida dependencias antes do hardening Sicredi server-only,
-- idempotencia de emissao/persistencia e rate limit.

do $$
declare
  faltantes text[] := '{}'::text[];
  obj text;
begin
  foreach obj in array array[
    'public.boletos',
    'public.contas_receber',
    'public.clientes',
    'public.pedidos',
    'public.sicredi_config',
    'public.api_rate_limits',
    'public.auditoria',
    'public.profiles',
    'public.user_roles'
  ] loop
    if to_regclass(obj) is null then
      faltantes := array_append(faltantes, obj);
    end if;
  end loop;

  if array_length(faltantes,1) is not null then
    raise exception 'Fase 184: dependencias ausentes para o Lote E: %', array_to_string(faltantes, ', ');
  end if;

  if to_regprocedure('public.usuario_pode_acessar_centro(uuid)') is null then
    raise exception 'Fase 184: usuario_pode_acessar_centro(uuid) ausente';
  end if;
  if to_regprocedure('public.can_finance(uuid)') is null then
    raise exception 'Fase 184: can_finance(uuid) ausente';
  end if;

  raise notice 'Fase 184 OK: dependencias estruturais do Lote E presentes.';
end
$$;

select
  to_regclass('public.boletos_conta_ativa_uq') is not null as indice_boleto_ativo_existente,
  to_regprocedure('public.preparar_boleto_sicredi_servidor(uuid,uuid)') is not null as reserva_server_only_existente,
  to_regprocedure('public.consumir_rate_limit(text,integer,integer)') is not null as rate_limit_existente;
