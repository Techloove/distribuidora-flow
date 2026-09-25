-- Fase 129: concorrencia segura na persistencia de boletos Sicredi.
-- Se duas chamadas do servidor concluirem o mesmo registro ao mesmo tempo,
-- a segunda reconcilia a linha existente em vez de falhar apos sucesso no banco.
begin;

create or replace function public.registrar_boleto_sicredi_servidor(
  _actor_id uuid,
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
set search_path = public
as $$
declare
  cr public.contas_receber;
  b public.boletos;
  saldo numeric(14,2);
  v_seu_numero text := nullif(btrim(_seu_numero),'');
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Operacao exclusiva do servidor';
  end if;

  select * into cr
  from public.contas_receber
  where id=_conta_id
  for update;

  if cr.id is null then raise exception 'Titulo nao encontrado'; end if;
  if not public.ator_financeiro_pode_acessar_centro(_actor_id,cr.centro_id) then
    raise exception 'Usuario sem permissao para o centro do titulo';
  end if;
  if cr.status in ('pago','cancelado') then
    raise exception 'Titulo nao pode receber boleto no status atual';
  end if;
  if v_seu_numero is null then raise exception 'Seu numero e obrigatorio'; end if;

  saldo := round(
    coalesce(cr.valor,0)+coalesce(cr.juros,0)+coalesce(cr.multa,0)+coalesce(cr.acrescimo,0)
    -coalesce(cr.desconto,0)-coalesce(cr.valor_pago,0),2
  );
  if saldo <= 0 then raise exception 'Titulo sem saldo para cobranca'; end if;

  select * into b
  from public.boletos
  where banco='sicredi' and seu_numero=v_seu_numero
  order by created_at desc
  limit 1
  for update;

  if b.id is not null then
    if b.conta_receber_id is distinct from cr.id then
      raise exception 'Seu numero ja esta vinculado a outro titulo';
    end if;
    if b.status='liquidado' then return b; end if;
    if b.status='baixado' then
      raise exception 'Boleto baixado nao pode ser registrado novamente com o mesmo seu numero';
    end if;
  else
    begin
      insert into public.boletos(
        conta_receber_id,cliente_id,centro_id,pedido_id,documento,parcela,banco,
        seu_numero,valor,vencimento,status,created_by
      ) values(
        cr.id,cr.cliente_id,cr.centro_id,cr.pedido_id,cr.documento,cr.parcela,'sicredi',
        v_seu_numero,saldo,cr.vencimento,'pendente',_actor_id
      )
      returning * into b;
    exception
      when unique_violation then
        select * into b
        from public.boletos
        where banco='sicredi' and seu_numero=v_seu_numero
        order by created_at desc
        limit 1
        for update;

        if b.id is null then raise; end if;
        if b.conta_receber_id is distinct from cr.id then
          raise exception 'Seu numero ja esta vinculado a outro titulo';
        end if;
        if b.status='liquidado' then return b; end if;
        if b.status='baixado' then
          raise exception 'Boleto baixado nao pode ser registrado novamente com o mesmo seu numero';
        end if;
    end;
  end if;

  update public.boletos
  set status='registrado',
      valor=saldo,
      vencimento=cr.vencimento,
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
  values(
    'boletos',b.id,'registrar_sicredi_servidor',
    jsonb_build_object(
      'conta_receber_id',cr.id,
      'seu_numero',b.seu_numero,
      'nosso_numero',b.nosso_numero
    ),
    _actor_id
  );

  return b;
end;
$$;

revoke execute on function public.registrar_boleto_sicredi_servidor(
  uuid,uuid,text,text,text,text,text,text,text,text,text,text,jsonb
) from public, anon, authenticated;

grant execute on function public.registrar_boleto_sicredi_servidor(
  uuid,uuid,text,text,text,text,text,text,text,text,text,text,jsonb
) to service_role;

commit;
