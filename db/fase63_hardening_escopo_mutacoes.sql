-- Fase 63: defesa em profundidade contra mutacoes cross-center.
-- Nao inclui Mercado Livre/Shopee.

create or replace function public.validar_escopo_mutacao_centro()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' and old.centro_id is distinct from new.centro_id then
    raise exception 'Nao e permitido alterar o centro de um registro existente';
  end if;
  if new.centro_id is null then raise exception 'Centro obrigatorio para esta operacao'; end if;
  if not public.usuario_pode_acessar_centro(new.centro_id) then
    raise exception 'Registro pertence a outro centro';
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['pedidos','compras','cargas','notas_saida','boletos','estoque_movimentos','expedicoes','devolucoes'] loop
    if to_regclass('public.'||t) is not null and exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='centro_id'
    ) then
      execute format('drop trigger if exists trg_escopo_centro_mutacao on public.%I',t);
      execute format('create trigger trg_escopo_centro_mutacao before insert or update on public.%I for each row execute function public.validar_escopo_mutacao_centro()',t);
    end if;
  end loop;
end
$$;

create or replace function public.validar_escopo_item_documento()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_centro uuid;
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name='pedido_itens' then
    select centro_id into v_centro from public.pedidos where id=new.pedido_id;
  elsif tg_table_name='compra_itens' then
    select centro_id into v_centro from public.compras where id=new.compra_id;
  end if;
  if v_centro is null then raise exception 'Documento pai sem centro valido'; end if;
  if not public.usuario_pode_acessar_centro(v_centro) then
    raise exception 'Documento pertence a outro centro';
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.pedido_itens') is not null then
    drop trigger if exists trg_escopo_pedido_item on public.pedido_itens;
    create trigger trg_escopo_pedido_item before insert or update on public.pedido_itens for each row execute function public.validar_escopo_item_documento();
  end if;
  if to_regclass('public.compra_itens') is not null then
    drop trigger if exists trg_escopo_compra_item on public.compra_itens;
    create trigger trg_escopo_compra_item before insert or update on public.compra_itens for each row execute function public.validar_escopo_item_documento();
  end if;
end
$$;

create or replace function public.validar_escopo_comissao()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_centro uuid;
begin
  if auth.uid() is null then return new; end if;
  select centro_id into v_centro from public.pedidos where id=new.pedido_id;
  if v_centro is null then raise exception 'Pedido da comissao sem centro valido'; end if;
  if not public.usuario_pode_acessar_centro(v_centro) then
    raise exception 'Pedido da comissao pertence a outro centro';
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.comissoes') is not null then
    drop trigger if exists trg_escopo_comissao on public.comissoes;
    create trigger trg_escopo_comissao before insert or update on public.comissoes for each row execute function public.validar_escopo_comissao();
  end if;
end
$$;

create or replace function public.validar_escopo_titulo_financeiro()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_centro uuid;
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name='contas_receber' and new.pedido_id is not null then
    select centro_id into v_centro from public.pedidos where id=new.pedido_id;
  elsif tg_table_name='contas_pagar' and new.compra_id is not null then
    select centro_id into v_centro from public.compras where id=new.compra_id;
  else
    return new;
  end if;
  if v_centro is null then raise exception 'Documento financeiro sem centro valido'; end if;
  if not public.usuario_pode_acessar_centro(v_centro) then
    raise exception 'Documento financeiro pertence a outro centro';
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.contas_receber') is not null then
    drop trigger if exists trg_escopo_conta_receber on public.contas_receber;
    create trigger trg_escopo_conta_receber before insert or update on public.contas_receber for each row execute function public.validar_escopo_titulo_financeiro();
  end if;
  if to_regclass('public.contas_pagar') is not null then
    drop trigger if exists trg_escopo_conta_pagar on public.contas_pagar;
    create trigger trg_escopo_conta_pagar before insert or update on public.contas_pagar for each row execute function public.validar_escopo_titulo_financeiro();
  end if;
end
$$;

revoke all on function public.validar_escopo_mutacao_centro() from public;
revoke all on function public.validar_escopo_item_documento() from public;
revoke all on function public.validar_escopo_comissao() from public;
revoke all on function public.validar_escopo_titulo_financeiro() from public;
