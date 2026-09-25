-- Fase 70: fechamento de integridade de compras e financeiro.
-- Corrige interações entre bloqueio de escrita direta, centros e RPCs.
-- Mercado Livre e Shopee não fazem parte deste projeto.

begin;

-- Motor interno: operações de negócio autorizadas podem lançar estoque sem
-- conceder INSERT direto ao usuário autenticado.
create or replace function public.registrar_movimento_estoque_controlado(
  _produto_id uuid,
  _centro_id uuid,
  _tipo text,
  _quantidade numeric,
  _custo_unitario numeric default null,
  _origem text default 'interno',
  _documento_id uuid default null,
  _observacao text default null
) returns public.estoque_movimentos
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.estoque_movimentos;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;
  if _produto_id is null or _centro_id is null then
    raise exception 'Produto e centro são obrigatórios';
  end if;
  if not public.usuario_pode_acessar_centro(_centro_id) then
    raise exception 'Usuário sem acesso ao centro informado';
  end if;
  if _tipo not in ('entrada','saida','ajuste') then
    raise exception 'Tipo de movimento inválido';
  end if;
  if coalesce(_quantidade,0) = 0 then
    raise exception 'Quantidade inválida';
  end if;

  insert into public.estoque_movimentos
    (produto_id, centro_id, tipo, quantidade, custo_unitario, origem,
     documento_id, observacao, created_by)
  values
    (_produto_id, _centro_id, _tipo, _quantidade, _custo_unitario,
     coalesce(_origem,'interno'), _documento_id, _observacao, auth.uid())
  returning * into m;

  return m;
end;
$$;

revoke all on function public.registrar_movimento_estoque_controlado(
  uuid,uuid,text,numeric,numeric,text,uuid,text
) from public;
grant execute on function public.registrar_movimento_estoque_controlado(
  uuid,uuid,text,numeric,numeric,text,uuid,text
) to authenticated;

-- Recebimento de compra: aceita rascunho e comprado, e é idempotente pelo
-- status da compra. O centro é propagado explicitamente aos títulos.
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
    raise exception 'Sem permissão para receber compras';
  end if;

  select * into cmp from public.compras where id=_compra_id for update;
  if cmp.id is null then raise exception 'Compra não encontrada'; end if;
  if cmp.centro_id is null then raise exception 'Centro da compra obrigatório'; end if;
  if not public.usuario_pode_acessar_centro(cmp.centro_id) then
    raise exception 'Compra pertence a outro centro';
  end if;

  if cmp.status = 'recebida' then
    return cmp;
  end if;
  if cmp.status not in ('rascunho','comprado') then
    raise exception 'Compra não pode ser recebida no status atual';
  end if;
  if not exists(select 1 from public.compra_itens where compra_id=_compra_id) then
    raise exception 'Inclua ao menos um item na compra';
  end if;

  perform public.recalcular_compra(_compra_id);
  select * into cmp from public.compras where id=_compra_id for update;

  for item in
    select produto_id,
           sum(quantidade) as qtd,
           case when sum(quantidade)>0
                then sum(quantidade*custo_unitario)/sum(quantidade)
                else 0 end as custo
      from public.compra_itens
     where compra_id=_compra_id
     group by produto_id
  loop
    perform public.registrar_movimento_estoque_controlado(
      item.produto_id, cmp.centro_id, 'entrada', item.qtd, item.custo,
      'compra', _compra_id, 'Entrada por NF de compra'
    );
  end loop;

  valor_parcela := round(cmp.total_liquido/greatest(coalesce(cmp.parcelas,1),1),2);
  saldo := cmp.total_liquido;

  for n in 1..greatest(coalesce(cmp.parcelas,1),1) loop
    if n = greatest(coalesce(cmp.parcelas,1),1) then
      valor_parcela := saldo;
    end if;

    insert into public.contas_pagar
      (fornecedor_id, compra_id, documento, parcela, valor, vencimento,
       centro_id, data_emissao, status)
    values
      (cmp.fornecedor_id, cmp.id,
       coalesce(nullif(cmp.nf_numero,''),'CMP-'||cmp.numero),
       n, valor_parcela,
       cmp.data_entrada + ((n-1)*30),
       cmp.centro_id, current_date, 'aberto');

    saldo := saldo - valor_parcela;
  end loop;

  update public.compras
     set status='recebida'
   where id=_compra_id
   returning * into cmp;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('compras',_compra_id,'receber',
         jsonb_build_object('total',cmp.total_liquido,'centro_id',cmp.centro_id),
         auth.uid());

  return cmp;
end;
$$;

-- Confirmação do pedido: usa o motor controlado, grava centro nos títulos e
-- permanece idempotente sob concorrência pelo FOR UPDATE/status.
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
  parcelas int;
  valor_parcela numeric(14,2);
  saldo numeric(14,2);
begin
  if not public.can_operate(auth.uid()) then
    raise exception 'Sem permissão para confirmar pedidos';
  end if;

  select * into ped from public.pedidos where id=_pedido_id for update;
  if ped.id is null then raise exception 'Pedido não encontrado'; end if;
  if ped.centro_id is null then raise exception 'Centro do pedido obrigatório'; end if;
  if not public.usuario_pode_acessar_centro(ped.centro_id) then
    raise exception 'Pedido pertence a outro centro';
  end if;

  if ped.status='confirmado' then
    return ped;
  end if;
  if ped.status<>'rascunho' then
    raise exception 'Pedido não está em rascunho';
  end if;
  if not exists(select 1 from public.pedido_itens where pedido_id=_pedido_id) then
    raise exception 'Inclua ao menos um item no pedido';
  end if;

  perform public.recalcular_pedido(_pedido_id);
  select * into ped from public.pedidos where id=_pedido_id for update;

  for item in
    select produto_id,sum(quantidade) qtd
      from public.pedido_itens
     where pedido_id=_pedido_id
     group by produto_id
  loop
    perform public.registrar_movimento_estoque_controlado(
      item.produto_id, ped.centro_id, 'saida', item.qtd, null,
      'pedido', _pedido_id, 'Baixa por confirmação de pedido'
    );
  end loop;

  parcelas := greatest(coalesce(ped.parcelas,1),1);
  valor_parcela := round(ped.total_liquido/parcelas,2);
  saldo := ped.total_liquido;

  for n in 1..parcelas loop
    if n=parcelas then valor_parcela:=saldo; end if;

    insert into public.contas_receber
      (cliente_id,pedido_id,documento,parcela,valor,vencimento,
       centro_id,data_emissao,status)
    values
      (ped.cliente_id,ped.id,'PED-'||ped.numero,n,valor_parcela,
       ped.data_pedido+((n-1)*30),ped.centro_id,current_date,'aberto');

    saldo:=saldo-valor_parcela;
  end loop;

  if ped.representante_id is not null and ped.comissao_valor>0 then
    insert into public.comissoes
      (representante_id,pedido_id,base_calculo,percentual,valor)
    values
      (ped.representante_id,ped.id,ped.total_itens,
       ped.comissao_percentual,ped.comissao_valor);
  end if;

  update public.pedidos
     set status='confirmado'
   where id=_pedido_id
   returning * into ped;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('pedidos',_pedido_id,'confirmar',
         jsonb_build_object('total',ped.total_liquido,'parcelas',ped.parcelas),
         auth.uid());

  return ped;
end;
$$;

-- As baixas financeiras devem validar o centro antes de gerar movimento.
create or replace function public.receber_titulo(
  _id uuid, _valor numeric, _data date default current_date,
  _conta_id uuid default null, _forma_id uuid default null,
  _juros numeric default 0, _multa numeric default 0,
  _desconto numeric default 0, _observacao text default null
) returns public.contas_receber
language plpgsql security definer set search_path=public
as $$
declare
  titulo public.contas_receber;
  pago numeric(14,2);
  devido numeric(14,2);
  conta uuid;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Somente financeiro/gestor pode receber títulos';
  end if;
  if coalesce(_valor,0)<=0 then raise exception 'Informe um valor maior que zero'; end if;

  select * into titulo from public.contas_receber where id=_id for update;
  if titulo.id is null then raise exception 'Título não encontrado'; end if;
  if titulo.centro_id is null then raise exception 'Título sem centro'; end if;
  if not public.usuario_pode_acessar_centro(titulo.centro_id) then
    raise exception 'Título pertence a outro centro';
  end if;
  if titulo.status='cancelado' or titulo.status='pago' then
    raise exception 'Título não pode ser baixado no status atual';
  end if;

  conta := coalesce(_conta_id,titulo.conta_financeira_id,
    (select id from public.contas_financeiras where ativo order by created_at limit 1));
  if conta is null then raise exception 'Cadastre uma conta de banco/caixa antes de receber'; end if;

  if _juros < 0 or _multa < 0 or _desconto < 0 then
    raise exception 'Juros, multa e desconto não podem ser negativos';
  end if;

  update public.contas_receber
     set juros=juros+coalesce(_juros,0),
         multa=multa+coalesce(_multa,0),
         desconto=desconto+coalesce(_desconto,0)
   where id=_id
   returning * into titulo;

  devido:=titulo.valor+titulo.juros+titulo.multa+titulo.acrescimo-titulo.desconto;
  if _valor > greatest(devido-coalesce(titulo.valor_pago,0),0) then
    raise exception 'Valor da baixa excede o saldo do título';
  end if;

  pago:=coalesce(titulo.valor_pago,0)+_valor;

  update public.contas_receber
     set valor_pago=pago,
         conta_financeira_id=conta,
         forma_pagamento_id=coalesce(_forma_id,forma_pagamento_id),
         data_pagamento=case when pago>=devido then coalesce(_data,current_date) else data_pagamento end,
         status=case when pago>=devido then 'pago' when pago>0 then 'parcial' else 'aberto' end,
         observacao=coalesce(nullif(_observacao,''),observacao)
   where id=_id
   returning * into titulo;

  insert into public.movimentos_financeiros
    (conta_id,data,tipo,origem,valor,centro_id,forma_pagamento_id,
     conta_receber_id,categoria_id,descricao,documento,created_by)
  values
    (conta,coalesce(_data,current_date),'entrada','recebimento',_valor,
     titulo.centro_id,coalesce(_forma_id,titulo.forma_pagamento_id),titulo.id,
     coalesce(titulo.categoria_id,
       (select id from public.categorias_financeiras
        where tipo='receita' and grupo_dre='receita_bruta' and parent_id is null
        order by ordem limit 1)),
     'Recebimento '||coalesce(titulo.documento,'titulo')||
       ' parcela '||coalesce(titulo.parcela,1)::text,titulo.documento,auth.uid());

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('contas_receber',_id,'baixa',
         jsonb_build_object('valor',_valor,'pago_depois',pago),auth.uid());

  return titulo;
end;
$$;

create or replace function public.pagar_titulo(
  _id uuid, _valor numeric, _data date default current_date,
  _conta_id uuid default null, _forma_id uuid default null,
  _juros numeric default 0, _multa numeric default 0,
  _desconto numeric default 0, _observacao text default null
) returns public.contas_pagar
language plpgsql security definer set search_path=public
as $$
declare
  titulo public.contas_pagar;
  pago numeric(14,2);
  devido numeric(14,2);
  conta uuid;
  conta_centro uuid;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Somente financeiro/gestor pode pagar títulos';
  end if;
  if coalesce(_valor,0)<=0 then raise exception 'Informe um valor maior que zero'; end if;

  select * into titulo from public.contas_pagar where id=_id for update;
  if titulo.id is null then raise exception 'Título não encontrado'; end if;
  if titulo.centro_id is null then raise exception 'Título sem centro'; end if;
  if not public.usuario_pode_acessar_centro(titulo.centro_id) then
    raise exception 'Título pertence a outro centro';
  end if;
  if titulo.status='cancelado' or titulo.status='pago' then
    raise exception 'Título não pode ser baixado no status atual';
  end if;

  conta:=coalesce(_conta_id,titulo.conta_financeira_id,
    (select id from public.contas_financeiras where ativo and (centro_id is null or centro_id=titulo.centro_id) order by created_at limit 1));
  if conta is null then raise exception 'Cadastre uma conta de banco/caixa para o centro antes de pagar'; end if;
  select centro_id into conta_centro from public.contas_financeiras where id=conta and ativo;
  if not found then raise exception 'Conta financeira nao encontrada ou inativa'; end if;
  if conta_centro is not null and conta_centro<>titulo.centro_id then raise exception 'Conta pertence a outro centro'; end if;

  if _juros<0 or _multa<0 or _desconto<0 then
    raise exception 'Juros, multa e desconto não podem ser negativos';
  end if;

  update public.contas_pagar
     set juros=juros+coalesce(_juros,0),
         multa=multa+coalesce(_multa,0),
         desconto=desconto+coalesce(_desconto,0)
   where id=_id
   returning * into titulo;

  devido:=titulo.valor+titulo.juros+titulo.multa+titulo.acrescimo-titulo.desconto;
  if _valor > greatest(devido-coalesce(titulo.valor_pago,0),0) then
    raise exception 'Valor da baixa excede o saldo do título';
  end if;

  pago:=coalesce(titulo.valor_pago,0)+_valor;

  update public.contas_pagar
     set valor_pago=pago,
         conta_financeira_id=conta,
         forma_pagamento_id=coalesce(_forma_id,forma_pagamento_id),
         data_pagamento=case when pago>=devido then coalesce(_data,current_date) else data_pagamento end,
         status=case when pago>=devido then 'pago' when pago>0 then 'parcial' else 'aberto' end,
         observacao=coalesce(nullif(_observacao,''),observacao)
   where id=_id
   returning * into titulo;

  insert into public.movimentos_financeiros
    (conta_id,data,tipo,origem,valor,centro_id,forma_pagamento_id,
     conta_pagar_id,categoria_id,descricao,documento,created_by)
  values
    (conta,coalesce(_data,current_date),'saida','pagamento',_valor,
     titulo.centro_id,coalesce(_forma_id,titulo.forma_pagamento_id),titulo.id,
     titulo.categoria_id,
     'Pagamento '||coalesce(titulo.documento,'titulo')||
       ' parcela '||coalesce(titulo.parcela,1)::text,titulo.documento,auth.uid());

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('contas_pagar',_id,'baixa',
         jsonb_build_object('valor',_valor,'pago_depois',pago),auth.uid());

  return titulo;
end;
$$;

-- Criação manual de títulos: centro obrigatório e acessível.
create or replace function public.criar_despesa(
  _fornecedor_id uuid,_categoria_id uuid,_centro_id uuid,_descricao text,
  _documento text,_valor numeric,_parcelas integer default 1,
  _primeiro_vencimento date default current_date,_intervalo_dias integer default 30,
  _forma_id uuid default null,_conta_id uuid default null
) returns integer
language plpgsql security definer set search_path=public
as $$
declare n integer; parcelas integer; valor_parcela numeric(14,2); saldo numeric(14,2);
begin
  if not public.can_finance(auth.uid()) then raise exception 'Sem permissão para lançar despesas'; end if;
  if _centro_id is null or not public.usuario_pode_acessar_centro(_centro_id) then
    raise exception 'Centro inválido ou sem acesso';
  end if;
  if coalesce(_valor,0)<=0 then raise exception 'Informe o valor da despesa'; end if;

  parcelas:=greatest(coalesce(_parcelas,1),1);
  valor_parcela:=round(_valor/parcelas,2);
  saldo:=_valor;

  for n in 1..parcelas loop
    if n=parcelas then valor_parcela:=saldo; end if;
    insert into public.contas_pagar
      (fornecedor_id,documento,parcela,valor,vencimento,data_emissao,status,
       centro_id,categoria_id,forma_pagamento_id,conta_financeira_id,descricao,observacao)
    values
      (_fornecedor_id,nullif(_documento,''),n,valor_parcela,
       coalesce(_primeiro_vencimento,current_date)+((n-1)*coalesce(_intervalo_dias,30)),
       current_date,'aberto',_centro_id,_categoria_id,_forma_id,_conta_id,
       nullif(_descricao,''),nullif(_descricao,''));
    saldo:=saldo-valor_parcela;
  end loop;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('contas_pagar',null,'despesa',
         jsonb_build_object('valor',_valor,'parcelas',parcelas,'centro_id',_centro_id),
         auth.uid());

  return parcelas;
end;
$$;

-- Cancelamento de títulos: não permite cancelar título pago e exige centro.
create or replace function public.cancelar_titulo(
  _tabela text,_id uuid,_motivo text default null
) returns void
language plpgsql security definer set search_path=public
as $$
declare v_centro uuid; v_status text;
begin
  if not public.can_finance(auth.uid()) then raise exception 'Sem permissão para cancelar títulos'; end if;

  if _tabela='contas_receber' then
    select centro_id,status into v_centro,v_status from public.contas_receber where id=_id for update;
  elsif _tabela='contas_pagar' then
    select centro_id,status into v_centro,v_status from public.contas_pagar where id=_id for update;
  else
    raise exception 'Tabela inválida';
  end if;

  if v_centro is null or not public.usuario_pode_acessar_centro(v_centro) then
    raise exception 'Título pertence a outro centro ou não possui centro';
  end if;
  if v_status is null then raise exception 'Título não encontrado'; end if;
  if v_status='pago' then raise exception 'Título pago não pode ser cancelado; faça estorno';
  end if;
  if v_status='cancelado' then return; end if;

  if _tabela='contas_receber' then
    update public.contas_receber set status='cancelado',
      observacao=coalesce(nullif(_motivo,''),observacao) where id=_id;
  else
    update public.contas_pagar set status='cancelado',
      observacao=coalesce(nullif(_motivo,''),observacao) where id=_id;
  end if;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values(_tabela,_id,'cancelar',
         jsonb_build_object('motivo',_motivo,'status_anterior',v_status),auth.uid());
end;
$$;

grant execute on function public.receber_compra(uuid) to authenticated;
grant execute on function public.confirmar_pedido(uuid) to authenticated;
grant execute on function public.receber_titulo(uuid,numeric,date,uuid,uuid,numeric,numeric,numeric,text) to authenticated;
grant execute on function public.pagar_titulo(uuid,numeric,date,uuid,uuid,numeric,numeric,numeric,text) to authenticated;
grant execute on function public.criar_despesa(uuid,uuid,uuid,text,text,numeric,integer,date,integer,uuid,uuid) to authenticated;
grant execute on function public.cancelar_titulo(text,uuid,text) to authenticated;

commit;
