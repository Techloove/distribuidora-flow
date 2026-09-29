-- Fase 86: impedir cancelamento de pedido enquanto a expedicao esta em rota.
-- O cancelamento operacional continua permitido antes da saida.
begin;

create or replace function public.validar_cancelamento_pedido_logistico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelado' and old.status is distinct from 'cancelado' then
    if exists (
      select 1
      from public.expedicoes e
      where e.pedido_id = new.id
        and e.status in ('em_rota','entregue')
    ) then
      raise exception 'Pedido nao pode ser cancelado enquanto a expedicao estiver em rota ou entregue';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validar_cancelamento_pedido_logistico on public.pedidos;
create trigger trg_validar_cancelamento_pedido_logistico
before update of status on public.pedidos
for each row
execute function public.validar_cancelamento_pedido_logistico();

-- Uma nova expedicao so pode nascer para um pedido ainda operacionalmente
-- confirmado/faturado. Pedido entregue nao deve gerar uma segunda expedicao.
create or replace function public.validar_expedicao_pedido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ped public.pedidos;
begin
  if new.pedido_id is null then
    raise exception 'Expedicao deve estar vinculada a um pedido';
  end if;

  select * into ped from public.pedidos where id = new.pedido_id;
  if ped.id is null then
    raise exception 'Pedido da expedicao nao encontrado';
  end if;

  if ped.centro_id is null or new.centro_id is distinct from ped.centro_id then
    raise exception 'Centro da expedicao deve ser igual ao centro do pedido';
  end if;

  if tg_op = 'INSERT' then
    if new.status is null then new.status := 'pendente'; end if;
    if new.status <> 'pendente' then
      raise exception 'Nova expedicao deve iniciar em pendente';
    end if;
    if ped.status not in ('confirmado','faturado') then
      raise exception 'Somente pedidos confirmados ou faturados podem gerar expedicao';
    end if;
  else
    if new.pedido_id is distinct from old.pedido_id then
      raise exception 'Pedido da expedicao nao pode ser alterado';
    end if;
    if new.centro_id is distinct from old.centro_id then
      raise exception 'Centro da expedicao nao pode ser alterado';
    end if;

    if new.status is distinct from old.status then
      if not (
        (old.status='pendente' and new.status='separacao') or
        (old.status='separacao' and new.status in ('em_rota','cancelada')) or
        (old.status='em_rota' and new.status='entregue')
      ) then
        raise exception 'Transicao de expedicao invalida: % -> %',old.status,new.status;
      end if;
    end if;

    if old.status='entregue' and (
      new.status is distinct from old.status
      or new.pedido_id is distinct from old.pedido_id
      or new.centro_id is distinct from old.centro_id
    ) then
      raise exception 'Expedicao entregue nao pode retornar ou trocar de vinculo';
    end if;
  end if;

  return new;
end;
$$;

commit;
