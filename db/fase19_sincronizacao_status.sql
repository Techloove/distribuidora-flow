-- =============================================================
-- Fase 19: sincronização de status entre Pedido, Separação e Expedição
-- Idempotente. Pode ser executada quantas vezes for necessário.
-- =============================================================

-- Marcador de sessão para evitar recursão entre os gatilhos.
create or replace function public.sync_status_ativo()
returns boolean
language sql stable as $$
  select coalesce(current_setting('app.sync_status', true), '') = 'on'
$$;

-- -------------------------------------------------------------
-- 1. Pedido -> Expedição
-- -------------------------------------------------------------
create or replace function public.sync_expedicao_do_pedido()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  destino text;
begin
  if public.sync_status_ativo() then
    return new;
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;

  destino := case new.status
    when 'separacao' then 'separacao'
    when 'separado'  then 'separacao'
    when 'em_rota'   then 'em_rota'
    when 'entregue'  then 'entregue'
    when 'cancelado' then 'cancelada'
    else null end;

  if destino is null then
    return new;
  end if;

  perform set_config('app.sync_status', 'on', true);

  update public.expedicoes e
     set status = destino,
         data_saida = case when destino = 'em_rota' then coalesce(e.data_saida, current_date) else e.data_saida end,
         data_entrega = case when destino = 'entregue' then coalesce(e.data_entrega, current_date) else e.data_entrega end
   where e.pedido_id = new.id
     and e.status is distinct from destino
     and (e.status not in ('entregue','cancelada') or destino = 'cancelada');

  perform set_config('app.sync_status', 'off', true);
  return new;
end $$;

drop trigger if exists trg_sync_expedicao_do_pedido on public.pedidos;
create trigger trg_sync_expedicao_do_pedido
after update of status on public.pedidos
for each row execute function public.sync_expedicao_do_pedido();

-- -------------------------------------------------------------
-- 2. Expedição -> Pedido
-- -------------------------------------------------------------
create or replace function public.sync_pedido_da_expedicao()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  destino text;
  atual text;
begin
  if public.sync_status_ativo() then
    return new;
  end if;
  if new.status is not distinct from old.status or new.pedido_id is null then
    return new;
  end if;

  destino := case new.status
    when 'separacao' then 'separacao'
    when 'em_rota'   then 'em_rota'
    when 'entregue'  then 'entregue'
    when 'cancelada' then 'cancelado'
    else null end;

  if destino is null then
    return new;
  end if;

  select status into atual from public.pedidos where id = new.pedido_id;
  if atual is null or atual = destino then
    return new;
  end if;
  -- pedidos já finalizados/cancelados não voltam atrás
  if atual in ('cancelado','devolvido','entregue') and destino <> 'cancelado' then
    return new;
  end if;

  perform set_config('app.sync_status', 'on', true);

  -- passa pelos estados intermediários para manter a linha do tempo coerente
  if destino = 'em_rota' and atual in ('aprovado','confirmado','separacao') then
    update public.pedidos set status = 'separado' where id = new.pedido_id;
  end if;
  if destino = 'entregue' and atual not in ('em_rota') then
    update public.pedidos set status = 'em_rota' where id = new.pedido_id;
  end if;

  update public.pedidos set status = destino where id = new.pedido_id;

  perform set_config('app.sync_status', 'off', true);
  return new;
end $$;

drop trigger if exists trg_sync_pedido_da_expedicao on public.expedicoes;
create trigger trg_sync_pedido_da_expedicao
after update of status on public.expedicoes
for each row execute function public.sync_pedido_da_expedicao();

-- -------------------------------------------------------------
-- 3. Transições do pedido aceitam o caminho completo
-- -------------------------------------------------------------
create or replace function public.avancar_pedido(_pedido_id uuid, _novo_status text)
returns public.pedidos
language plpgsql security definer set search_path to 'public' as $$
declare
  ped public.pedidos;
  permitido boolean := false;
begin
  select * into ped from public.pedidos where id = _pedido_id for update;
  if ped.id is null then raise exception 'Pedido não encontrado'; end if;

  permitido := case ped.status
    when 'rascunho'             then _novo_status in ('digitacao','aguardando_aprovacao','cancelado')
    when 'digitacao'            then _novo_status in ('aguardando_aprovacao','cancelado')
    when 'aguardando_aprovacao' then _novo_status in ('aprovado','recusado','cancelado')
    when 'aprovado'             then _novo_status in ('separacao','confirmado','cancelado')
    when 'confirmado'           then _novo_status in ('separacao','cancelado')
    when 'separacao'            then _novo_status in ('separado','cancelado')
    when 'separado'             then _novo_status in ('faturado','em_rota','cancelado')
    when 'faturado'             then _novo_status in ('em_rota','cancelado')
    when 'em_rota'              then _novo_status in ('entregue','parcial','nao_entregue','devolvido')
    else false end;

  if not permitido then
    raise exception 'Transição inválida: % → %', ped.status, _novo_status;
  end if;

  if _novo_status in ('aprovado','recusado') and not public.can_manage(auth.uid()) then
    raise exception 'Somente admin/gestor pode aprovar ou recusar pedidos';
  end if;
  if _novo_status not in ('aprovado','recusado') and not public.can_operate(auth.uid())
     and not public.can_ship(auth.uid()) and not public.can_stock(auth.uid()) then
    raise exception 'Sem permissão para alterar o status do pedido';
  end if;

  update public.pedidos set status = _novo_status where id = _pedido_id returning * into ped;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('pedidos', _pedido_id, 'status',
          jsonb_build_object('de', _novo_status, 'numero', ped.numero), auth.uid());

  perform public.notificar('Pedido ' || ped.numero,
    'Novo status: ' || _novo_status, 'info', '/pedidos');
  return ped;
end $$;

-- -------------------------------------------------------------
-- 4. Separação mostra todo o ciclo logístico do pedido
-- -------------------------------------------------------------
create or replace view public.vw_separacao as
select p.id as pedido_id, p.numero, p.status, p.centro_id, c.nome as centro,
       cli.razao_social as cliente, p.onda_id,
       pr.id as produto_id, pr.codigo as produto_codigo, pr.descricao as produto,
       sum(pi.quantidade) as quantidade, pr.estoque_atual,
       r.nome as rota, r.sequencia as rota_sequencia,
       cli.sequencia_entrega as sequencia_entrega,
       e.numero as romaneio_numero, e.status as expedicao_status
  from public.pedidos p
  join public.pedido_itens pi on pi.pedido_id = p.id
  join public.produtos pr on pr.id = pi.produto_id
  left join public.clientes cli on cli.id = p.cliente_id
  left join public.centros c on c.id = p.centro_id
  left join public.rotas r on r.id = p.rota_id
  left join public.expedicoes e on e.pedido_id = p.id
 where p.status in ('aprovado','confirmado','separacao','separado','faturado','em_rota')
 group by p.id, p.numero, p.status, p.centro_id, c.nome, cli.razao_social, p.onda_id,
          pr.id, pr.codigo, pr.descricao, pr.estoque_atual, r.nome, r.sequencia,
          cli.sequencia_entrega, e.numero, e.status;
grant select on public.vw_separacao to authenticated;

-- -------------------------------------------------------------
-- 5. Alinha os registros existentes (expedição segue o pedido)
-- -------------------------------------------------------------
do $$
begin
  perform set_config('app.sync_status', 'on', true);
  update public.expedicoes e
     set status = case p.status
           when 'separacao' then 'separacao'
           when 'separado'  then 'separacao'
           when 'em_rota'   then 'em_rota'
           when 'entregue'  then 'entregue'
           when 'cancelado' then 'cancelada'
           else e.status end
    from public.pedidos p
   where p.id = e.pedido_id
     and e.status not in ('entregue','cancelada');
  perform set_config('app.sync_status', 'off', true);
end $$;
