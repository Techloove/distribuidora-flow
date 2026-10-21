-- Compatibiliza a guarda da fase86 com separação/conferência/cargas das fases42/233.
-- Não altera dados nem repete confirmação de venda, estoque ou financeiro.
begin;
do $$begin
 if to_regprocedure('public.concluir_separacao_pratica_233(uuid,boolean)') is null or to_regprocedure('public.validar_expedicao_pedido()') is null then raise exception 'Confira as fases86 e233 antes da fase254';end if;
end $$;
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
        (old.status='pendente' and new.status in ('separacao','cancelada')) or
        (old.status='separacao' and new.status in ('separado','em_rota','cancelada')) or
        (old.status='separado' and new.status in ('aguardando_entrega','cancelada')) or
        (old.status='aguardando_entrega' and new.status in ('em_rota','cancelada')) or
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

revoke all on function public.validar_expedicao_pedido() from public,anon,authenticated;
drop trigger if exists trg_validar_expedicao_pedido on public.expedicoes;
create trigger trg_validar_expedicao_pedido before insert or update on public.expedicoes
 for each row execute function public.validar_expedicao_pedido();
notify pgrst,'reload schema';
commit;
