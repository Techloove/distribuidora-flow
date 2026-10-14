-- Fase223: um formulário de convênio, gravação atômica API + CNAB.
-- Aplicar após fase222. Não altera credenciais, históricos ou sequenciais na migração.
begin;

do $$ begin
  if (select count(*) from public.sicredi_config)>1 or
     (select count(*) from public.sicredi_cnab_config)>1 then
    raise exception 'Aplique as fases135 e208 para manter um unico convenio';
  end if;
end $$;

-- Mantém a validação e a proteção de histórico da fase208 como auxiliar privado.
do $$ begin
  if to_regprocedure('public.cnab_salvar_config_fase208(uuid,jsonb)') is null then
    alter function public.cnab_salvar_config(uuid,jsonb) rename to cnab_salvar_config_fase208;
  end if;
end $$;
revoke all on function public.cnab_salvar_config_fase208(uuid,jsonb) from public,anon,authenticated,service_role;

-- Chamadas antigas recebem orientação em vez de reintroduzir configurações divergentes.
create or replace function public.cnab_salvar_config(_actor uuid,_config jsonb) returns void
language plpgsql security definer set search_path=public as $$
begin
  raise exception 'Use Configuracoes > Cobranca Sicredi para salvar o convenio unico (fase223)';
end;
$$;
revoke all on function public.cnab_salvar_config(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cnab_salvar_config(uuid,jsonb) to service_role;

create or replace function public.sicredi_salvar_convenio_223(
  _actor uuid,_api jsonb,_cnab jsonb,_confirmar boolean default false
) returns void language plpgsql security definer set search_path=public as $$
declare a public.sicredi_config; c public.sicredi_cnab_config; v public.sicredi_config; novo_cnab jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' or not public.has_role(_actor,'admin')
    or not exists(select 1 from public.profiles where id=_actor and ativo=true) then
    raise exception 'Somente administrador ativo configura o convenio Sicredi';
  end if;
  if jsonb_typeof(_api) is distinct from 'object' then raise exception 'Dados do convenio invalidos'; end if;
  perform pg_advisory_xact_lock(748208);
  -- Mesma ordem da rotina CNAB: configuração antes de boletos.
  select * into c from public.sicredi_cnab_config for update;
  select * into a from public.sicredi_config for update;
  v := jsonb_populate_record(coalesce(a,null::public.sicredi_config),_api);
  if v.cooperativa is null or v.cooperativa !~ '^[0-9]{4}$' or v.posto is null or v.posto !~ '^[0-9]{2}$'
    or v.codigo_beneficiario is null or v.codigo_beneficiario !~ '^[0-9]{5}$' then
    raise exception 'Informe cooperativa (4), posto (2) e beneficiario (5 digitos)';
  end if;
  if v.ambiente not in ('homologacao','producao') or v.tipo_cobranca not in ('NORMAL','HIBRIDO')
    or v.tipo_juro not in ('ISENTO','PERCENTUAL','VALOR') or v.juros<0 or v.multa not between 0 and 100 then
    raise exception 'Regras de cobranca invalidas';
  end if;
  if c.centro_id is not null and a.cooperativa is not null and
    row(a.cooperativa,a.posto,a.codigo_beneficiario,a.tipo_cobranca,
      case when a.tipo_juro='ISENTO' then 0 else a.juros end,a.multa)
    is distinct from row(c.cooperativa,c.posto,c.beneficiario,c.tipo_cobranca,c.juros_mensal,c.multa_percentual)
    and not coalesce(_confirmar,false) then
    raise exception 'Confira as diferencas entre API e CNAB e confirme a unificacao';
  end if;
  -- Não troca convênio de títulos já reservados, emitidos ou com falha.
  if exists(select 1 from public.boletos where banco='sicredi' and
    row(cooperativa,posto,codigo_beneficiario) is distinct from row(v.cooperativa,v.posto,v.codigo_beneficiario)) then
    raise exception 'Existem boletos Sicredi em outro convenio. Preserve a identificacao bancaria';
  end if;
  if c.centro_id is not null and _cnab is null then
    raise exception 'Mantenha os dados CNAB existentes no convenio unico';
  end if;
  if _cnab is not null then
    if jsonb_typeof(_cnab) is distinct from 'object' then raise exception 'Dados CNAB invalidos'; end if;
    if v.tipo_juro='VALOR' then raise exception 'CNAB compartilhado requer juros mensais ou isento'; end if;
    novo_cnab := (_cnab - 'centro_id') || jsonb_build_object('cooperativa',v.cooperativa,'posto',v.posto,
      'beneficiario',v.codigo_beneficiario,'tipo_cobranca',v.tipo_cobranca,
      'juros_mensal',case when v.tipo_juro='ISENTO' then 0 else v.juros end,'multa_percentual',v.multa);
    -- Ignora cópias antigas dos contadores no navegador. Nunca retrocede ou reinicia.
    if c.centro_id is not null then
      novo_cnab := novo_cnab || jsonb_build_object('centro_id',c.centro_id,
        'proxima_remessa',c.proxima_remessa,'proximo_nosso_numero',c.proximo_nosso_numero);
    end if;
    perform public.cnab_salvar_config_fase208(_actor,novo_cnab);
  end if;
  v.api_key := coalesce(nullif(btrim(_api->>'api_key'),''),a.api_key);
  v.password := coalesce(nullif(_api->>'password',''),a.password);
  insert into public.sicredi_config(id,api_key,username,password,cooperativa,posto,codigo_beneficiario,
    ambiente,tipo_cobranca,especie_documento,tipo_juro,juros,multa,dias_multa,tipo_desconto,
    valor_desconto1,dias_desconto1,tipo_protesto,dias_protesto,validade_apos_vencimento,informativo,mensagem)
  values(coalesce(a.id,gen_random_uuid()),v.api_key,v.username,v.password,v.cooperativa,v.posto,v.codigo_beneficiario,
    v.ambiente,v.tipo_cobranca,v.especie_documento,v.tipo_juro,v.juros,v.multa,v.dias_multa,v.tipo_desconto,
    v.valor_desconto1,v.dias_desconto1,v.tipo_protesto,v.dias_protesto,v.validade_apos_vencimento,v.informativo,v.mensagem)
  on conflict(id) do update set api_key=excluded.api_key,username=excluded.username,password=excluded.password,
    cooperativa=excluded.cooperativa,posto=excluded.posto,codigo_beneficiario=excluded.codigo_beneficiario,
    ambiente=excluded.ambiente,tipo_cobranca=excluded.tipo_cobranca,especie_documento=excluded.especie_documento,
    tipo_juro=excluded.tipo_juro,juros=excluded.juros,multa=excluded.multa,dias_multa=excluded.dias_multa,
    tipo_desconto=excluded.tipo_desconto,valor_desconto1=excluded.valor_desconto1,dias_desconto1=excluded.dias_desconto1,
    tipo_protesto=excluded.tipo_protesto,dias_protesto=excluded.dias_protesto,
    validade_apos_vencimento=excluded.validade_apos_vencimento,informativo=excluded.informativo,
    mensagem=excluded.mensagem,updated_at=clock_timestamp();
  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
    values('sicredi_config',coalesce(a.id,(select id from public.sicredi_config)),
      'configurar_convenio_unico',jsonb_build_object('cnab',_cnab is not null,'ambiente',v.ambiente),_actor);
end;
$$;
revoke all on function public.sicredi_salvar_convenio_223(uuid,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.sicredi_salvar_convenio_223(uuid,jsonb,jsonb,boolean) to service_role;
notify pgrst,'reload schema';
commit;
