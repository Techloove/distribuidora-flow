-- Sicredi API: escolha explícita para novas emissões. Não altera configuração nem boletos existentes.
begin;
alter table public.boletos add column if not exists sicredi_tipo_emissao_364 text
 check (sicredi_tipo_emissao_364 in ('NORMAL','HIBRIDO'));
create or replace function public.salvar_cobranca_centro_237(
 _actor uuid,_centro uuid,_banco text,_ativo boolean,_conta uuid,_api jsonb
) returns void language plpgsql security definer set search_path=public as $$
declare a public.sicredi_config; v public.sicredi_config; c public.cobranca_centros;
begin
 perform public.validar_cobranca_centro_237(_actor,_centro);
 if not public.has_role(_actor,'admin') then raise exception 'Somente administrador configura a cobranca'; end if;
 -- Mesmo mutex usado nas configurações antigas. Não há redefinição de sequências.
 perform pg_advisory_xact_lock(748208);
 select * into a from public.sicredi_config for update;
 select * into c from public.cobranca_centros where centro_id=_centro for update;
 if _banco is null or _banco not in ('sicredi','sicoob','indefinido') or _ativo is null then raise exception 'Banco ou ativacao invalidos'; end if;
 if _banco<>'sicredi' and _ativo then raise exception 'Integracao Sicoob ainda nao implementada. Mantenha pendente'; end if;
 if _conta is not null and not exists(select 1 from public.contas_financeiras where id=_conta and ativo and (centro_id is null or centro_id=_centro))
 then raise exception 'Selecione conta financeira ativa deste centro ou compartilhada'; end if;
 if _ativo and _conta is null then raise exception 'Informe a conta financeira de recebimento'; end if;
 if c.banco='sicredi' and _banco<>'sicredi' and exists(select 1 from public.boletos where banco='sicredi' and centro_id=_centro)
 then raise exception 'Centro possui historico Sicredi. Desative novas emissoes preservando o banco'; end if;
 if _banco='sicredi' then
  if exists(select 1 from public.cobranca_centros where banco='sicredi' and centro_id<>_centro) then
   raise exception 'O convenio Sicredi ja esta vinculado a outro centro'; end if;
  if jsonb_typeof(_api) is distinct from 'object' then raise exception 'Parametros da API invalidos'; end if;
  v:=jsonb_populate_record(coalesce(a,null::public.sicredi_config),_api);
  if v.cooperativa is null or v.cooperativa !~ '^[0-9]{4}$' or v.posto is null or v.posto !~ '^[0-9]{2}$'
   or v.codigo_beneficiario is null or v.codigo_beneficiario !~ '^[0-9]{5}$' then raise exception 'Confira cooperativa, posto e beneficiario'; end if;
  if v.ambiente is null or v.ambiente not in ('homologacao','producao') or (v.tipo_cobranca is null or v.tipo_cobranca not in ('NORMAL','HIBRIDO'))
   or v.tipo_juro is null or v.tipo_juro not in ('ISENTO','PERCENTUAL','VALOR')
   or v.tipo_desconto is null or v.tipo_desconto not in ('NAO_TEM_DESCONTO','PERCENTUAL','VALOR')
   or v.tipo_protesto is null or v.tipo_protesto not in ('SEM_PROTESTO','PROTESTAR','NEGATIVAR') then raise exception 'Regras da API invalidas'; end if;
  if v.juros is null or v.multa is null or v.valor_desconto1 is null or
   least(v.juros,v.multa,v.valor_desconto1)<0 or v.multa>100 or
   v.juros::text in ('NaN','Infinity','-Infinity') or v.multa::text in ('NaN','Infinity','-Infinity') or v.valor_desconto1::text in ('NaN','Infinity','-Infinity') or
   row(v.juros,v.multa,v.valor_desconto1) is distinct from row(round(v.juros,2),round(v.multa,2),round(v.valor_desconto1,2)) or
   v.dias_multa is null or v.dias_multa<0 or v.dias_desconto1 is null or v.dias_desconto1<0 or
   v.dias_protesto is null or v.dias_protesto not between 0 and 99 or
   v.validade_apos_vencimento is null or v.validade_apos_vencimento not between 0 and 9999
  then raise exception 'Valores ou prazos de cobranca invalidos'; end if;
  if exists(select 1 from public.boletos where banco='sicredi' and coalesce(ambiente,'producao')='producao' and
    row(cooperativa,posto,codigo_beneficiario) is distinct from row(v.cooperativa,v.posto,v.codigo_beneficiario)) then
   raise exception 'Preserve a identificacao do convenio dos boletos de producao existentes'; end if;
  -- Mudanças de ambiente/identidade durante envio inconclusivo impediriam sua recuperação.
  if exists(select 1 from public.boletos where banco='sicredi' and canal='api' and status in ('pendente','em_processamento','erro')
    and row(ambiente,cooperativa,posto,codigo_beneficiario) is distinct from
     row(v.ambiente,case when v.ambiente='homologacao' then '6789' else v.cooperativa end,
      case when v.ambiente='homologacao' then '03' else v.posto end,case when v.ambiente='homologacao' then '12345' else v.codigo_beneficiario end))
  then raise exception 'Existe emissao pendente em outro ambiente. Concilie antes de trocar'; end if;
  if v.tipo_cobranca='HIBRIDO' and v.multa>0 and v.dias_multa>0 then
   raise exception 'Hibrido exige multa sem carencia adicional: configure dias da multa como zero'; end if;
  if a.tipo_cobranca is distinct from v.tipo_cobranca and exists(
   select 1 from public.boletos where banco='sicredi' and canal='api' and status in ('pendente','em_processamento','erro'))
  then raise exception 'Concilie as emissoes pendentes antes de trocar a modalidade'; end if;
  v.api_key:=coalesce(nullif(btrim(_api->>'api_key'),''),a.api_key);
  v.sandbox_api_key:=coalesce(nullif(btrim(_api->>'sandbox_api_key'),''),a.sandbox_api_key);
  v.password:=coalesce(nullif(_api->>'password',''),a.password);
  if _ativo and ((v.ambiente='homologacao' and nullif(v.sandbox_api_key,'') is null) or
    (v.ambiente='producao' and (nullif(v.api_key,'') is null or nullif(v.password,'') is null or v.username is distinct from v.codigo_beneficiario||v.cooperativa)))
  then raise exception 'Preencha as credenciais do ambiente selecionado antes de ativar'; end if;
  insert into public.sicredi_config(id,sandbox_api_key,api_key,username,password,cooperativa,posto,codigo_beneficiario,
    ambiente,tipo_cobranca,especie_documento,tipo_juro,juros,multa,dias_multa,tipo_desconto,
    valor_desconto1,dias_desconto1,tipo_protesto,dias_protesto,validade_apos_vencimento,informativo,mensagem)
  values(coalesce(a.id,gen_random_uuid()),v.sandbox_api_key,v.api_key,v.username,v.password,v.cooperativa,v.posto,v.codigo_beneficiario,
    v.ambiente,v.tipo_cobranca,v.especie_documento,v.tipo_juro,v.juros,v.multa,v.dias_multa,v.tipo_desconto,
    v.valor_desconto1,v.dias_desconto1,v.tipo_protesto,v.dias_protesto,v.validade_apos_vencimento,v.informativo,v.mensagem)
  on conflict(id) do update set sandbox_api_key=excluded.sandbox_api_key,api_key=excluded.api_key,username=excluded.username,password=excluded.password,
    cooperativa=excluded.cooperativa,posto=excluded.posto,codigo_beneficiario=excluded.codigo_beneficiario,
    ambiente=excluded.ambiente,tipo_cobranca=excluded.tipo_cobranca,especie_documento=excluded.especie_documento,
    tipo_juro=excluded.tipo_juro,juros=excluded.juros,multa=excluded.multa,dias_multa=excluded.dias_multa,
    tipo_desconto=excluded.tipo_desconto,valor_desconto1=excluded.valor_desconto1,dias_desconto1=excluded.dias_desconto1,
    tipo_protesto=excluded.tipo_protesto,dias_protesto=excluded.dias_protesto,
    validade_apos_vencimento=excluded.validade_apos_vencimento,informativo=excluded.informativo,
    mensagem=excluded.mensagem,updated_at=clock_timestamp();
 end if;
 insert into public.cobranca_centros(centro_id,banco,canal,ativo,conta_financeira_id)
 values(_centro,_banco,case when _banco='sicredi' then 'api' else 'pendente' end,_ativo,_conta)
 on conflict(centro_id) do update set banco=excluded.banco,canal=excluded.canal,ativo=excluded.ativo,
 conta_financeira_id=excluded.conta_financeira_id,updated_at=clock_timestamp();
 insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
 values('cobranca_centros',_centro,'configurar_cobranca_centro',jsonb_build_object('banco',_banco,'ativo',_ativo,'conta',_conta),_actor);
end $$;
revoke all on function public.salvar_cobranca_centro_237(uuid,uuid,text,boolean,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.salvar_cobranca_centro_237(uuid,uuid,text,boolean,uuid,jsonb) to service_role;
create or replace function public.preparar_boleto_sicredi_fase224(_actor_id uuid,_conta_id uuid) returns public.boletos
language plpgsql security definer set search_path=public as $$
declare c public.sicredi_config; b public.boletos; coop text; posto_api text; ben text; retentativa boolean;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operacao exclusiva do servidor'; end if;
  if not exists(select 1 from public.profiles where id=_actor_id and ativo) then raise exception 'Usuario inativo'; end if;
  select * into c from public.sicredi_config for share;
  if c.id is null then raise exception 'Configure Sicredi antes de emitir'; end if;
  coop:=case when c.ambiente='homologacao' then '6789' else c.cooperativa end;
  posto_api:=case when c.ambiente='homologacao' then '03' else c.posto end;
  ben:=case when c.ambiente='homologacao' then '12345' else c.codigo_beneficiario end;
  perform 1 from public.contas_receber where id=_conta_id for update;
  select * into b from public.boletos where conta_receber_id=_conta_id order by created_at desc limit 1 for update;
  if b.id is not null and b.status in ('erro','em_processamento','pendente') then
    if b.canal='cnab240' then raise exception 'Titulo possui ciclo CNAB. Acompanhe o retorno do banco'; end if;
    if b.ambiente is not null and row(b.ambiente,b.cooperativa,b.posto,b.codigo_beneficiario)
      is distinct from row(c.ambiente,coop,posto_api,ben) then raise exception 'Emissao anterior pertence a outro ambiente ou convenio. Concilie antes de reenviar'; end if;
  end if;
  if b.status in ('erro','em_processamento','pendente') and b.sicredi_tipo_emissao_364 is not null
   and b.sicredi_tipo_emissao_364 is distinct from c.tipo_cobranca then
   raise exception 'Modalidade da tentativa anterior diverge. Concilie antes de reenviar'; end if;
  if c.tipo_cobranca='HIBRIDO' and c.multa>0 and c.dias_multa>0 then
   raise exception 'Hibrido exige multa sem carencia adicional'; end if;
  retentativa:=b.id is not null and b.status in ('erro','em_processamento','pendente');
  b:=public.preparar_boleto_sicredi_fase131(_actor_id,_conta_id);
  update public.boletos set tipo_cobranca=c.tipo_cobranca,sicredi_tipo_emissao_364=c.tipo_cobranca,ambiente=c.ambiente,cooperativa=coop,posto=posto_api,codigo_beneficiario=ben,emissao_retentativa=retentativa
    where id=b.id returning * into b;
  return b;
end $$;
revoke all on function public.preparar_boleto_sicredi_fase224(uuid,uuid) from public,anon,authenticated;
revoke all on function public.preparar_boleto_sicredi_fase224(uuid,uuid) from service_role;

create or replace function public.registrar_boleto_sicredi_servidor(
  _actor_id uuid,_conta_id uuid,_seu_numero text,_nosso_numero text,_linha_digitavel text,_codigo_barras text,_qrcode_pix text,_txid text,
  _cooperativa text,_posto text,_codigo_beneficiario text,_ambiente text,_retorno jsonb
) returns public.boletos language plpgsql security definer set search_path=public as $$
declare b public.boletos;cr public.contas_receber;saldo numeric;
begin
  if coalesce(auth.role(),'')<>'service_role' or not exists(select 1 from public.profiles where id=_actor_id and ativo) then raise exception 'Operacao exclusiva do servidor ativo'; end if;
  select * into cr from public.contas_receber where id=_conta_id for update;
  if cr.id is null or not public.ator_financeiro_pode_acessar_centro(_actor_id,cr.centro_id) then raise exception 'Sem acesso ao titulo'; end if;
  select * into b from public.boletos where banco='sicredi' and seu_numero=_seu_numero for update;
  if b.id is null or b.conta_receber_id is distinct from _conta_id or b.canal is distinct from 'api' then raise exception 'Registro sem reserva correspondente'; end if;
  if row(b.ambiente,b.cooperativa,b.posto,b.codigo_beneficiario) is distinct from row(_ambiente,_cooperativa,_posto,_codigo_beneficiario) then raise exception 'Registro difere do ambiente ou convenio reservado'; end if;
  if _linha_digitavel is null or _linha_digitavel !~ '^748[0-9]{44}$' or _codigo_barras is null or _codigo_barras !~ '^748[0-9]{41}$'
    then raise exception 'Linha digitavel ou codigo de barras invalidos'; end if;
  if nullif(_nosso_numero,'') is not null and _nosso_numero !~ '^[0-9]{9}$' then raise exception 'Nosso numero invalido'; end if;
  if b.sicredi_tipo_emissao_364='HIBRIDO' and (
   _qrcode_pix is null or length(_qrcode_pix)>365 or _qrcode_pix !~ '^000201.*6304[0-9A-Fa-f]{4}$'
   or position('br.gov.bcb.pix' in _qrcode_pix)=0 or _txid is null or _txid !~ '^[a-zA-Z0-9]{32}$')
   then raise exception 'Registro hibrido exige QR Code e TXID bancarios validos'; end if;
  if b.status in ('registrado','liquidado') then
    if b.linha_digitavel=_linha_digitavel and b.codigo_barras=_codigo_barras and coalesce(b.nosso_numero,'')=coalesce(_nosso_numero,'') then return b; end if;
    raise exception 'Registro anterior divergente';
  end if;
  saldo:=round(coalesce(cr.valor,0)+coalesce(cr.juros,0)+coalesce(cr.multa,0)+coalesce(cr.acrescimo,0)-coalesce(cr.desconto,0)-coalesce(cr.valor_pago,0),2);
  if saldo is distinct from b.valor or cr.vencimento is distinct from b.vencimento then raise exception 'Titulo mudou depois do envio. Concilie o registro antes de reenviar'; end if;
  return public.registrar_boleto_sicredi_fase129(_actor_id,_conta_id,_seu_numero,_nosso_numero,_linha_digitavel,_codigo_barras,_qrcode_pix,_txid,_cooperativa,_posto,_codigo_beneficiario,_ambiente,_retorno);
end $$;
revoke all on function public.registrar_boleto_sicredi_servidor(uuid,uuid,text,text,text,text,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.registrar_boleto_sicredi_servidor(uuid,uuid,text,text,text,text,text,text,text,text,text,text,jsonb) to service_role;

create or replace function public.sicredi_reservar_condicoes_292(
 _actor uuid,_boleto uuid,_chave uuid,_tipo text,_motivo text,_anterior jsonb,_esperado jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare b public.boletos; t public.contas_receber; s public.sicredi_condicoes_historico_292; saldo numeric;
begin
 if coalesce(auth.role(),'')<>'service_role' or not exists(select 1 from profiles where id=_actor and ativo)
 or not public.has_role(_actor,'admin') then raise exception 'Somente administrador ativo pelo servidor';end if;
 if _chave is null or length(trim(coalesce(_motivo,''))) not between 10 and 2000 then raise exception 'Informe chave e motivo com 10 a 2000 caracteres';end if;
 select * into b from boletos where id=_boleto for update;
 if b.id is null or not coalesce(public.ator_financeiro_pode_acessar_centro(_actor,b.centro_id),false) then raise exception 'Sem acesso ao boleto';end if;
 select * into s from sicredi_condicoes_historico_292 where chave=_chave;
 if s.id is not null then
  if s.boleto_id<>b.id or s.usuario_id<>_actor then raise exception 'Chave de outra operação';end if;
  return jsonb_build_object('id',s.id,'enviar',false);
 end if;
 if b.banco is distinct from 'sicredi' or b.canal is distinct from 'api' or b.status is distinct from 'registrado'
 or coalesce(b.nosso_numero,'') !~ '^\d{9}$' then raise exception 'Exige boleto API Sicredi registrado';end if;
 if b.condicoes_pendente_292 is not null or b.vencimento_solicitacao_id is not null
 or coalesce((b.retorno->>'cancelamento_sicredi_pendente')::boolean,false) then raise exception 'Existe instrução pendente. Confira no Sicredi';end if;
 select * into t from contas_receber where id=b.conta_receber_id for update;
 saldo:=round(coalesce(t.valor,0)+coalesce(t.juros,0)+coalesce(t.multa,0)+coalesce(t.acrescimo,0)-coalesce(t.desconto,0)-coalesce(t.valor_pago,0),2);
 if t.id is null or t.centro_id is distinct from b.centro_id or t.status is distinct from 'aberto'
 or coalesce(t.valor_pago,0)<>0 or saldo is distinct from b.valor then raise exception 'Título mudou ou tem recebimento. Concilie antes de alterar';end if;
 if jsonb_typeof(_anterior) is distinct from 'object' or jsonb_typeof(_esperado) is distinct from 'object'
 or (_anterior->>'nominal')::numeric is distinct from b.valor or (_esperado->>'nominal')::numeric is distinct from b.valor
 or (_anterior->>'vencimento')::date is distinct from b.vencimento
 or coalesce(_anterior->>'situacao','') not in('EM CARTEIRA','EM CARTEIRA PIX','VENCIDO')
 or _tipo not in('abatimento','cancelar_abatimento','desconto','data_desconto')
 then raise exception 'Condições bancárias divergentes';end if;
 insert into sicredi_condicoes_historico_292(boleto_id,centro_id,usuario_id,chave,tipo,motivo,anterior,esperado)
 values(b.id,b.centro_id,_actor,_chave,_tipo,trim(_motivo),_anterior,_esperado) returning id into s.id;
 update boletos set condicoes_pendente_292=s.id where id=b.id;
 insert into auditoria(tabela,registro_id,acao,detalhe,user_id) values('boletos',b.id,'solicitar_condicoes_sicredi_292',jsonb_build_object('solicitacao',s.id,'tipo',_tipo,'motivo',trim(_motivo),'anterior',_anterior,'esperado',_esperado),_actor);
 return jsonb_build_object('id',s.id,'enviar',true);
end $$;

create or replace function public.sicredi_finalizar_condicoes_292(
 _actor uuid,_boleto uuid,_solicitacao uuid,_estado text,_banco jsonb default null
) returns void language plpgsql security definer set search_path=public as $$
declare b public.boletos;s public.sicredi_condicoes_historico_292;
begin
 if coalesce(auth.role(),'')<>'service_role' or not exists(select 1 from profiles where id=_actor and ativo) then raise exception 'Operação exclusiva do servidor ativo';end if;
 select * into b from boletos where id=_boleto for update;
 if b.id is null or not coalesce(public.ator_financeiro_pode_acessar_centro(_actor,b.centro_id),false) then raise exception 'Sem acesso ao boleto';end if;
 select * into s from sicredi_condicoes_historico_292 where id=_solicitacao and boleto_id=b.id for update;
 if s.id is null then raise exception 'Solicitação não encontrada';end if;
 if s.estado in('confirmado','rejeitado','encerrado') then return;end if;
 if b.condicoes_pendente_292 is distinct from s.id or _estado is null or _estado not in('enviado','incerto','confirmado','rejeitado','encerrado') then raise exception 'Estado ou solicitação divergente';end if;
 if _estado='confirmado' then
  if _banco is null or (_banco-'situacao') is distinct from (s.esperado-'situacao')
   or coalesce(_banco->>'situacao','') not in('EM CARTEIRA','EM CARTEIRA PIX','VENCIDO') or b.status is distinct from 'registrado'
   or (_banco->>'nominal')::numeric is distinct from b.valor then raise exception 'Banco não confirmou as condições solicitadas';end if;
  update boletos set condicoes_sicredi_292=_banco where id=b.id;
 end if;
 if _estado='encerrado' and coalesce(_banco->>'situacao','') not like 'LIQUIDAD%' and coalesce(_banco->>'situacao','') not like 'BAIXAD%'
 then raise exception 'Encerramento exige confirmação de liquidação ou baixa bancária';end if;
 update sicredi_condicoes_historico_292 set estado=_estado,retorno=coalesce(_banco,retorno),updated_at=clock_timestamp() where id=s.id;
 if _estado in('confirmado','rejeitado','encerrado') then update boletos set condicoes_pendente_292=null where id=b.id;end if;
 insert into auditoria(tabela,registro_id,acao,detalhe,user_id) values('boletos',b.id,'retorno_condicoes_sicredi_292',jsonb_build_object('solicitacao',s.id,'estado',_estado,'banco',_banco),_actor);
end $$;
revoke all on function public.sicredi_reservar_condicoes_292(uuid,uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.sicredi_finalizar_condicoes_292(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.sicredi_reservar_condicoes_292(uuid,uuid,uuid,text,text,jsonb,jsonb) to service_role;
grant execute on function public.sicredi_finalizar_condicoes_292(uuid,uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
