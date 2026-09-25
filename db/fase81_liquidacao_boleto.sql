-- Executar apos fase79. Preserva a forma de baixa da fase16, adicionando
-- autorizacao, isolamento por centro, validacao e idempotencia transacional.
-- A conciliacao com movimentos_financeiros continua sendo uma etapa separada.
begin;
create or replace function public.liquidar_boleto(_id uuid, _valor numeric default null, _data date default current_date)
returns void language plpgsql security definer set search_path = public as $$
declare b public.boletos; titulo public.contas_receber; v numeric; saldo numeric;
begin
  if not public.usuario_ativo() or not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para liquidar boletos' using errcode = '42501';
  end if;
  select * into b from public.boletos where id = _id for update;
  if not found then raise exception 'Boleto nao encontrado'; end if;
  if not public.usuario_pode_acessar_centro(b.centro_id) then
    raise exception 'Centro nao autorizado' using errcode = '42501';
  end if;
  -- Repetir uma confirmacao ja aplicada e um no-op, inclusive com chamadas concorrentes.
  if b.status = 'liquidado' then return; end if;
  if b.status <> 'registrado' then raise exception 'Somente boleto registrado pode ser liquidado'; end if;
  v := coalesce(_valor,b.valor);
  if v is null or v <= 0 or v::text in ('NaN','Infinity','-Infinity') then raise exception 'Valor invalido'; end if;
  if v <> b.valor then raise exception 'Valor divergente: concilie o boleto antes de liquidar'; end if;
  select * into titulo from public.contas_receber where id = b.conta_receber_id for update;
  if not found then raise exception 'Titulo do boleto nao encontrado'; end if;
  if titulo.centro_id is distinct from b.centro_id or not public.usuario_pode_acessar_centro(titulo.centro_id) then
    raise exception 'Centro do titulo difere do boleto' using errcode = '42501';
  end if;
  if titulo.status not in ('aberto','parcial') then raise exception 'Titulo indisponivel para baixa'; end if;
  saldo := titulo.valor + coalesce(titulo.juros,0) + coalesce(titulo.multa,0)
           + coalesce(titulo.acrescimo,0) - coalesce(titulo.desconto,0) - coalesce(titulo.valor_pago,0);
  if v > saldo then raise exception 'Valor excede o saldo: concilie o titulo antes de liquidar'; end if;
  update public.contas_receber set valor_pago = coalesce(valor_pago,0) + v,
    data_pagamento = coalesce(_data,current_date),
    status = case when v = saldo then 'pago' else 'parcial' end
  where id = titulo.id;
  update public.boletos set status='liquidado', valor_liquidado=v,
    data_liquidacao=coalesce(_data,current_date) where id=_id;
end;
$$;
revoke all on function public.liquidar_boleto(uuid,numeric,date) from public, anon;
grant execute on function public.liquidar_boleto(uuid,numeric,date) to authenticated;
commit;
