-- Fase 109: CRUD controlado de compras e itens.
-- Remove escrita direta do navegador e centraliza validacoes de permissao, centro e status.
begin;

create or replace function public.criar_compra_rascunho(
  _fornecedor_id uuid,
  _centro_id uuid,
  _data_entrada date default current_date,
  _observacoes text default null,
  _nf_numero text default null,
  _chave_acesso text default null,
  _valor_impostos numeric default 0
)
returns public.compras
language plpgsql
security definer
set search_path = public
as $$
declare
  cmp public.compras;
begin
  if not public.can_stock(auth.uid()) and not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para criar compras';
  end if;
  if _fornecedor_id is null or not exists (
    select 1 from public.fornecedores f where f.id = _fornecedor_id
  ) then
    raise exception 'Fornecedor invalido';
  end if;
  if _centro_id is null or not public.usuario_pode_acessar_centro(_centro_id) then
    raise exception 'Centro invalido ou sem acesso';
  end if;
  if coalesce(_valor_impostos,0) < 0 then
    raise exception 'Valor de impostos nao pode ser negativo';
  end if;

  insert into public.compras(
    fornecedor_id, centro_id, data_entrada, observacoes,
    nf_numero, chave_acesso, valor_impostos, status
  )
  values(
    _fornecedor_id, _centro_id, coalesce(_data_entrada,current_date),
    nullif(_observacoes,''), nullif(_nf_numero,''), nullif(_chave_acesso,''),
    round(coalesce(_valor_impostos,0),2), 'rascunho'
  )
  returning * into cmp;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values(
    'compras',cmp.id,'criar',
    jsonb_build_object('numero',cmp.numero,'centro_id',cmp.centro_id,'fornecedor_id',cmp.fornecedor_id),
    auth.uid()
  );

  return cmp;
end;
$$;

create or replace function public.atualizar_compra_comercial(
  _compra_id uuid,
  _forma_pagamento_id uuid default null,
  _frete_valor numeric default 0,
  _desconto_valor numeric default 0
)
returns public.compras
language plpgsql
security definer
set search_path = public
as $$
declare
  cmp public.compras;
begin
  if not public.can_stock(auth.uid()) and not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para alterar compras';
  end if;

  select * into cmp from public.compras where id=_compra_id for update;
  if cmp.id is null then raise exception 'Compra nao encontrada'; end if;
  if cmp.centro_id is null or not public.usuario_pode_acessar_centro(cmp.centro_id) then
    raise exception 'Compra pertence a outro centro';
  end if;
  if cmp.status <> 'rascunho' then
    raise exception 'Compra nao pode ser alterada no status atual: %', cmp.status;
  end if;
  if _forma_pagamento_id is not null and not exists (
    select 1 from public.formas_pagamento fp
    where fp.id=_forma_pagamento_id and fp.ativo
  ) then
    raise exception 'Forma de pagamento invalida ou inativa';
  end if;
  if coalesce(_frete_valor,0) < 0 or coalesce(_desconto_valor,0) < 0 then
    raise exception 'Frete e desconto nao podem ser negativos';
  end if;

  update public.compras
  set forma_pagamento_id=_forma_pagamento_id,
      frete_valor=round(coalesce(_frete_valor,0),2),
      desconto_valor=round(coalesce(_desconto_valor,0),2)
  where id=_compra_id
  returning * into cmp;

  perform public.recalcular_compra(_compra_id);
  select * into cmp from public.compras where id=_compra_id;
  return cmp;
end;
$$;

create or replace function public.adicionar_item_compra(
  _compra_id uuid,
  _produto_id uuid,
  _quantidade numeric,
  _custo_unitario numeric,
  _lote text default null,
  _validade date default null
)
returns public.compra_itens
language plpgsql
security definer
set search_path = public
as $$
declare
  cmp public.compras;
  it public.compra_itens;
begin
  if not public.can_stock(auth.uid()) and not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para alterar itens da compra';
  end if;

  select * into cmp from public.compras where id=_compra_id for update;
  if cmp.id is null then raise exception 'Compra nao encontrada'; end if;
  if cmp.centro_id is null or not public.usuario_pode_acessar_centro(cmp.centro_id) then
    raise exception 'Compra pertence a outro centro';
  end if;
  if cmp.status <> 'rascunho' then
    raise exception 'Itens nao podem ser alterados no status atual: %', cmp.status;
  end if;
  if not exists (select 1 from public.produtos p where p.id=_produto_id) then
    raise exception 'Produto nao encontrado';
  end if;
  if coalesce(_quantidade,0) <= 0 then raise exception 'Quantidade deve ser maior que zero'; end if;
  if coalesce(_custo_unitario,0) < 0 then raise exception 'Custo unitario invalido'; end if;

  insert into public.compra_itens(compra_id,produto_id,quantidade,custo_unitario,lote,validade)
  values(
    _compra_id,_produto_id,_quantidade,round(_custo_unitario,4),
    nullif(_lote,''),_validade
  )
  returning * into it;

  perform public.recalcular_compra(_compra_id);
  return it;
end;
$$;

create or replace function public.atualizar_item_compra(
  _item_id uuid,
  _quantidade numeric,
  _custo_unitario numeric
)
returns public.compra_itens
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.compra_itens;
  cmp public.compras;
begin
  if not public.can_stock(auth.uid()) and not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para alterar itens da compra';
  end if;

  select * into it from public.compra_itens where id=_item_id for update;
  if it.id is null then raise exception 'Item nao encontrado'; end if;
  select * into cmp from public.compras where id=it.compra_id for update;
  if cmp.id is null then raise exception 'Compra nao encontrada'; end if;
  if cmp.centro_id is null or not public.usuario_pode_acessar_centro(cmp.centro_id) then
    raise exception 'Compra pertence a outro centro';
  end if;
  if cmp.status <> 'rascunho' then
    raise exception 'Item nao pode ser alterado no status atual: %', cmp.status;
  end if;
  if coalesce(_quantidade,0) <= 0 then raise exception 'Quantidade deve ser maior que zero'; end if;
  if coalesce(_custo_unitario,0) < 0 then raise exception 'Custo unitario invalido'; end if;

  update public.compra_itens
  set quantidade=_quantidade,
      custo_unitario=round(_custo_unitario,4)
  where id=_item_id
  returning * into it;

  perform public.recalcular_compra(cmp.id);
  return it;
end;
$$;

create or replace function public.remover_item_compra(_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.compra_itens;
  cmp public.compras;
begin
  if not public.can_stock(auth.uid()) and not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para alterar itens da compra';
  end if;

  select * into it from public.compra_itens where id=_item_id for update;
  if it.id is null then raise exception 'Item nao encontrado'; end if;
  select * into cmp from public.compras where id=it.compra_id for update;
  if cmp.id is null then raise exception 'Compra nao encontrada'; end if;
  if cmp.centro_id is null or not public.usuario_pode_acessar_centro(cmp.centro_id) then
    raise exception 'Compra pertence a outro centro';
  end if;
  if cmp.status <> 'rascunho' then
    raise exception 'Item nao pode ser removido no status atual: %', cmp.status;
  end if;

  delete from public.compra_itens where id=_item_id;
  perform public.recalcular_compra(cmp.id);
end;
$$;

create or replace function public.cancelar_compra(_compra_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cmp public.compras;
begin
  if not public.can_stock(auth.uid()) and not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para cancelar compras';
  end if;

  select * into cmp from public.compras where id=_compra_id for update;
  if cmp.id is null then raise exception 'Compra nao encontrada'; end if;
  if cmp.centro_id is null or not public.usuario_pode_acessar_centro(cmp.centro_id) then
    raise exception 'Compra pertence a outro centro';
  end if;
  if cmp.status='cancelada' then return; end if;
  if cmp.status not in ('rascunho','comprado') then
    raise exception 'Compra no status % nao pode ser cancelada', cmp.status;
  end if;
  if exists (
    select 1 from public.contas_pagar cp
    where cp.compra_id=_compra_id and cp.status <> 'cancelado'
  ) then
    raise exception 'Compra possui titulos financeiros ativos e nao pode ser cancelada por este fluxo';
  end if;

  update public.compras set status='cancelada' where id=_compra_id;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values(
    'compras',_compra_id,'cancelar',
    jsonb_build_object('status_anterior',cmp.status),
    auth.uid()
  );
end;
$$;

revoke insert, update, delete on public.compras from anon, authenticated;
revoke insert, update, delete on public.compra_itens from anon, authenticated;
grant select on public.compras to authenticated;
grant select on public.compra_itens to authenticated;

revoke all on function public.criar_compra_rascunho(uuid,uuid,date,text,text,text,numeric) from public, anon;
revoke all on function public.atualizar_compra_comercial(uuid,uuid,numeric,numeric) from public, anon;
revoke all on function public.adicionar_item_compra(uuid,uuid,numeric,numeric,text,date) from public, anon;
revoke all on function public.atualizar_item_compra(uuid,numeric,numeric) from public, anon;
revoke all on function public.remover_item_compra(uuid) from public, anon;
revoke all on function public.cancelar_compra(uuid) from public, anon;

grant execute on function public.criar_compra_rascunho(uuid,uuid,date,text,text,text,numeric) to authenticated, service_role;
grant execute on function public.atualizar_compra_comercial(uuid,uuid,numeric,numeric) to authenticated, service_role;
grant execute on function public.adicionar_item_compra(uuid,uuid,numeric,numeric,text,date) to authenticated, service_role;
grant execute on function public.atualizar_item_compra(uuid,numeric,numeric) to authenticated, service_role;
grant execute on function public.remover_item_compra(uuid) to authenticated, service_role;
grant execute on function public.cancelar_compra(uuid) to authenticated, service_role;

commit;
