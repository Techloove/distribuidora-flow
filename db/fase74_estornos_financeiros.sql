-- Fase 74: estornos financeiros controlados e idempotentes.
begin;

create table if not exists public.estornos_financeiros (
  id uuid primary key default gen_random_uuid(),
  movimento_original_id uuid,
  transferencia_original_id uuid,
  movimento_estorno_id uuid,
  conta_receber_id uuid,
  conta_pagar_id uuid,
  valor numeric(14,2) not null,
  motivo text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint estornos_financeiros_alvo_ck check (
    ((movimento_original_id is not null)::int +
     (transferencia_original_id is not null)::int) = 1
  )
);

create unique index if not exists estornos_financeiros_mov_uq
  on public.estornos_financeiros(movimento_original_id)
  where movimento_original_id is not null;

create unique index if not exists estornos_financeiros_transfer_uq
  on public.estornos_financeiros(transferencia_original_id)
  where transferencia_original_id is not null;

alter table public.estornos_financeiros enable row level security;
drop policy if exists "estornos_financeiros_select" on public.estornos_financeiros;
create policy "estornos_financeiros_select" on public.estornos_financeiros
for select to authenticated
using (
  public.can_finance(auth.uid())
  and (
    (conta_receber_id is not null and exists (
      select 1 from public.contas_receber cr
      where cr.id = estornos_financeiros.conta_receber_id
        and public.usuario_pode_acessar_centro(cr.centro_id)
    ))
    or
    (conta_pagar_id is not null and exists (
      select 1 from public.contas_pagar cp
      where cp.id = estornos_financeiros.conta_pagar_id
        and public.usuario_pode_acessar_centro(cp.centro_id)
    ))
    or
    (movimento_original_id is not null and exists (
      select 1 from public.movimentos_financeiros mf
      where mf.id = estornos_financeiros.movimento_original_id
        and public.usuario_pode_acessar_centro(mf.centro_id)
    ))
    or
    (transferencia_original_id is not null and exists (
      select 1 from public.transferencias t
      where t.id = estornos_financeiros.transferencia_original_id
        and public.usuario_pode_acessar_conta_financeira(t.conta_origem_id)
        and public.usuario_pode_acessar_conta_financeira(t.conta_destino_id)
    ))
  )
);

revoke all on public.estornos_financeiros from authenticated;

create or replace function public.estornar_movimento_financeiro(
  _movimento_id uuid,
  _motivo text
) returns public.estornos_financeiros
language plpgsql
security definer
set search_path=public
as $$
declare
  m public.movimentos_financeiros;
  e public.estornos_financeiros;
  cr public.contas_receber;
  cp public.contas_pagar;
  novo_pago numeric(14,2);
  devido numeric(14,2);
  novo_status text;
  rev public.movimentos_financeiros;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissão para estornar movimentações';
  end if;
  if nullif(btrim(_motivo),'') is null then
    raise exception 'Informe o motivo do estorno';
  end if;

  select * into m
  from public.movimentos_financeiros
  where id=_movimento_id
  for update;

  if m.id is null then raise exception 'Movimentação não encontrada'; end if;
  if m.tipo not in ('entrada','saida') then raise exception 'Movimentação não pode ser estornada'; end if;
  if m.origem in ('transferencia','estorno','estorno_transferencia') or m.transferencia_id is not null then
    raise exception 'Use o estorno da transferência para desfazer uma transferência';
  end if;
  if not public.usuario_pode_acessar_centro(m.centro_id) then
    raise exception 'Sem acesso ao centro da movimentação';
  end if;

  select * into e from public.estornos_financeiros
  where movimento_original_id=_movimento_id
  for update;
  if e.id is not null then return e; end if;

  if m.conta_receber_id is not null then
    select * into cr from public.contas_receber where id=m.conta_receber_id for update;
    if cr.id is null then raise exception 'Título a receber não encontrado'; end if;
    if cr.status='cancelado' then raise exception 'Título já cancelado'; end if;
    if coalesce(cr.valor_pago,0) < m.valor then
      raise exception 'Saldo pago do título é inferior ao movimento';
    end if;
    novo_pago:=cr.valor_pago-m.valor;
    devido:=cr.valor+cr.juros+cr.multa+cr.acrescimo-cr.desconto;
    novo_status:=case when novo_pago<=0 then 'aberto' when novo_pago<devido then 'parcial' else 'pago' end;
    update public.contas_receber
      set valor_pago=novo_pago,
          status=novo_status,
          data_pagamento=case when novo_status='pago' then data_pagamento else null end
    where id=cr.id;
  elsif m.conta_pagar_id is not null then
    select * into cp from public.contas_pagar where id=m.conta_pagar_id for update;
    if cp.id is null then raise exception 'Título a pagar não encontrado'; end if;
    if cp.status='cancelado' then raise exception 'Título já cancelado'; end if;
    if coalesce(cp.valor_pago,0) < m.valor then
      raise exception 'Saldo pago do título é inferior ao movimento';
    end if;
    novo_pago:=cp.valor_pago-m.valor;
    devido:=cp.valor+cp.juros+cp.multa+cp.acrescimo-cp.desconto;
    novo_status:=case when novo_pago<=0 then 'aberto' when novo_pago<devido then 'parcial' else 'pago' end;
    update public.contas_pagar
      set valor_pago=novo_pago,
          status=novo_status,
          data_pagamento=case when novo_status='pago' then data_pagamento else null end
    where id=cp.id;
  end if;

  insert into public.movimentos_financeiros
    (conta_id,data,tipo,origem,valor,centro_id,forma_pagamento_id,
     conta_receber_id,conta_pagar_id,descricao,documento,created_by)
  values
    (m.conta_id, current_date,
     case when m.tipo='entrada' then 'saida' else 'entrada' end,
     'estorno',m.valor,m.centro_id,m.forma_pagamento_id,
     m.conta_receber_id,m.conta_pagar_id,
     'Estorno: '||coalesce(nullif(_motivo,''),'sem motivo'),
     m.documento,auth.uid())
  returning * into rev;

  insert into public.estornos_financeiros
    (movimento_original_id,movimento_estorno_id,conta_receber_id,conta_pagar_id,valor,motivo,created_by)
  values
    (m.id,rev.id,m.conta_receber_id,m.conta_pagar_id,m.valor,btrim(_motivo),auth.uid())
  returning * into e;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('movimentos_financeiros',m.id,'estorno',
         jsonb_build_object('estorno_id',e.id,'valor',m.valor,'motivo',_motivo),auth.uid());

  return e;
end;
$$;

create or replace function public.estornar_transferencia_financeira(
  _transferencia_id uuid,
  _motivo text
) returns public.estornos_financeiros
language plpgsql
security definer
set search_path=public
as $$
declare
  t public.transferencias;
  e public.estornos_financeiros;
  origem public.contas_financeiras;
  destino public.contas_financeiras;
  centro uuid;
  rev public.movimentos_financeiros;
begin
  if not public.can_finance(auth.uid()) then raise exception 'Sem permissão para estornar transferências'; end if;
  if nullif(btrim(_motivo),'') is null then raise exception 'Informe o motivo do estorno'; end if;

  select * into t from public.transferencias where id=_transferencia_id for update;
  if t.id is null then raise exception 'Transferência não encontrada'; end if;

  select * into e from public.estornos_financeiros
  where transferencia_original_id=_transferencia_id
  for update;
  if e.id is not null then return e; end if;

  select * into origem from public.contas_financeiras where id=t.conta_origem_id and ativo;
  select * into destino from public.contas_financeiras where id=t.conta_destino_id and ativo;
  if origem.id is null or destino.id is null then raise exception 'Conta da transferência não está disponível'; end if;
  if not public.usuario_pode_acessar_conta_financeira(origem.id)
     or not public.usuario_pode_acessar_conta_financeira(destino.id) then
    raise exception 'Sem acesso às contas da transferência';
  end if;
  centro:=origem.centro_id;
  if centro is distinct from destino.centro_id then raise exception 'Transferência entre centros não pode ser estornada por esta operação'; end if;

  insert into public.movimentos_financeiros
    (conta_id,data,tipo,origem,valor,transferencia_id,centro_id,descricao,created_by)
  values
    (origem.id,current_date,'entrada','estorno_transferencia',t.valor,t.id,centro,
     'Estorno transferência: '||btrim(_motivo),auth.uid()),
    (destino.id,current_date,'saida','estorno_transferencia',t.valor,t.id,centro,
     'Estorno transferência: '||btrim(_motivo),auth.uid())
  returning * into rev;

  insert into public.estornos_financeiros
    (transferencia_original_id,movimento_estorno_id,valor,motivo,created_by)
  values
    (t.id,rev.id,t.valor,btrim(_motivo),auth.uid())
  returning * into e;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('transferencias',t.id,'estorno',
         jsonb_build_object('estorno_id',e.id,'valor',t.valor,'motivo',_motivo),auth.uid());

  return e;
end;
$$;

revoke all on function public.estornar_movimento_financeiro(uuid,text) from public;
revoke all on function public.estornar_transferencia_financeira(uuid,text) from public;
grant execute on function public.estornar_movimento_financeiro(uuid,text) to authenticated;
grant execute on function public.estornar_transferencia_financeira(uuid,text) to authenticated;

commit;
