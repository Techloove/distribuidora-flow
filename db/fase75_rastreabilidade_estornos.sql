-- Fase 75: rastreabilidade completa dos dois movimentos de estorno de transferência.
begin;

alter table public.estornos_financeiros
  add column if not exists movimento_estorno_destino_id uuid
  references public.movimentos_financeiros(id);

create index if not exists estornos_financeiros_mov_estorno_destino_idx
  on public.estornos_financeiros(movimento_estorno_destino_id);

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
  rev_origem public.movimentos_financeiros;
  rev_destino public.movimentos_financeiros;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissão para estornar transferências';
  end if;
  if nullif(btrim(_motivo),'') is null then
    raise exception 'Informe o motivo do estorno';
  end if;

  select * into t
  from public.transferencias
  where id=_transferencia_id
  for update;

  if t.id is null then
    raise exception 'Transferência não encontrada';
  end if;

  select * into e
  from public.estornos_financeiros
  where transferencia_original_id=_transferencia_id
  for update;

  if e.id is not null then
    return e;
  end if;

  select * into origem
  from public.contas_financeiras
  where id=t.conta_origem_id and ativo
  for update;

  select * into destino
  from public.contas_financeiras
  where id=t.conta_destino_id and ativo
  for update;

  if origem.id is null or destino.id is null then
    raise exception 'Conta da transferência não está disponível';
  end if;

  if not public.usuario_pode_acessar_conta_financeira(origem.id)
     or not public.usuario_pode_acessar_conta_financeira(destino.id) then
    raise exception 'Sem acesso às contas da transferência';
  end if;

  centro:=origem.centro_id;

  if centro is distinct from destino.centro_id then
    raise exception 'Transferência entre centros não pode ser estornada por esta operação';
  end if;

  insert into public.movimentos_financeiros
    (conta_id,data,tipo,origem,valor,transferencia_id,centro_id,descricao,created_by)
  values
    (origem.id,current_date,'entrada','estorno_transferencia',t.valor,t.id,centro,
     'Estorno transferência: '||btrim(_motivo),auth.uid())
  returning * into rev_origem;

  insert into public.movimentos_financeiros
    (conta_id,data,tipo,origem,valor,transferencia_id,centro_id,descricao,created_by)
  values
    (destino.id,current_date,'saida','estorno_transferencia',t.valor,t.id,centro,
     'Estorno transferência: '||btrim(_motivo),auth.uid())
  returning * into rev_destino;

  insert into public.estornos_financeiros
    (transferencia_original_id,movimento_estorno_id,movimento_estorno_destino_id,
     valor,motivo,created_by)
  values
    (t.id,rev_origem.id,rev_destino.id,t.valor,btrim(_motivo),auth.uid())
  returning * into e;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values(
    'transferencias',
    t.id,
    'estorno',
    jsonb_build_object(
      'estorno_id',e.id,
      'movimento_estorno_origem_id',rev_origem.id,
      'movimento_estorno_destino_id',rev_destino.id,
      'valor',t.valor,
      'motivo',_motivo
    ),
    auth.uid()
  );

  return e;
end;
$$;

revoke all on function public.estornar_transferencia_financeira(uuid,text) from public;
grant execute on function public.estornar_transferencia_financeira(uuid,text) to authenticated;

commit;
