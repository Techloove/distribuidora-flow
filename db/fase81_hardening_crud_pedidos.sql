-- Fase 81: endurecimento do CRUD de pedidos.
-- O navegador nao grava mais diretamente pedidos/pedido_itens.
-- Alteracoes de pedido passam por RPCs com validacao de permissao, centro e status.
begin;

create or replace function public.criar_pedido_rascunho(
  _cliente_id uuid,
  _centro_id uuid,
  _rota_id uuid,
  _forma_pagamento_id uuid,
  _data_pedido date default current_date,
  _observacoes text default null,
  _representante_id uuid default null,
  _previsao_entrega date default null
)
returns public.pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  ped public.pedidos;
  rep uuid;
  cliente_centro uuid;
begin
  if not public.can_operate(auth.uid()) then
    raise exception 'Sem permissao para criar pedidos';
  end if;

  if _cliente_id is null then raise exception 'Cliente obrigatorio'; end if;
  if _centro_id is null or not public.usuario_pode_acessar_centro(_centro_id) then
    raise exception 'Centro invalido ou sem acesso';
  end if;
  if _rota_id is null then raise exception 'Rota de entrega obrigatoria'; end if;
  if _forma_pagamento_id is null then raise exception 'Forma de pagamento obrigatoria'; end if;

  select c.centro_id into cliente_centro from public.clientes c where c.id = _cliente_id;
  if not found then raise exception 'Cliente nao encontrado'; end if;
  if cliente_centro is not null and cliente_centro is distinct from _centro_id then
    raise exception 'Cliente pertence a outro centro';
  end if;

  if not exists (select 1 from public.rotas where id = _rota_id and ativo) then
    raise exception 'Rota nao encontrada ou inativa';
  end if;
  if not exists (select 1 from public.formas_pagamento where id = _forma_pagamento_id and ativo) then
    raise exception 'Forma de pagamento nao encontrada ou inativa';
  end if;

  rep := _representante_id;
  if public.has_role(auth.uid(), 'representante')
     and not public.has_role(auth.uid(), 'admin')
     and not public.has_role(auth.uid(), 'gestor') then
    rep := public.meu_representante_id();
    if rep is null then raise exception 'Usuario representante sem vinculo cadastrado'; end if;
  elsif rep is not null then
    if not exists (select 1 from public.representantes where id = rep and ativo) then
      raise exception 'Representante invalido ou inativo';
    end if;
  end if;

  insert into public.pedidos
    (cliente_id, centro_id, rota_id, forma_pagamento_id, representante_id,
     data_pedido, previsao_entrega, observacoes)
  values
    (_cliente_id, _centro_id, _rota_id, _forma_pagamento_id, rep,
     coalesce(_data_pedido,current_date), _previsao_entrega, nullif(_observacoes,''))
  returning * into ped;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values(
    'pedidos',ped.id,'criar',
    jsonb_build_object('numero',ped.numero,'centro_id',ped.centro_id,'cliente_id',ped.cliente_id,
      'rota_id',ped.rota_id,'previsao_entrega',ped.previsao_entrega),
    auth.uid()
  );
  return ped;
end;
$$;

create or replace function public.atualizar_pedido_comercial(
  _pedido_id uuid,
  _forma_pagamento_id uuid,
  _frete_valor numeric default 0,
  _desconto_valor numeric default 0,
  _comissao_percentual numeric default 0
)
returns public.pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  ped public.pedidos;
begin
  if not public.can_operate(auth.uid()) then
    raise exception 'Sem permissao para alterar pedidos';
  end if;
  select * into ped from public.pedidos where id=_pedido_id for update;
  if ped.id is null then raise exception 'Pedido nao encontrado'; end if;
  if ped.centro_id is null or not public.usuario_pode_acessar_centro(ped.centro_id) then
    raise exception 'Pedido pertence a outro centro';
  end if;
  if ped.status not in ('rascunho','digitacao','aguardando_aprovacao','aprovado') then
    raise exception 'Pedido nao pode ser alterado no status atual: %',ped.status;
  end if;
  if _forma_pagamento_id is null
     or not exists (select 1 from public.formas_pagamento where id=_forma_pagamento_id and ativo) then
    raise exception 'Forma de pagamento invalida ou inativa';
  end if;
  if coalesce(_frete_valor,0) < 0 or coalesce(_desconto_valor,0) < 0 then
    raise exception 'Frete e desconto nao podem ser negativos';
  end if;
  if coalesce(_comissao_percentual,0) < 0 or coalesce(_comissao_percentual,0) > 100 then
    raise exception 'Percentual de comissao invalido';
  end if;
  update public.pedidos
  set forma_pagamento_id=_forma_pagamento_id,
      frete_valor=round(coalesce(_frete_valor,0),2),
      desconto_valor=round(coalesce(_desconto_valor,0),2),
      comissao_percentual=round(coalesce(_comissao_percentual,0),4)
  where id=_pedido_id
  returning * into ped;
  perform public.recalcular_pedido(_pedido_id);
  select * into ped from public.pedidos where id=_pedido_id;
  return ped;
end;
$$;

create or replace function public.adicionar_item_pedido(
  _pedido_id uuid,
  _produto_id uuid,
  _quantidade numeric,
  _preco_unitario numeric,
  _desconto_percentual numeric default 0
)
returns public.pedido_itens
language plpgsql
security definer
set search_path = public
as $$
declare ped public.pedidos; it public.pedido_itens;
begin
  if not public.can_operate(auth.uid()) then raise exception 'Sem permissao para alterar itens do pedido'; end if;
  select * into ped from public.pedidos where id=_pedido_id for update;
  if ped.id is null then raise exception 'Pedido nao encontrado'; end if;
  if ped.centro_id is null or not public.usuario_pode_acessar_centro(ped.centro_id) then raise exception 'Pedido pertence a outro centro'; end if;
  if ped.status not in ('rascunho','digitacao','aguardando_aprovacao','aprovado') then raise exception 'Itens nao podem ser alterados no status atual: %',ped.status; end if;
  if not exists (select 1 from public.produtos where id=_produto_id) then raise exception 'Produto nao encontrado'; end if;
  if coalesce(_quantidade,0) <= 0 then raise exception 'Quantidade deve ser maior que zero'; end if;
  if coalesce(_preco_unitario,0) < 0 then raise exception 'Preco invalido'; end if;
  if coalesce(_desconto_percentual,0) < 0 or coalesce(_desconto_percentual,0) > 100 then raise exception 'Desconto invalido'; end if;
  insert into public.pedido_itens(pedido_id,produto_id,quantidade,preco_unitario,desconto_percentual)
  values(_pedido_id,_produto_id,_quantidade,round(_preco_unitario,2),round(coalesce(_desconto_percentual,0),4))
  returning * into it;
  perform public.recalcular_pedido(_pedido_id);
  return it;
end;
$$;

create or replace function public.atualizar_item_pedido(
  _item_id uuid,
  _quantidade numeric,
  _preco_unitario numeric,
  _desconto_percentual numeric default 0
)
returns public.pedido_itens
language plpgsql
security definer
set search_path = public
as $$
declare it public.pedido_itens; ped public.pedidos;
begin
  if not public.can_operate(auth.uid()) then raise exception 'Sem permissao para alterar itens do pedido'; end if;
  select * into it from public.pedido_itens where id=_item_id for update;
  if it.id is null then raise exception 'Item nao encontrado'; end if;
  select * into ped from public.pedidos where id=it.pedido_id for update;
  if ped.centro_id is null or not public.usuario_pode_acessar_centro(ped.centro_id) then raise exception 'Pedido pertence a outro centro'; end if;
  if ped.status not in ('rascunho','digitacao','aguardando_aprovacao','aprovado') then raise exception 'Item nao pode ser alterado no status atual: %',ped.status; end if;
  if coalesce(_quantidade,0) <= 0 then raise exception 'Quantidade deve ser maior que zero'; end if;
  if coalesce(_preco_unitario,0) < 0 then raise exception 'Preco invalido'; end if;
  if coalesce(_desconto_percentual,0) < 0 or coalesce(_desconto_percentual,0) > 100 then raise exception 'Desconto invalido'; end if;
  update public.pedido_itens
  set quantidade=_quantidade, preco_unitario=round(_preco_unitario,2),
      desconto_percentual=round(coalesce(_desconto_percentual,0),4)
  where id=_item_id returning * into it;
  perform public.recalcular_pedido(ped.id);
  return it;
end;
$$;

create or replace function public.remover_item_pedido(_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare it public.pedido_itens; ped public.pedidos;
begin
  if not public.can_operate(auth.uid()) then raise exception 'Sem permissao para alterar itens do pedido'; end if;
  select * into it from public.pedido_itens where id=_item_id for update;
  if it.id is null then raise exception 'Item nao encontrado'; end if;
  select * into ped from public.pedidos where id=it.pedido_id for update;
  if ped.centro_id is null or not public.usuario_pode_acessar_centro(ped.centro_id) then raise exception 'Pedido pertence a outro centro'; end if;
  if ped.status not in ('rascunho','digitacao','aguardando_aprovacao','aprovado') then raise exception 'Item nao pode ser removido no status atual: %',ped.status; end if;
  delete from public.pedido_itens where id=_item_id;
  perform public.recalcular_pedido(ped.id);
end;
$$;

revoke all on table public.pedidos from anon, authenticated;
grant select on public.pedidos to authenticated;
revoke all on table public.pedido_itens from anon, authenticated;
grant select on public.pedido_itens to authenticated;

revoke all on function public.criar_pedido_rascunho(uuid,uuid,uuid,uuid,date,text,uuid) from public;
revoke all on function public.criar_pedido_rascunho(uuid,uuid,uuid,uuid,date,text,uuid,date) from public;
grant execute on function public.criar_pedido_rascunho(uuid,uuid,uuid,uuid,date,text,uuid,date) to authenticated;
revoke all on function public.atualizar_pedido_comercial(uuid,uuid,numeric,numeric,numeric) from public;
grant execute on function public.atualizar_pedido_comercial(uuid,uuid,numeric,numeric,numeric) to authenticated;
revoke all on function public.adicionar_item_pedido(uuid,uuid,numeric,numeric,numeric) from public;
grant execute on function public.adicionar_item_pedido(uuid,uuid,numeric,numeric,numeric) to authenticated;
revoke all on function public.atualizar_item_pedido(uuid,numeric,numeric,numeric) from public;
grant execute on function public.atualizar_item_pedido(uuid,numeric,numeric,numeric) to authenticated;
revoke all on function public.remover_item_pedido(uuid) from public;
grant execute on function public.remover_item_pedido(uuid) to authenticated;
commit;
