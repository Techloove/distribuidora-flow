-- Fase 72: boletos somente por operações controladas.
-- A tela de boletos é consulta; emissão/liquidação passam por RPC.

begin;

alter table public.boletos enable row level security;

drop policy if exists "boletos_select_centro" on public.boletos;
create policy "boletos_select_centro" on public.boletos
for select to authenticated
using (
  public.usuario_pode_acessar_centro(centro_id)
);

revoke insert, update, delete on public.boletos from authenticated;
grant select on public.boletos to authenticated;

create or replace function public.emitir_boleto(_conta_id uuid)
returns public.boletos
language plpgsql security definer set search_path=public
as $$
declare
  cr public.contas_receber;
  b public.boletos;
  saldo numeric(14,2);
begin
  if not public.can_finance(auth.uid()) then raise exception 'Sem permissão para emitir boletos'; end if;

  select * into cr from public.contas_receber where id=_conta_id for update;
  if cr.id is null then raise exception 'Título não encontrado'; end if;
  if cr.centro_id is null or not public.usuario_pode_acessar_centro(cr.centro_id) then
    raise exception 'Título sem centro válido ou sem acesso';
  end if;
  if cr.status in ('pago','cancelado') then raise exception 'Título não pode receber boleto no status atual'; end if;

  saldo:=round(cr.valor+cr.juros+cr.multa+cr.acrescimo-cr.desconto-coalesce(cr.valor_pago,0),2);
  if saldo<=0 then raise exception 'Título sem saldo para cobrança'; end if;

  if exists(select 1 from public.boletos where conta_receber_id=_conta_id
            and status in ('pendente','em_processamento','registrado','liquidado')) then
    raise exception 'Já existe boleto ativo para este título';
  end if;

  insert into public.boletos
    (conta_receber_id,cliente_id,centro_id,seu_numero,valor,vencimento,created_by,status)
  values
    (_conta_id,cr.cliente_id,cr.centro_id,
     cr.documento||'/'||cr.parcela,saldo,cr.vencimento,auth.uid(),'pendente')
  returning * into b;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('boletos',b.id,'emitir',
         jsonb_build_object('valor',b.valor,'centro_id',b.centro_id),auth.uid());

  return b;
exception
  when unique_violation then
    raise exception 'Já existe boleto com este número';
end;
$$;

create or replace function public.liquidar_boleto(
  _boleto_id uuid,_valor numeric,_data date default current_date
) returns void
language plpgsql security definer set search_path=public
as $$
declare
  b public.boletos;
  saldo numeric(14,2);
begin
  if not public.can_finance(auth.uid()) then raise exception 'Sem permissão para liquidar boletos'; end if;
  if coalesce(_valor,0)<=0 then raise exception 'Valor de liquidação inválido'; end if;

  select * into b from public.boletos where id=_boleto_id for update;
  if b.id is null then raise exception 'Boleto não encontrado'; end if;
  if b.centro_id is null or not public.usuario_pode_acessar_centro(b.centro_id) then
    raise exception 'Sem acesso ao centro do boleto';
  end if;
  if b.status not in ('pendente','em_processamento','registrado') then
    raise exception 'Boleto não está apto para liquidação';
  end if;

  if b.conta_receber_id is null then
    raise exception 'Boleto sem título a receber vinculado';
  end if;

  select round(valor+juros+multa+acrescimo-desconto-coalesce(valor_pago,0),2)
    into saldo from public.contas_receber where id=b.conta_receber_id for update;
  if saldo is null then raise exception 'Título do boleto não encontrado'; end if;
  if _valor>saldo then raise exception 'Liquidação excede o saldo do título'; end if;

  -- A baixa financeira gera também o movimento bancário/caixa de forma
  -- centralizada, respeitando o centro da conta.
  perform public.receber_titulo(b.conta_receber_id,_valor,coalesce(_data,current_date));

  update public.boletos
     set status='liquidado',valor_liquidado=_valor,data_liquidacao=coalesce(_data,current_date)
   where id=_boleto_id;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('boletos',_boleto_id,'liquidar',
         jsonb_build_object('valor',_valor,'data',_data,'conta_receber_id',b.conta_receber_id),
         auth.uid());
end;
$$;

grant execute on function public.emitir_boleto(uuid) to authenticated;
grant execute on function public.liquidar_boleto(uuid,numeric,date) to authenticated;

commit;
