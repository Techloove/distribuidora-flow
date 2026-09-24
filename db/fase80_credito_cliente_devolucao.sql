-- Fase 80: credito de cliente por devolucao e compensacao em vendas.
-- Arquitetura:
-- devolucao confirmada -> credito_cliente -> aplicacao em pedido rascunho
-- -> confirmar_pedido gera contas_receber apenas pelo saldo liquido.
-- Nao usa contas_receber negativas para novos creditos.
-- Nao inclui Mercado Livre/Shopee.

begin;

create table if not exists public.creditos_clientes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  centro_id uuid not null references public.centros(id) on delete restrict,
  devolucao_id uuid references public.devolucoes(id) on delete restrict,
  valor_original numeric(14,2) not null check (valor_original > 0),
  valor_utilizado numeric(14,2) not null default 0 check (valor_utilizado >= 0 and valor_utilizado <= valor_original),
  saldo numeric(14,2) generated always as (valor_original - valor_utilizado) stored,
  status text not null default 'disponivel'
    check (status in ('disponivel','utilizado','cancelado')),
  observacao text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists creditos_clientes_devolucao_uq
  on public.creditos_clientes(devolucao_id)
  where devolucao_id is not null;

create index if not exists creditos_clientes_cliente_idx
  on public.creditos_clientes(cliente_id, centro_id, status);

create table if not exists public.creditos_clientes_aplicacoes (
  id uuid primary key default gen_random_uuid(),
  credito_id uuid not null references public.creditos_clientes(id) on delete restrict,
  pedido_id uuid not null references public.pedidos(id) on delete restrict,
  valor numeric(14,2) not null check (valor > 0),
  status text not null default 'reservado'
    check (status in ('reservado','aplicado','revertido','cancelado')),
  chave_idempotencia text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  aplicado_em timestamptz,
  revertido_em timestamptz
);

create unique index if not exists credito_aplicacao_pedido_uq
  on public.creditos_clientes_aplicacoes(credito_id, pedido_id)
  where status in ('reservado','aplicado');

create unique index if not exists credito_aplicacao_idempotencia_uq
  on public.creditos_clientes_aplicacoes(chave_idempotencia)
  where chave_idempotencia is not null and btrim(chave_idempotencia) <> '';

create index if not exists credito_aplicacoes_pedido_idx
  on public.creditos_clientes_aplicacoes(pedido_id, status);

alter table public.creditos_clientes enable row level security;
alter table public.creditos_clientes_aplicacoes enable row level security;

revoke all on public.creditos_clientes from anon, authenticated;
revoke all on public.creditos_clientes_aplicacoes from anon, authenticated;
grant select on public.creditos_clientes to authenticated;
grant select on public.creditos_clientes_aplicacoes to authenticated;

drop policy if exists "creditos_clientes_select" on public.creditos_clientes;
create policy "creditos_clientes_select"
on public.creditos_clientes for select to authenticated
using (public.usuario_pode_acessar_centro(centro_id));

drop policy if exists "credito_aplicacoes_select" on public.creditos_clientes_aplicacoes;
create policy "credito_aplicacoes_select"
on public.creditos_clientes_aplicacoes for select to authenticated
using (
  exists (
    select 1
    from public.creditos_clientes c
    where c.id = credito_id
      and public.usuario_pode_acessar_centro(c.centro_id)
  )
);

create or replace function public.trg_credito_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_creditos_clientes_updated on public.creditos_clientes;
create trigger trg_creditos_clientes_updated
before update on public.creditos_clientes
for each row execute function public.trg_credito_updated_at();

-- Cria o credito uma unica vez para cada devolucao confirmada.
create or replace function public.criar_credito_devolucao(
  _devolucao_id uuid,
  _cliente_id uuid,
  _centro_id uuid,
  _valor numeric,
  _observacao text default null
)
returns public.creditos_clientes
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.creditos_clientes;
  dev public.devolucoes;
begin
  if not public.can_manage(auth.uid()) then
    raise exception 'Sem permissao para gerar credito de cliente';
  end if;

  select * into dev
  from public.devolucoes
  where id = _devolucao_id
  for update;

  if dev.id is null then
    raise exception 'Devolucao nao encontrada';
  end if;

  if dev.status <> 'confirmada' then
    raise exception 'Somente devolucao confirmada pode gerar credito';
  end if;

  if dev.cliente_id is distinct from _cliente_id then
    raise exception 'Cliente do credito difere da devolucao';
  end if;

  if dev.centro_id is distinct from _centro_id then
    raise exception 'Centro do credito difere da devolucao';
  end if;

  if coalesce(_valor,0) <= 0 then
    raise exception 'Valor do credito invalido';
  end if;

  select * into c
  from public.creditos_clientes
  where devolucao_id = _devolucao_id
  for update;

  if c.id is not null then
    return c;
  end if;

  insert into public.creditos_clientes
    (cliente_id, centro_id, devolucao_id, valor_original, observacao, created_by)
  values
    (_cliente_id, _centro_id, _devolucao_id, round(_valor,2),
     nullif(_observacao,''), auth.uid())
  returning * into c;

  insert into public.auditoria(tabela, registro_id, acao, detalhe, user_id)
  values (
    'creditos_clientes', c.id, 'criar',
    jsonb_build_object(
      'devolucao_id', _devolucao_id,
      'cliente_id', _cliente_id,
      'centro_id', _centro_id,
      'valor', c.valor_original
    ),
    auth.uid()
  );

  return c;
end;
$$;

grant execute on function public.criar_credito_devolucao(uuid,uuid,uuid,numeric,text) to authenticated;

-- Reserva credito em pedido ainda nao confirmado.
create or replace function public.aplicar_credito_cliente(
  _credito_id uuid,
  _pedido_id uuid,
  _valor numeric,
  _chave_idempotencia text default null
)
returns public.creditos_clientes_aplicacoes
language plpgsql
security definer
set search_path = public
as $$
declare
  cred public.creditos_clientes;
  ped public.pedidos;
  app public.creditos_clientes_aplicacoes;
  ja numeric(14,2);
  valor_total numeric(14,2);
begin
  if not public.can_operate(auth.uid()) then
    raise exception 'Sem permissao para aplicar credito em pedidos';
  end if;

  if coalesce(_valor,0) <= 0 then
    raise exception 'Informe um valor de credito maior que zero';
  end if;

  if _chave_idempotencia is not null and btrim(_chave_idempotencia) <> '' then
    select * into app
    from public.creditos_clientes_aplicacoes
    where chave_idempotencia = btrim(_chave_idempotencia)
    for update;
    if app.id is not null then
      return app;
    end if;
  end if;

  select * into ped
  from public.pedidos
  where id = _pedido_id
  for update;

  if ped.id is null then
    raise exception 'Pedido nao encontrado';
  end if;

  if ped.status <> 'rascunho' then
    raise exception 'O credito somente pode ser aplicado antes da confirmacao do pedido';
  end if;

  if ped.cliente_id is null then
    raise exception 'Pedido sem cliente';
  end if;

  if ped.centro_id is null or not public.usuario_pode_acessar_centro(ped.centro_id) then
    raise exception 'Pedido pertence a outro centro ou nao possui centro';
  end if;

  select * into cred
  from public.creditos_clientes
  where id = _credito_id
  for update;

  if cred.id is null then
    raise exception 'Credito nao encontrado';
  end if;

  if cred.status = 'cancelado' or cred.saldo <= 0 then
    raise exception 'Credito sem saldo disponivel';
  end if;

  if cred.cliente_id is distinct from ped.cliente_id then
    raise exception 'O credito pertence a outro cliente';
  end if;

  if cred.centro_id is distinct from ped.centro_id then
    raise exception 'O credito pertence a outro centro';
  end if;

  perform public.recalcular_pedido(_pedido_id);

  select total_liquido into valor_total
  from public.pedidos
  where id = _pedido_id;

  select coalesce(sum(valor),0) into ja
  from public.creditos_clientes_aplicacoes
  where pedido_id = _pedido_id
    and status = 'reservado';

  if _valor > cred.saldo then
    raise exception 'Valor superior ao saldo disponivel do credito';
  end if;

  if ja + _valor > valor_total then
    raise exception 'A aplicacao de credito excede o valor do pedido';
  end if;

  insert into public.creditos_clientes_aplicacoes
    (credito_id, pedido_id, valor, status, chave_idempotencia, created_by)
  values
    (cred.id, ped.id, round(_valor,2), 'reservado',
     nullif(btrim(_chave_idempotencia),''), auth.uid())
  returning * into app;

  update public.creditos_clientes
  set status = case when valor_utilizado + _valor >= valor_original then 'utilizado' else 'disponivel' end
  where id = cred.id;

  insert into public.auditoria(tabela, registro_id, acao, detalhe, user_id)
  values (
    'creditos_clientes_aplicacoes', app.id, 'reservar',
    jsonb_build_object(
      'credito_id', cred.id,
      'pedido_id', ped.id,
      'valor', app.valor
    ),
    auth.uid()
  );

  return app;
end;
$$;

grant execute on function public.aplicar_credito_cliente(uuid,uuid,numeric,text) to authenticated;

-- Remove uma reserva enquanto o pedido ainda esta em rascunho.
create or replace function public.cancelar_aplicacao_credito(_aplicacao_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  app public.creditos_clientes_aplicacoes;
  ped public.pedidos;
  cred public.creditos_clientes;
begin
  if not public.can_operate(auth.uid()) then
    raise exception 'Sem permissao para cancelar aplicacao de credito';
  end if;

  select * into app
  from public.creditos_clientes_aplicacoes
  where id = _aplicacao_id
  for update;

  if app.id is null then
    raise exception 'Aplicacao de credito nao encontrada';
  end if;

  select * into ped from public.pedidos where id = app.pedido_id for update;
  if ped.id is null then raise exception 'Pedido nao encontrado'; end if;
  if ped.status <> 'rascunho' then
    raise exception 'Somente aplicacoes de pedidos em rascunho podem ser canceladas';
  end if;

  select * into cred from public.creditos_clientes where id = app.credito_id for update;

  update public.creditos_clientes_aplicacoes
  set status = 'cancelado'
  where id = app.id and status = 'reservado';

  update public.creditos_clientes
  set status = case
    when valor_utilizado > 0 then
      case when valor_utilizado >= valor_original then 'utilizado' else 'disponivel' end
    else 'disponivel'
  end
  where id = cred.id;

  insert into public.auditoria(tabela, registro_id, acao, detalhe, user_id)
  values (
    'creditos_clientes_aplicacoes', app.id, 'cancelar',
    jsonb_build_object('credito_id', app.credito_id, 'pedido_id', app.pedido_id, 'valor', app.valor),
    auth.uid()
  );
end;
$$;

grant execute on function public.cancelar_aplicacao_credito(uuid) to authenticated;

-- Fase 76 + credito: confirmacao idempotente, estoque controlado,
-- contas a receber pelo saldo liquido e aplicacoes de credito consumidas atomically.
create or replace function public.confirmar_pedido(_pedido_id uuid)
returns public.pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  ped public.pedidos;
  item record;
  app record;
  n int;
  parcelas int;
  valor_total numeric(14,2);
  credito_total numeric(14,2);
  valor_parcela numeric(14,2);
  saldo numeric(14,2);
  cred public.creditos_clientes;
begin
  if not public.can_operate(auth.uid()) then
    raise exception 'Sem permissao para confirmar pedidos';
  end if;

  select * into ped from public.pedidos where id = _pedido_id for update;

  if ped.id is null then
    raise exception 'Pedido nao encontrado';
  end if;

  if ped.centro_id is null then
    raise exception 'Centro do pedido obrigatorio';
  end if;

  if not public.usuario_pode_acessar_centro(ped.centro_id) then
    raise exception 'Pedido pertence a outro centro';
  end if;

  if ped.status = 'confirmado' then
    return ped;
  end if;

  if ped.status <> 'rascunho' then
    raise exception 'Pedido nao pode ser confirmado no status atual: %', ped.status;
  end if;

  if not exists (select 1 from public.pedido_itens where pedido_id = _pedido_id) then
    raise exception 'Inclua ao menos um item no pedido';
  end if;

  perform public.recalcular_pedido(_pedido_id);

  select * into ped from public.pedidos where id = _pedido_id for update;
  valor_total := coalesce(ped.total_liquido,0);

  -- Bloqueia e valida todas as reservas do pedido.
  credito_total := 0;
  for app in
    select *
    from public.creditos_clientes_aplicacoes
    where pedido_id = _pedido_id
      and status = 'reservado'
    order by created_at
    for update
  loop
    select * into cred from public.creditos_clientes where id = app.credito_id for update;

    if cred.id is null or cred.status = 'cancelado' then
      raise exception 'Credito da aplicacao % esta indisponivel', app.id;
    end if;
    if cred.cliente_id is distinct from ped.cliente_id then
      raise exception 'Credito aplicado pertence a outro cliente';
    end if;
    if cred.centro_id is distinct from ped.centro_id then
      raise exception 'Credito aplicado pertence a outro centro';
    end if;
    if cred.saldo < app.valor then
      raise exception 'Saldo insuficiente no credito %', cred.id;
    end if;

    credito_total := credito_total + app.valor;
  end loop;

  if credito_total > valor_total then
    raise exception 'Creditos aplicados excedem o valor do pedido';
  end if;

  for item in
    select produto_id, sum(quantidade) qtd
    from public.pedido_itens
    where pedido_id = _pedido_id
    group by produto_id
  loop
    perform public.registrar_movimento_estoque_controlado(
      item.produto_id, ped.centro_id, 'saida', item.qtd, null,
      'pedido', _pedido_id, 'Baixa por confirmacao de pedido'
    );
  end loop;

  -- Gera recebiveis apenas sobre o saldo apos credito.
  parcelas := greatest(coalesce(ped.parcelas,1),1);
  saldo := valor_total - credito_total;
  if saldo > 0 then
    valor_parcela := round(saldo / parcelas,2);
    for n in 1..parcelas loop
      if n = parcelas then
        valor_parcela := saldo;
      end if;

      insert into public.contas_receber
        (cliente_id,pedido_id,documento,parcela,valor,vencimento,centro_id,data_emissao,status)
      values
        (ped.cliente_id,ped.id,'PED-'||ped.numero,n,valor_parcela,
         ped.data_pedido+((n-1)*30),ped.centro_id,current_date,'aberto');

      saldo := saldo - valor_parcela;
    end loop;
  end if;

  -- Consome o credito somente dentro da mesma transacao da confirmacao.
  for app in
    select *
    from public.creditos_clientes_aplicacoes
    where pedido_id = _pedido_id
      and status = 'reservado'
    order by created_at
    for update
  loop
    select * into cred from public.creditos_clientes where id = app.credito_id for update;

    update public.creditos_clientes
    set valor_utilizado = valor_utilizado + app.valor,
        status = case
          when valor_utilizado + app.valor >= valor_original then 'utilizado'
          else 'disponivel'
        end
    where id = cred.id;

    update public.creditos_clientes_aplicacoes
    set status = 'aplicado', aplicado_em = now()
    where id = app.id;
  end loop;

  if ped.representante_id is not null and ped.comissao_valor > 0 then
    insert into public.comissoes
      (representante_id,pedido_id,base_calculo,percentual,valor,centro_id)
    values
      (ped.representante_id,ped.id,ped.total_itens,ped.comissao_percentual,ped.comissao_valor,ped.centro_id);
  end if;

  update public.pedidos set status='confirmado' where id=_pedido_id returning * into ped;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values(
    'pedidos',_pedido_id,'confirmar',
    jsonb_build_object(
      'total',ped.total_liquido,
      'credito_aplicado',credito_total,
      'saldo_a_receber',greatest(ped.total_liquido-credito_total,0),
      'parcelas',ped.parcelas,
      'centro_id',ped.centro_id
    ),
    auth.uid()
  );

  return ped;
end;
$$;

revoke all on function public.confirmar_pedido(uuid) from public;
grant execute on function public.confirmar_pedido(uuid) to authenticated;

-- Cancelamento de pedido restaura creditos que ja foram consumidos.
create or replace function public.restaurar_creditos_cancelamento_pedido(_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  app record;
  cred public.creditos_clientes;
begin
  if not public.can_operate(auth.uid()) then
    raise exception 'Sem permissao para restaurar credito';
  end if;

  for app in
    select * from public.creditos_clientes_aplicacoes
    where pedido_id = _pedido_id and status = 'aplicado'
    order by aplicado_em
    for update
  loop
    select * into cred from public.creditos_clientes where id = app.credito_id for update;

    if cred.id is null then
      raise exception 'Credito % nao encontrado', app.credito_id;
    end if;

    update public.creditos_clientes
    set valor_utilizado = greatest(valor_utilizado - app.valor,0),
        status = case
          when status = 'cancelado' then 'cancelado'
          when valor_utilizado - app.valor <= 0 then 'disponivel'
          else 'disponivel'
        end
    where id = cred.id;

    update public.creditos_clientes_aplicacoes
    set status = 'revertido', revertido_em = now()
    where id = app.id;
  end loop;
end;
$$;

grant execute on function public.restaurar_creditos_cancelamento_pedido(uuid) to authenticated;

-- Nova confirmacao de devolucao: entrada de estoque + credito do cliente.
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
    if dev.centro_id is null then
      dev.centro_id := ped.centro_id;
    elsif dev.centro_id <> ped.centro_id then
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
  if dev.cliente_id is null then raise exception 'Cliente da devolucao obrigatorio para gerar credito'; end if;
  if coalesce(dev.valor_total,0) <= 0 then raise exception 'Valor da devolucao deve ser maior que zero'; end if;

  insert into public.devolucao_operacoes(devolucao_id,tipo,created_by)
  values(_id,'confirmacao',auth.uid())
  on conflict(devolucao_id,tipo) do nothing
  returning id into op_id;

  if op_id is null then return; end if;

  for it in
    select produto_id,sum(quantidade) as qtd,sum(total) as total
    from public.devolucao_itens
    where devolucao_id=_id
    group by produto_id
  loop
    if dev.pedido_id is not null then
      select coalesce(sum(quantidade),0) into qtd_vendida
      from public.pedido_itens
      where pedido_id=dev.pedido_id and produto_id=it.produto_id;

      select coalesce(sum(di.quantidade),0) into qtd_devolvida
      from public.devolucao_itens di
      join public.devolucoes d on d.id=di.devolucao_id
      where d.pedido_id=dev.pedido_id
        and di.produto_id=it.produto_id
        and d.status='confirmada'
        and d.id<>_id;

      if it.qtd > greatest(qtd_vendida-qtd_devolvida,0) then
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

  update public.devolucoes
  set centro_id=dev.centro_id,status='confirmada'
  where id=_id;

  perform public.criar_credito_devolucao(
    _id,dev.cliente_id,dev.centro_id,dev.valor_total,
    'Credito gerado pela devolucao '||dev.numero
  );

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values(
    'devolucoes',_id,'confirmar',
    jsonb_build_object(
      'numero',dev.numero,
      'valor',dev.valor_total,
      'centro_id',dev.centro_id,
      'credito_cliente',true
    ),
    auth.uid()
  );

  perform public.notificar(
    'Devolucao confirmada',
    'Devolucao '||dev.numero||' retornou ao estoque e gerou credito ao cliente.',
    'alerta','/devolucoes'
  );
end;
$$;

grant execute on function public.confirmar_devolucao(uuid) to authenticated;

-- Cancelamento de devolucao confirmada: estorna estoque e cancela o credito ainda nao utilizado.
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
  cred public.creditos_clientes;
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
    select * into cred
    from public.creditos_clientes
    where devolucao_id = _id
    for update;

    if cred.id is not null and cred.valor_utilizado > 0 then
      raise exception 'A devolucao possui credito ja utilizado; estorne a aplicacao do credito antes de cancelar';
    end if;

    insert into public.devolucao_operacoes(devolucao_id,tipo,created_by)
    values(_id,'cancelamento',auth.uid())
    on conflict(devolucao_id,tipo) do nothing
    returning id into op_id;

    if op_id is null then return; end if;

    for it in
      select produto_id,sum(quantidade) as qtd
      from public.devolucao_itens
      where devolucao_id=_id
      group by produto_id
    loop
      insert into public.estoque_movimentos
        (produto_id,centro_id,tipo,quantidade,origem,documento_id,observacao,created_by)
      values(
        it.produto_id,dev.centro_id,'saida',it.qtd,'devolucao_cancelada',
        dev.id,'Reversao de entrada por cancelamento de devolucao',auth.uid()
      );
    end loop;

    if cred.id is not null then
      update public.creditos_clientes
      set status='cancelado'
      where id=cred.id;
    end if;

    update public.devolucoes set status='cancelada' where id=_id;
  else
    raise exception 'Status de devolucao invalido: %',dev.status;
  end if;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values(
    'devolucoes',_id,'cancelar',
    jsonb_build_object('numero',dev.numero,'status_anterior',dev.status),
    auth.uid()
  );
end;
$$;

grant execute on function public.cancelar_devolucao(uuid) to authenticated;

-- Preflight: nao tenta apagar nem converter creditos DEV antigos.
-- Eles permanecem historicos e devem ser conciliados antes de uma eventual migracao.

commit;
