-- Fase224: contratos API Sicredi3.9.1, após fase223. Não reinicia sequenciais.
begin;
do $$ begin
  if to_regprocedure('public.sicredi_salvar_convenio_223(uuid,jsonb,jsonb,boolean)') is null then
    raise exception 'Aplique a fase223 antes da fase224';
  end if;
end $$;
alter table public.sicredi_config add column if not exists sandbox_api_key text;
-- Preserva a chave antiga. Para instalações que estavam em testes, aproveita-a no sandbox.
update public.sicredi_config set sandbox_api_key=api_key where ambiente='homologacao' and sandbox_api_key is null;
alter table public.sicredi_config alter column tipo_cobranca set default 'NORMAL';
alter table public.boletos add column if not exists emissao_inconclusiva boolean not null default true;
alter table public.boletos add column if not exists emissao_retentativa boolean not null default false;
alter table public.boletos add column if not exists sicredi_liquidacao_api jsonb;

-- Títulos do sandbox não impedem a manutenção do convênio real.
do $$ declare d text; begin
  if to_regprocedure('public.sicredi_salvar_convenio_fase223(uuid,jsonb,jsonb,boolean)') is null then
    alter function public.sicredi_salvar_convenio_223(uuid,jsonb,jsonb,boolean) rename to sicredi_salvar_convenio_fase223;
  end if;
  d:=pg_get_functiondef('public.sicredi_salvar_convenio_fase223(uuid,jsonb,jsonb,boolean)'::regprocedure);
  if position('coalesce(ambiente,''producao'')=''producao''' in d)=0 then
    if position('where banco=''sicredi'' and' in d)=0 then raise exception 'Guard de historico fase223 nao localizado'; end if;
    d:=replace(d,'where banco=''sicredi'' and','where banco=''sicredi'' and coalesce(ambiente,''producao'')=''producao'' and');
    execute d;
  end if;
end $$;
revoke all on function public.sicredi_salvar_convenio_fase223(uuid,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
create or replace function public.sicredi_salvar_convenio_223(_actor uuid,_api jsonb,_cnab jsonb,_confirmar boolean default false)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.sicredi_salvar_convenio_fase223(_actor,_api,_cnab,_confirmar);
  if nullif(btrim(_api->>'sandbox_api_key'),'') is not null then
    update public.sicredi_config set sandbox_api_key=btrim(_api->>'sandbox_api_key');
  end if;
end $$;
revoke all on function public.sicredi_salvar_convenio_223(uuid,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.sicredi_salvar_convenio_223(uuid,jsonb,jsonb,boolean) to service_role;

create table if not exists public.sicredi_tokens_224(
  chave text primary key check(chave ~ '^[a-f0-9]{64}$'),access_token text,refresh_token text,
  access_expira timestamptz,refresh_expira timestamptz,lease uuid,lease_expira timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.sicredi_tokens_224 enable row level security;
revoke all on public.sicredi_tokens_224 from public,anon,authenticated;
grant all on public.sicredi_tokens_224 to service_role;
create or replace function public.sicredi_token_reservar_224(_chave text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare t public.sicredi_tokens_224; l uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operacao exclusiva do servidor'; end if;
  if _chave is null or _chave !~ '^[a-f0-9]{64}$' then raise exception 'Chave de cache invalida'; end if;
  delete from public.sicredi_tokens_224 where coalesce(access_expira,updated_at)<now()-interval '1 day'
    and coalesce(refresh_expira,access_expira,updated_at)<now()-interval '1 day' and coalesce(lease_expira,now()-interval '1 day')<now();
  insert into public.sicredi_tokens_224(chave) values(_chave) on conflict do nothing;
  select * into t from public.sicredi_tokens_224 where chave=_chave for update;
  if t.access_expira>clock_timestamp()+interval '15 seconds' and nullif(t.access_token,'') is not null then
    return jsonb_build_object('access_token',t.access_token);
  end if;
  if t.lease is not null and t.lease_expira>clock_timestamp() then return jsonb_build_object('busy',true); end if;
  l:=gen_random_uuid();
  update public.sicredi_tokens_224 set lease=l,lease_expira=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp() where chave=_chave;
  return jsonb_build_object('lease',l,'refresh_token',case when t.refresh_expira>clock_timestamp()+interval '15 seconds' then t.refresh_token else null end);
end $$;
create or replace function public.sicredi_token_concluir_224(_chave text,_lease uuid,_dados jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare t public.sicredi_tokens_224; secs numeric; refresh_secs numeric;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operacao exclusiva do servidor'; end if;
  select * into t from public.sicredi_tokens_224 where chave=_chave for update;
  if t.chave is null or _lease is null or t.lease is distinct from _lease then raise exception 'Reserva de token nao corresponde ao servidor'; end if;
  if _dados is null then update public.sicredi_tokens_224 set lease=null,lease_expira=null where chave=_chave; return; end if;
  secs:=(_dados->>'expires_in')::numeric;refresh_secs:=(_dados->>'refresh_expires_in')::numeric;
  if secs is null or secs::text in ('NaN','Infinity','-Infinity') or secs<=15 or secs>31536000
    or nullif(_dados->>'access_token','') is null then raise exception 'Token ou prazo bancario invalido'; end if;
  if refresh_secs is not null and (refresh_secs::text in ('NaN','Infinity','-Infinity') or refresh_secs<=0 or refresh_secs>31536000)
    then raise exception 'Prazo de renovacao invalido'; end if;
  update public.sicredi_tokens_224 set access_token=_dados->>'access_token',
    access_expira=clock_timestamp()+secs*interval '1 second',refresh_token=nullif(_dados->>'refresh_token',''),
    refresh_expira=case when nullif(_dados->>'refresh_token','') is not null and refresh_secs>0 then clock_timestamp()+refresh_secs*interval '1 second' else null end,
    lease=null,lease_expira=null,updated_at=clock_timestamp() where chave=_chave;
end $$;
revoke all on function public.sicredi_token_reservar_224(text) from public,anon,authenticated;
revoke all on function public.sicredi_token_concluir_224(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sicredi_token_reservar_224(text) to service_role;
grant execute on function public.sicredi_token_concluir_224(text,uuid,jsonb) to service_role;

-- Reserva com identificação do ambiente antes de qualquer envio bancário.
do $$ begin
  if to_regprocedure('public.preparar_boleto_sicredi_fase131(uuid,uuid)') is null then
    alter function public.preparar_boleto_sicredi_servidor(uuid,uuid) rename to preparar_boleto_sicredi_fase131;
  end if;
end $$;
revoke all on function public.preparar_boleto_sicredi_fase131(uuid,uuid) from public,anon,authenticated,service_role;
create or replace function public.preparar_boleto_sicredi_servidor(_actor_id uuid,_conta_id uuid) returns public.boletos
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
  retentativa:=b.id is not null and b.status in ('erro','em_processamento','pendente');
  b:=public.preparar_boleto_sicredi_fase131(_actor_id,_conta_id);
  update public.boletos set ambiente=c.ambiente,cooperativa=coop,posto=posto_api,codigo_beneficiario=ben,emissao_retentativa=retentativa
    where id=b.id returning * into b;
  return b;
end $$;
revoke all on function public.preparar_boleto_sicredi_servidor(uuid,uuid) from public,anon,authenticated;
grant execute on function public.preparar_boleto_sicredi_servidor(uuid,uuid) to service_role;
create or replace function public.sicredi_marcar_emissao_224(_actor uuid,_boleto uuid,_estado text) returns void
language plpgsql security definer set search_path=public as $$
declare b public.boletos;
begin
  if coalesce(auth.role(),'')<>'service_role' or not exists(select 1 from public.profiles where id=_actor and ativo) then raise exception 'Operacao exclusiva do servidor ativo'; end if;
  select * into b from public.boletos where id=_boleto for update;
  if b.id is null or not public.ator_financeiro_pode_acessar_centro(_actor,b.centro_id) then raise exception 'Sem acesso ao boleto'; end if;
  if _estado not in ('inconclusivo','rejeitado','confirmado') then raise exception 'Estado bancario invalido'; end if;
  if b.status in ('registrado','liquidado','baixado') and _estado<>'confirmado' then raise exception 'Ciclo de boleto ja confirmado'; end if;
  update public.boletos set emissao_inconclusiva=(_estado='inconclusivo'),
    erro=case when _estado='inconclusivo' then 'Resposta bancaria inconclusiva. Consulte o registro antes de reenviar.' else erro end where id=_boleto;
end $$;
revoke all on function public.sicredi_marcar_emissao_224(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.sicredi_marcar_emissao_224(uuid,uuid,text) to service_role;

create or replace function public.sicredi_liquidar_api_224(_actor uuid,_boleto uuid,_dados jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare b public.boletos; cr public.contas_receber; v numeric; j numeric; m numeric; d numeric; a numeric; dt date; saldo numeric; conta uuid;
  old_claims text;old_sub text;old_role text;
begin
  if coalesce(auth.role(),'')<>'service_role' or not exists(select 1 from public.profiles where id=_actor and ativo) then raise exception 'Operacao exclusiva do servidor ativo'; end if;
  select * into b from public.boletos where id=_boleto for update;
  if b.id is null or not public.ator_financeiro_pode_acessar_centro(_actor,b.centro_id) then raise exception 'Sem acesso ao boleto'; end if;
  if b.banco is distinct from 'sicredi' or b.canal is distinct from 'api' or b.ambiente is distinct from 'producao' then raise exception 'Liquidacao real exige boleto API Sicredi de producao'; end if;
  if jsonb_typeof(_dados) is distinct from 'object' then raise exception 'Dados de liquidacao invalidos'; end if;
  v:=(_dados->>'valor')::numeric;j:=(_dados->>'juros')::numeric;m:=(_dados->>'multa')::numeric;d:=(_dados->>'desconto')::numeric;a:=(_dados->>'abatimento')::numeric;dt:=(_dados->>'data')::date;
  if v is null or j is null or m is null or d is null or a is null or dt is null
    or v::text in ('NaN','Infinity','-Infinity') or j::text in ('NaN','Infinity','-Infinity') or m::text in ('NaN','Infinity','-Infinity') or d::text in ('NaN','Infinity','-Infinity') or a::text in ('NaN','Infinity','-Infinity')
    or v<=0 or least(j,m,d,a)<0 or row(v,j,m,d,a) is distinct from row(round(v,2),round(j,2),round(m,2),round(d,2),round(a,2)) then raise exception 'Valores bancarios invalidos'; end if;
  if b.status='liquidado' then
    if b.sicredi_liquidacao_api=_dados then return; end if;
    raise exception 'Liquidacao anterior divergente. Concilie antes de alterar';
  end if;
  if b.status not in ('registrado','pendente','em_processamento') then raise exception 'Boleto nao esta apto para liquidacao'; end if;
  if round(b.valor+j+m-d-a,2) is distinct from v then raise exception 'Liquidacao parcial ou valores bancarios divergentes. Concilie manualmente'; end if;
  select * into cr from public.contas_receber where id=b.conta_receber_id for update;
  if cr.id is null or cr.centro_id is distinct from b.centro_id then raise exception 'Titulo nao corresponde ao boleto'; end if;
  saldo:=round(coalesce(cr.valor,0)+coalesce(cr.juros,0)+coalesce(cr.multa,0)+coalesce(cr.acrescimo,0)-coalesce(cr.desconto,0)-coalesce(cr.valor_pago,0),2);
  if saldo is distinct from b.valor then raise exception 'Saldo do titulo mudou. Concilie antes de baixar'; end if;
  conta:=coalesce(cr.conta_financeira_id,(select conta_financeira_id from public.sicredi_cnab_config));
  if conta is null then raise exception 'Defina banco/caixa previsto no titulo ou conta financeira Sicredi no convenio'; end if;
  old_claims:=current_setting('request.jwt.claims',true);old_sub:=current_setting('request.jwt.claim.sub',true);old_role:=current_setting('request.jwt.claim.role',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',_actor::text,true);perform set_config('request.jwt.claim.role','authenticated',true);
  perform public.receber_titulo(b.conta_receber_id,v,dt,conta,null,j,m,d+a,'Liquidacao Sicredi API - nosso numero '||coalesce(b.nosso_numero,''));
  perform set_config('request.jwt.claims',coalesce(old_claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claim.role',coalesce(old_role,''),true);
  update public.boletos set status='liquidado',valor_liquidado=v,data_liquidacao=dt,sicredi_liquidacao_api=_dados where id=b.id;
  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id) values('boletos',b.id,'liquidar_sicredi_api',_dados,_actor);
end $$;
revoke all on function public.sicredi_liquidar_api_224(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sicredi_liquidar_api_224(uuid,uuid,jsonb) to service_role;
-- Mantém o valor reservado caso o título seja alterado durante a chamada externa.
do $$ begin
  if to_regprocedure('public.registrar_boleto_sicredi_fase129(uuid,uuid,text,text,text,text,text,text,text,text,text,text,jsonb)') is null then
    alter function public.registrar_boleto_sicredi_servidor(uuid,uuid,text,text,text,text,text,text,text,text,text,text,jsonb) rename to registrar_boleto_sicredi_fase129;
  end if;
end $$;
revoke all on function public.registrar_boleto_sicredi_fase129(uuid,uuid,text,text,text,text,text,text,text,text,text,text,jsonb) from public,anon,authenticated,service_role;
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

create or replace function public.sicredi_vincular_numero_224(_actor uuid,_boleto uuid,_nosso text,_linha text) returns void
language plpgsql security definer set search_path=public as $$
declare b public.boletos;
begin
  if coalesce(auth.role(),'')<>'service_role' or not exists(select 1 from public.profiles where id=_actor and ativo) then raise exception 'Operacao exclusiva do servidor ativo'; end if;
  select * into b from public.boletos where id=_boleto for update;
  if b.id is null or not public.ator_financeiro_pode_acessar_centro(_actor,b.centro_id) then raise exception 'Sem acesso ao boleto'; end if;
  if b.banco is distinct from 'sicredi' or b.canal is distinct from 'api' or b.ambiente is distinct from 'producao' or b.status is distinct from 'registrado' then raise exception 'Confirmacao exige registro API recuperado de producao'; end if;
  if _nosso is null or _nosso !~ '^[0-9]{9}$' or _linha is null or b.linha_digitavel is distinct from _linha then raise exception 'Numero nao corresponde ao boleto confirmado pelo banco'; end if;
  if nullif(b.nosso_numero,'') is not null then
    if b.nosso_numero=_nosso then return; end if;
    raise exception 'Nosso numero ja definido. Nao substitua a identificacao bancaria';
  end if;
  update public.boletos set nosso_numero=_nosso where id=b.id;
  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
    values('boletos',b.id,'confirmar_nosso_numero_sicredi',jsonb_build_object('nosso_numero',_nosso),_actor);
end $$;
revoke all on function public.sicredi_vincular_numero_224(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.sicredi_vincular_numero_224(uuid,uuid,text,text) to service_role;

notify pgrst,'reload schema';
commit;
