-- Fase 119: ciclo de vida controlado dos boletos Sicredi.
-- Remove a necessidade de INSERT/UPDATE direto em public.boletos pelo navegador.
begin;

create or replace function public.registrar_boleto_sicredi(
  _conta_id uuid,
  _seu_numero text,
  _nosso_numero text,
  _linha_digitavel text,
  _codigo_barras text,
  _qrcode_pix text,
  _txid text,
  _cooperativa text,
  _posto text,
  _codigo_beneficiario text,
  _ambiente text,
  _retorno jsonb
) returns public.boletos
language plpgsql
security definer
set search_path=public
as $$
declare
  cr public.contas_receber;
  b public.boletos;
  saldo numeric(14,2);
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissão para registrar boleto';
  end if;

  select * into cr from public.contas_receber where id=_conta_id for update;
  if cr.id is null then raise exception 'Título não encontrado'; end if;
  if cr.centro_id is null or not public.usuario_pode_acessar_centro(cr.centro_id) then
    raise exception 'Título sem centro válido ou sem acesso';
  end if;
  if cr.status in ('pago','cancelado') then
    raise exception 'Título não pode receber boleto no status atual';
  end if;

  saldo := round(cr.valor+cr.juros+cr.multa+cr.acrescimo-cr.desconto-coalesce(cr.valor_pago,0),2);
  if saldo <= 0 then raise exception 'Título sem saldo para cobrança'; end if;

  select * into b
  from public.boletos
  where conta_receber_id=_conta_id
    and status in ('pendente','em_processamento','registrado','liquidado')
  order by created_at desc
  limit 1
  for update;

  if b.id is not null then
    if b.seu_numero is distinct from nullif(btrim(_seu_numero),'') then
      raise exception 'Já existe boleto ativo para este título';
    end if;
  else
    insert into public.boletos(
      conta_receber_id,cliente_id,centro_id,pedido_id,documento,parcela,banco,
      seu_numero,valor,vencimento,status,created_by
    )
    values(
      cr.id,cr.cliente_id,cr.centro_id,cr.pedido_id,cr.documento,cr.parcela,'sicredi',
      nullif(btrim(_seu_numero),''),saldo,cr.vencimento,'pendente',auth.uid()
    )
    returning * into b;
  end if;

  update public.boletos
  set status='registrado',
      nosso_numero=nullif(btrim(_nosso_numero),''),
      linha_digitavel=nullif(btrim(_linha_digitavel),''),
      codigo_barras=nullif(btrim(_codigo_barras),''),
      qrcode_pix=nullif(_qrcode_pix,''),
      txid=nullif(_txid,''),
      cooperativa=nullif(_cooperativa,''),
      posto=nullif(_posto,''),
      codigo_beneficiario=nullif(_codigo_beneficiario,''),
      ambiente=nullif(_ambiente,''),
      enviado_em=now(),
      erro=null,
      retorno=coalesce(_retorno,'{}'::jsonb)
  where id=b.id
  returning * into b;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('boletos',b.id,'registrar_sicredi',
    jsonb_build_object('conta_receber_id',cr.id,'seu_numero',b.seu_numero,'nosso_numero',b.nosso_numero),
    auth.uid());

  return b;
end;
$$;

create or replace function public.registrar_erro_boleto_sicredi(
  _conta_id uuid,
  _seu_numero text,
  _erro text
) returns public.boletos
language plpgsql
security definer
set search_path=public
as $$
declare
  cr public.contas_receber;
  b public.boletos;
  saldo numeric(14,2);
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissão para registrar erro de boleto';
  end if;

  select * into cr from public.contas_receber where id=_conta_id for update;
  if cr.id is null then raise exception 'Título não encontrado'; end if;
  if cr.centro_id is null or not public.usuario_pode_acessar_centro(cr.centro_id) then
    raise exception 'Título sem centro válido ou sem acesso';
  end if;

  saldo := round(cr.valor+cr.juros+cr.multa+cr.acrescimo-cr.desconto-coalesce(cr.valor_pago,0),2);

  insert into public.boletos(
    conta_receber_id,cliente_id,centro_id,pedido_id,documento,parcela,banco,
    seu_numero,valor,vencimento,status,erro,tentativas,enviado_em,created_by
  )
  values(
    cr.id,cr.cliente_id,cr.centro_id,cr.pedido_id,cr.documento,cr.parcela,'sicredi',
    nullif(btrim(_seu_numero),''),greatest(saldo,0),cr.vencimento,'erro',
    left(coalesce(_erro,'Erro não informado'),500),1,now(),auth.uid()
  )
  returning * into b;

  return b;
end;
$$;

create or replace function public.sincronizar_boleto_sicredi(
  _boleto_id uuid,
  _status text,
  _retorno jsonb default null
) returns public.boletos
language plpgsql
security definer
set search_path=public
as $$
declare
  b public.boletos;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissão para sincronizar boleto';
  end if;

  select * into b from public.boletos where id=_boleto_id for update;
  if b.id is null then raise exception 'Boleto não encontrado'; end if;
  if not public.usuario_pode_acessar_centro(b.centro_id) then
    raise exception 'Sem acesso ao centro do boleto';
  end if;
  if _status not in ('registrado','baixado') then
    raise exception 'Status de sincronização inválido';
  end if;
  if b.status='liquidado' then
    raise exception 'Boleto liquidado não pode ser reaberto';
  end if;

  update public.boletos
  set status=_status,
      retorno=coalesce(_retorno,retorno),
      erro=null
  where id=b.id
  returning * into b;

  return b;
end;
$$;

revoke execute on function public.registrar_boleto_sicredi(uuid,text,text,text,text,text,text,text,text,text,text,jsonb) from public, anon;
revoke execute on function public.registrar_erro_boleto_sicredi(uuid,text,text) from public, anon;
revoke execute on function public.sincronizar_boleto_sicredi(uuid,text,jsonb) from public, anon;

grant execute on function public.registrar_boleto_sicredi(uuid,text,text,text,text,text,text,text,text,text,text,jsonb) to authenticated, service_role;
grant execute on function public.registrar_erro_boleto_sicredi(uuid,text,text) to authenticated, service_role;
grant execute on function public.sincronizar_boleto_sicredi(uuid,text,jsonb) to authenticated, service_role;

commit;
