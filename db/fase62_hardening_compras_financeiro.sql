-- Fase 62: hardening de compras e baixas financeiras.
-- Nao inclui Mercado Livre/Shopee.

-- Preflight de duplicidades historicas antes das restricoes.
do $
declare v_count bigint;
begin
  select count(*) into v_count from (
    select compra_id, parcela
    from public.contas_pagar
    where compra_id is not null
    group by compra_id, parcela
    having count(*) > 1
  ) x;
  if v_count > 0 then
    raise exception 'Existem % parcelas de contas a pagar duplicadas por compra. Corrija antes da restricao.',v_count;
  end if;

  select count(*) into v_count from (
    select pedido_id, parcela
    from public.contas_receber
    where pedido_id is not null
    group by pedido_id, parcela
    having count(*) > 1
  ) x;
  if v_count > 0 then
    raise exception 'Existem % parcelas de contas a receber duplicadas por pedido. Corrija antes da restricao.',v_count;
  end if;
end $;

create unique index if not exists contas_pagar_compra_parcela_uq
  on public.contas_pagar(compra_id, parcela)
  where compra_id is not null;

create unique index if not exists contas_receber_pedido_parcela_uq
  on public.contas_receber(pedido_id, parcela)
  where pedido_id is not null;

create or replace function public.receber_compra(_compra_id uuid)
returns public.compras
language plpgsql
security definer
set search_path = public
as $$
declare
  cmp public.compras;
  item record;
  n int;
  valor_parcela numeric(14,2);
  saldo numeric(14,2);
begin
  if not public.can_stock(auth.uid()) and not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para receber compras';
  end if;

  select * into cmp from public.compras where id=_compra_id for update;
  if cmp.id is null then raise exception 'Compra nao encontrada'; end if;
  if cmp.centro_id is null then raise exception 'Centro da compra obrigatorio'; end if;
  if not public.usuario_pode_acessar_centro(cmp.centro_id) then
    raise exception 'Compra pertence a outro centro';
  end if;
  if cmp.status <> 'rascunho' then raise exception 'Compra ja processada'; end if;
  if not exists(select 1 from public.compra_itens where compra_id=_compra_id) then
    raise exception 'Inclua ao menos um item na compra';
  end if;

  perform public.recalcular_compra(_compra_id);
  select * into cmp from public.compras where id=_compra_id for update;

  for item in
    select produto_id,sum(quantidade) as qtd,
           case when sum(quantidade)>0
                then sum(quantidade*custo_unitario)/sum(quantidade) else 0 end as custo
    from public.compra_itens where compra_id=_compra_id group by produto_id
  loop
    insert into public.estoque_movimentos
      (produto_id,centro_id,tipo,quantidade,custo_unitario,origem,documento_id,observacao,created_by)
    values(item.produto_id,cmp.centro_id,'entrada',item.qtd,item.custo,'compra',_compra_id,
           'Entrada por NF de compra',auth.uid());
  end loop;

  valor_parcela:=round(cmp.total_liquido/greatest(cmp.parcelas,1),2);
  saldo:=cmp.total_liquido;
  for n in 1..greatest(cmp.parcelas,1) loop
    if n=cmp.parcelas then valor_parcela:=saldo; end if;
    insert into public.contas_pagar
      (fornecedor_id,compra_id,documento,parcela,valor,vencimento)
    values(cmp.fornecedor_id,cmp.id,
           coalesce(nullif(cmp.nf_numero,''),'CMP-'||cmp.numero),n,valor_parcela,
           cmp.data_entrada+(n*30));
    saldo:=saldo-valor_parcela;
  end loop;

  update public.compras set status='recebida' where id=_compra_id returning * into cmp;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('compras',_compra_id,'receber',
         jsonb_build_object('total',cmp.total_liquido,'centro_id',cmp.centro_id),auth.uid());
  return cmp;
end;
$$;

create or replace function public.confirmar_pedido(_pedido_id uuid)
returns public.pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  ped public.pedidos;
  item record;
  n int;
  valor_parcela numeric(14,2);
  saldo numeric(14,2);
begin
  if not public.can_operate(auth.uid()) then raise exception 'Sem permissao para confirmar pedidos'; end if;
  select * into ped from public.pedidos where id=_pedido_id for update;
  if ped.id is null then raise exception 'Pedido nao encontrado'; end if;
  if ped.centro_id is null then raise exception 'Centro do pedido obrigatorio'; end if;
  if not public.usuario_pode_acessar_centro(ped.centro_id) then raise exception 'Pedido pertence a outro centro'; end if;
  if ped.status<>'rascunho' then raise exception 'Pedido ja foi confirmado ou cancelado'; end if;
  if not exists(select 1 from public.pedido_itens where pedido_id=_pedido_id) then raise exception 'Inclua ao menos um item no pedido'; end if;

  perform public.recalcular_pedido(_pedido_id);
  select * into ped from public.pedidos where id=_pedido_id for update;

  for item in select produto_id,sum(quantidade) qtd from public.pedido_itens where pedido_id=_pedido_id group by produto_id loop
    insert into public.estoque_movimentos(produto_id,centro_id,tipo,quantidade,origem,documento_id,observacao,created_by)
    values(item.produto_id,ped.centro_id,'saida',item.qtd,'pedido',_pedido_id,'Baixa por confirmacao de pedido',auth.uid());
  end loop;

  valor_parcela:=round(ped.total_liquido/greatest(ped.parcelas,1),2);
  saldo:=ped.total_liquido;
  for n in 1..greatest(ped.parcelas,1) loop
    if n=ped.parcelas then valor_parcela:=saldo; end if;
    insert into public.contas_receber(cliente_id,pedido_id,documento,parcela,valor,vencimento)
    values(ped.cliente_id,ped.id,'PED-'||ped.numero,n,valor_parcela,ped.data_pedido+(n*30));
    saldo:=saldo-valor_parcela;
  end loop;

  if ped.representante_id is not null and ped.comissao_valor>0 then
    insert into public.comissoes(representante_id,pedido_id,base_calculo,percentual,valor)
    values(ped.representante_id,ped.id,ped.total_itens,ped.comissao_percentual,ped.comissao_valor);
  end if;

  update public.pedidos set status='confirmado' where id=_pedido_id returning * into ped;
  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('pedidos',_pedido_id,'confirmar',jsonb_build_object('total',ped.total_liquido,'parcelas',ped.parcelas),auth.uid());
  return ped;
end;
$$;

create or replace function public.baixar_receber(_id uuid,_valor numeric,_data date default current_date)
returns public.contas_receber
language plpgsql
security definer
set search_path=public
as $$
declare titulo public.contas_receber; novo_pago numeric(14,2);
begin
  if not public.can_finance(auth.uid()) then raise exception 'Somente financeiro/gestor pode baixar titulos'; end if;
  if _valor is null or _valor<=0 then raise exception 'Valor da baixa deve ser maior que zero'; end if;

  select * into titulo from public.contas_receber where id=_id for update;
  if titulo.id is null then raise exception 'Titulo nao encontrado'; end if;
  if titulo.status='cancelado' then raise exception 'Titulo cancelado nao pode ser baixado'; end if;
  if titulo.status='pago' then raise exception 'Titulo ja esta pago'; end if;
  if titulo.pedido_id is not null and exists(select 1 from public.pedidos p where p.id=titulo.pedido_id)
     and not public.usuario_pode_acessar_centro((select p.centro_id from public.pedidos p where p.id=titulo.pedido_id))
  then raise exception 'Titulo pertence a outro centro'; end if;

  if _valor > greatest(titulo.valor-coalesce(titulo.valor_pago,0),0) then
    raise exception 'Valor da baixa excede o saldo do titulo';
  end if;

  novo_pago:=coalesce(titulo.valor_pago,0)+_valor;
  update public.contas_receber
  set valor_pago=novo_pago,
      data_pagamento=case when novo_pago>=titulo.valor then _data else data_pagamento end,
      status=case when novo_pago>=titulo.valor then 'pago' else 'parcial' end
  where id=_id returning * into titulo;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('contas_receber',_id,'baixa',jsonb_build_object('valor',_valor,'saldo_anterior',titulo.valor_pago-_valor),auth.uid());
  return titulo;
end;
$$;

create or replace function public.baixar_pagar(_id uuid,_valor numeric,_data date default current_date)
returns public.contas_pagar
language plpgsql
security definer
set search_path=public
as $$
declare titulo public.contas_pagar; novo_pago numeric(14,2);
begin
  if not public.can_finance(auth.uid()) then raise exception 'Somente financeiro/gestor pode baixar titulos'; end if;
  if _valor is null or _valor<=0 then raise exception 'Valor da baixa deve ser maior que zero'; end if;

  select * into titulo from public.contas_pagar where id=_id for update;
  if titulo.id is null then raise exception 'Titulo nao encontrado'; end if;
  if titulo.status='cancelado' then raise exception 'Titulo cancelado nao pode ser baixado'; end if;
  if titulo.status='pago' then raise exception 'Titulo ja esta pago'; end if;
  if titulo.compra_id is not null and exists(select 1 from public.compras c where c.id=titulo.compra_id)
     and not public.usuario_pode_acessar_centro((select c.centro_id from public.compras c where c.id=titulo.compra_id))
  then raise exception 'Titulo pertence a outro centro'; end if;

  if _valor > greatest(titulo.valor-coalesce(titulo.valor_pago,0),0) then
    raise exception 'Valor da baixa excede o saldo do titulo';
  end if;

  novo_pago:=coalesce(titulo.valor_pago,0)+_valor;
  update public.contas_pagar
  set valor_pago=novo_pago,
      data_pagamento=case when novo_pago>=titulo.valor then _data else data_pagamento end,
      status=case when novo_pago>=titulo.valor then 'pago' else 'parcial' end
  where id=_id returning * into titulo;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('contas_pagar',_id,'baixa',jsonb_build_object('valor',_valor,'saldo_anterior',titulo.valor_pago-_valor),auth.uid());
  return titulo;
end;
$$;

grant execute on function public.receber_compra(uuid) to authenticated;
grant execute on function public.confirmar_pedido(uuid) to authenticated;
grant execute on function public.baixar_receber(uuid,numeric,date) to authenticated;
grant execute on function public.baixar_pagar(uuid,numeric,date) to authenticated;
