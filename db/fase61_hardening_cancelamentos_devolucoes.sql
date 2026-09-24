-- Fase 61: idempotencia e consistencia de cancelamentos e devolucoes.
-- Nao inclui Mercado Livre/Shopee.

create table if not exists public.pedido_operacoes (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  tipo text not null check (tipo in ('cancelamento')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (pedido_id, tipo)
);

create index if not exists pedido_operacoes_pedido_idx
  on public.pedido_operacoes(pedido_id);

alter table public.pedido_operacoes enable row level security;
revoke all on public.pedido_operacoes from anon, authenticated;

create table if not exists public.devolucao_operacoes (
  id uuid primary key default gen_random_uuid(),
  devolucao_id uuid not null references public.devolucoes(id) on delete cascade,
  tipo text not null check (tipo in ('confirmacao','cancelamento')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (devolucao_id, tipo)
);

create index if not exists devolucao_operacoes_dev_idx
  on public.devolucao_operacoes(devolucao_id);

alter table public.devolucao_operacoes enable row level security;
revoke all on public.devolucao_operacoes from anon, authenticated;

-- Preflight: nao cria a restricao de credito se ja houver duplicidades.
do $$
declare v_count bigint;
begin
  select count(*) into v_count from (
    select pedido_id, documento
    from public.contas_receber
    where documento like 'DEV-%' and pedido_id is not null
    group by pedido_id, documento
    having count(*) > 1
  ) d;
  if v_count > 0 then
    raise exception 'Existem % devolucoes com creditos duplicados. Corrija-os antes de criar a restricao.', v_count;
  end if;
end $$;

create unique index if not exists contas_receber_devolucao_uq
  on public.contas_receber(pedido_id, documento)
  where documento like 'DEV-%' and pedido_id is not null;

create or replace function public.cancelar_pedido(_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ped public.pedidos;
  op_id uuid;
  item record;
  v_pago numeric(14,2);
begin
  if not public.can_operate(auth.uid()) then
    raise exception 'Sem permissao para cancelar pedidos';
  end if;

  select * into ped from public.pedidos where id = _pedido_id for update;
  if ped.id is null then raise exception 'Pedido nao encontrado'; end if;
  if not public.usuario_pode_acessar_centro(ped.centro_id) then
    raise exception 'Pedido pertence a outro centro';
  end if;
  if ped.status = 'cancelado' then return; end if;
  if ped.status not in ('confirmado','faturado') then
    raise exception 'Pedido no status % nao pode ser cancelado por esta operacao', ped.status;
  end if;

  select coalesce(sum(valor_pago),0) into v_pago
  from public.contas_receber where pedido_id = _pedido_id;
  if v_pago > 0 then
    raise exception 'Pedido possui recebimentos. Utilize o fluxo de devolucao/estorno financeiro';
  end if;

  insert into public.pedido_operacoes(pedido_id,tipo,created_by)
  values (_pedido_id,'cancelamento',auth.uid())
  on conflict (pedido_id,tipo) do nothing
  returning id into op_id;

  if op_id is null then return; end if;

  for item in
    select produto_id, sum(quantidade) as qtd
    from public.pedido_itens where pedido_id = _pedido_id group by produto_id
  loop
    insert into public.estoque_movimentos
      (produto_id,centro_id,tipo,quantidade,origem,documento_id,observacao,created_by)
    values (item.produto_id,ped.centro_id,'entrada',item.qtd,'pedido_cancelado',
            _pedido_id,'Reversao de estoque por cancelamento de pedido',auth.uid());
  end loop;

  update public.contas_receber set status='cancelado'
  where pedido_id=_pedido_id and status <> 'pago';

  update public.comissoes set status='cancelada'
  where pedido_id=_pedido_id and status <> 'paga';

  update public.expedicoes set status='cancelada'
  where pedido_id=_pedido_id and status not in ('entregue','cancelada');

  update public.pedidos set status='cancelado' where id=_pedido_id;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values ('pedidos',_pedido_id,'cancelar',
          jsonb_build_object('status_anterior',ped.status,'estoque_revertido',true),auth.uid());
end;
$$;

grant execute on function public.cancelar_pedido(uuid) to authenticated;

create or replace function public.confirmar_devolucao(_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  dev public.devolucoes;
  ped public.pedidos;
  it record;
  op_id uuid;
  qtd_vendida numeric(14,3);
  qtd_devolvida numeric(14,3);
begin
  if not public.can_manage(auth.uid()) then
    raise exception 'Sem permissao para confirmar devolucoes';
  end if;

  select * into dev from public.devolucoes where id=_id for update;
  if dev.id is null then raise exception 'Devolucao nao encontrada'; end if;

  if dev.pedido_id is not null then
    select * into ped from public.pedidos where id=dev.pedido_id for update;
    if ped.id is null then raise exception 'Pedido de origem nao encontrado'; end if;
    if not public.usuario_pode_acessar_centro(ped.centro_id) then
      raise exception 'Pedido pertence a outro centro';
    end if;
    if ped.status not in ('confirmado','faturado','entregue','parcial','nao_entregue','devolvido') then
      raise exception 'Pedido no status % nao permite devolucao',ped.status;
    end if;
    if dev.centro_id is null then dev.centro_id:=ped.centro_id;
    elsif dev.centro_id<>ped.centro_id then
      raise exception 'Centro da devolucao difere do centro do pedido';
    end if;
  else
    if not public.usuario_pode_acessar_centro(dev.centro_id) then
      raise exception 'Devolucao pertence a outro centro';
    end if;
  end if;

  if dev.status='confirmada' then return; end if;
  if dev.status<>'rascunho' then
    raise exception 'Somente devolucoes em rascunho podem ser confirmadas';
  end if;
  if not exists(select 1 from public.devolucao_itens where devolucao_id=_id) then
    raise exception 'Inclua ao menos um item na devolucao';
  end if;
  if dev.centro_id is null then raise exception 'Centro da devolucao obrigatorio'; end if;

  insert into public.devolucao_operacoes(devolucao_id,tipo,created_by)
  values(_id,'confirmacao',auth.uid())
  on conflict(devolucao_id,tipo) do nothing
  returning id into op_id;

  if op_id is null then return; end if;

  for it in
    select produto_id,sum(quantidade) as qtd,sum(total) as total
    from public.devolucao_itens where devolucao_id=_id group by produto_id
  loop
    if dev.pedido_id is not null then
      select coalesce(sum(quantidade),0) into qtd_vendida
      from public.pedido_itens
      where pedido_id=dev.pedido_id and produto_id=it.produto_id;

      select coalesce(sum(di.quantidade),0) into qtd_devolvida
      from public.devolucao_itens di
      join public.devolucoes d on d.id=di.devolucao_id
      where d.pedido_id=dev.pedido_id and di.produto_id=it.produto_id
        and d.status='confirmada' and d.id<>_id;

      if it.qtd>greatest(qtd_vendida-qtd_devolvida,0) then
        raise exception 'Quantidade devolvida do produto % excede a quantidade vendida disponivel',it.produto_id;
      end if;
    end if;

    insert into public.estoque_movimentos
      (produto_id,centro_id,tipo,quantidade,custo_unitario,origem,documento_id,observacao,created_by)
    values
      (it.produto_id,dev.centro_id,'entrada',it.qtd,
       case when it.qtd<>0 then it.total/it.qtd else 0 end,
       'devolucao',dev.id,'Entrada de devolucao '||dev.numero,auth.uid());
  end loop;

  insert into public.contas_receber
    (cliente_id,pedido_id,documento,parcela,valor,vencimento,status,observacao)
  values
    (dev.cliente_id,dev.pedido_id,'DEV-'||dev.numero,1,-1*dev.valor_total,
     current_date,'aberto','Credito de devolucao '||dev.numero)
  on conflict do nothing;

  update public.devolucoes set centro_id=dev.centro_id,status='confirmada' where id=_id;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('devolucoes',_id,'confirmar',
         jsonb_build_object('numero',dev.numero,'valor',dev.valor_total,'centro_id',dev.centro_id),auth.uid());

  perform public.notificar('Devolucao confirmada',
    'Devolucao '||dev.numero||' retornou ao estoque e gerou credito ao cliente.',
    'alerta','/devolucoes');
end;
$$;

grant execute on function public.confirmar_devolucao(uuid) to authenticated;

create or replace function public.cancelar_devolucao(_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  dev public.devolucoes;
  op_id uuid;
  it record;
begin
  if not public.can_manage(auth.uid()) then
    raise exception 'Sem permissao para cancelar devolucoes';
  end if;

  select * into dev from public.devolucoes where id=_id for update;
  if dev.id is null then raise exception 'Devolucao nao encontrada'; end if;
  if not public.usuario_pode_acessar_centro(dev.centro_id) then
    raise exception 'Devolucao pertence a outro centro';
  end if;
  if dev.status='cancelada' then return; end if;

  if dev.status='rascunho' then
    update public.devolucoes set status='cancelada' where id=_id;
  elsif dev.status='confirmada' then
    insert into public.devolucao_operacoes(devolucao_id,tipo,created_by)
    values(_id,'cancelamento',auth.uid())
    on conflict(devolucao_id,tipo) do nothing
    returning id into op_id;

    if op_id is null then return; end if;

    for it in
      select produto_id,sum(quantidade) as qtd
      from public.devolucao_itens where devolucao_id=_id group by produto_id
    loop
      insert into public.estoque_movimentos
        (produto_id,centro_id,tipo,quantidade,origem,documento_id,observacao,created_by)
      values(it.produto_id,dev.centro_id,'saida',it.qtd,'devolucao_cancelada',
             dev.id,'Reversao de entrada por cancelamento de devolucao',auth.uid());
    end loop;

    update public.contas_receber set status='cancelado'
    where documento='DEV-'||dev.numero and status<>'pago';

    update public.devolucoes set status='cancelada' where id=_id;
  else
    raise exception 'Status de devolucao invalido: %',dev.status;
  end if;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('devolucoes',_id,'cancelar',
         jsonb_build_object('numero',dev.numero,'status_anterior',dev.status),auth.uid());
end;
$$;

grant execute on function public.cancelar_devolucao(uuid) to authenticated;

-- Preflight: impede criar a restricao de expedicoes sobre dados duplicados sem diagnostico.
do $$
declare v_count bigint;
begin
  if to_regclass('public.expedicoes') is not null then
    select count(*) into v_count from (
      select pedido_id from public.expedicoes
      where status<>'cancelada'
      group by pedido_id having count(*)>1
    ) d;
    if v_count>0 then
      raise exception 'Existem % pedidos com expedicoes ativas duplicadas. Corrija-os antes de criar a restricao.',v_count;
    end if;
  end if;
end $$;

create unique index if not exists expedicoes_pedido_ativa_uq
  on public.expedicoes(pedido_id) where status<>'cancelada';
