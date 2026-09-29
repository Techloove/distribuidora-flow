-- Fase 152: torna liquidacao de boleto idempotente e coerente com o titulo.
begin;

create or replace function public.liquidar_boleto(
  _boleto_id uuid,
  _valor numeric,
  _data date default current_date
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.boletos;
  cr public.contas_receber;
  saldo numeric(14,2);
  valor_liq numeric(14,2);
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para liquidar boletos';
  end if;

  if _valor is null or _valor <= 0 or _valor::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Valor de liquidacao invalido';
  end if;

  valor_liq := round(_valor,2);

  select * into b
    from public.boletos
   where id = _boleto_id
   for update;

  if b.id is null then
    raise exception 'Boleto nao encontrado';
  end if;

  if b.centro_id is null or not public.usuario_pode_acessar_centro(b.centro_id) then
    raise exception 'Sem acesso ao centro do boleto';
  end if;

  -- Retry exato e um no-op; retry com valor diferente e rejeitado.
  if b.status = 'liquidado' then
    if round(coalesce(b.valor_liquidado,0),2) = valor_liq then
      return;
    end if;
    raise exception 'Boleto ja liquidado com valor diferente';
  end if;

  if b.status not in ('pendente','em_processamento','registrado') then
    raise exception 'Boleto nao esta apto para liquidacao';
  end if;

  if b.conta_receber_id is null then
    raise exception 'Boleto sem titulo a receber vinculado';
  end if;

  select * into cr
    from public.contas_receber
   where id = b.conta_receber_id
   for update;

  if cr.id is null then
    raise exception 'Titulo do boleto nao encontrado';
  end if;

  if cr.centro_id is distinct from b.centro_id
     or not public.usuario_pode_acessar_centro(cr.centro_id) then
    raise exception 'Centro do titulo difere do boleto';
  end if;

  saldo := round(
    coalesce(cr.valor,0)
    + coalesce(cr.juros,0)
    + coalesce(cr.multa,0)
    + coalesce(cr.acrescimo,0)
    - coalesce(cr.desconto,0)
    - coalesce(cr.valor_pago,0),
    2
  );

  if valor_liq > saldo then
    raise exception 'Liquidacao excede o saldo do titulo';
  end if;

  perform public.receber_titulo(
    b.conta_receber_id,
    valor_liq,
    coalesce(_data,current_date)
  );

  update public.boletos
     set status = 'liquidado',
         valor_liquidado = valor_liq,
         data_liquidacao = coalesce(_data,current_date)
   where id = _boleto_id;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values(
    'boletos',
    _boleto_id,
    'liquidar',
    jsonb_build_object(
      'valor',valor_liq,
      'data',coalesce(_data,current_date),
      'conta_receber_id',b.conta_receber_id
    ),
    auth.uid()
  );
end;
$$;

revoke all on function public.liquidar_boleto(uuid,numeric,date) from public, anon;
grant execute on function public.liquidar_boleto(uuid,numeric,date) to authenticated;

commit;
