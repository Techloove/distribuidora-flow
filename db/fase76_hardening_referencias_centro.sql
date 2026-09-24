-- Fase 76: fechamento de referências de centro em operações financeiras.
-- Impede que títulos/despesas/comissões recebam contas de outro centro.

begin;

create or replace function public.criar_despesa(
  _fornecedor_id uuid,
  _categoria_id uuid,
  _centro_id uuid,
  _descricao text,
  _documento text,
  _valor numeric,
  _parcelas integer default 1,
  _primeiro_vencimento date default current_date,
  _intervalo_dias integer default 30,
  _forma_id uuid default null,
  _conta_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  parcelas integer;
  valor_parcela numeric(14,2);
  saldo numeric(14,2);
  conta_centro uuid;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissão para lançar despesas';
  end if;

  if _centro_id is null or not public.usuario_pode_acessar_centro(_centro_id) then
    raise exception 'Centro inválido ou sem acesso';
  end if;

  if coalesce(_valor,0) <= 0 then
    raise exception 'Informe o valor da despesa';
  end if;

  if _conta_id is not null then
    select centro_id into conta_centro
      from public.contas_financeiras
     where id=_conta_id and ativo
     for update;

    if not found then
      raise exception 'Conta financeira não encontrada ou inativa';
    end if;

    if conta_centro is not null and conta_centro is distinct from _centro_id then
      raise exception 'Conta financeira pertence a outro centro';
    end if;

    if not public.usuario_pode_acessar_conta_financeira(_conta_id) then
      raise exception 'Sem acesso à conta financeira informada';
    end if;
  end if;

  parcelas:=greatest(coalesce(_parcelas,1),1);
  valor_parcela:=round(_valor/parcelas,2);
  saldo:=_valor;

  for n in 1..parcelas loop
    if n=parcelas then
      valor_parcela:=saldo;
    end if;

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
    raise exception 'Sem permissao para confirmar pedidos';
  end if;

  select * into ped
    from public.pedidos
   where id=_pedido_id
   for update;

  if ped.id is null then
    raise exception 'Pedido nao encontrado';
  end if;

  if ped.centro_id is null then
    raise exception 'Centro do pedido obrigatorio';
  end if;

  if not public.usuario_pode_acessar_centro(ped.centro_id) then
    raise exception 'Pedido pertence a outro centro';
  end if;

  if ped.status='confirmado' then
    return ped;
  end if;

  if ped.status<>'rascunho' then
    raise exception 'Pedido nao pode ser confirmado no status atual: %', ped.status;
  end if;

  if not exists (
    select 1 from public.pedido_itens where pedido_id=_pedido_id
  ) then
    raise exception 'Inclua ao menos um item no pedido';
  end if;

  perform public.recalcular_pedido(_pedido_id);

  select * into ped
    from public.pedidos
   where id=_pedido_id
   for update;

  for item in
    select produto_id,sum(quantidade) qtd
      from public.pedido_itens
     where pedido_id=_pedido_id
     group by produto_id
  loop
    perform public.registrar_movimento_estoque_controlado(
      item.produto_id,ped.centro_id,'saida',item.qtd,null,
      'pedido',_pedido_id,'Baixa por confirmacao de pedido'
    );
  end loop;

  parcelas:=greatest(coalesce(ped.parcelas,1),1);
  valor_parcela:=round(ped.total_liquido/parcelas,2);
  saldo:=ped.total_liquido;

  for n in 1..parcelas loop
    if n=parcelas then
      valor_parcela:=saldo;
    end if;

    insert into public.contas_receber
      (cliente_id,pedido_id,documento,parcela,valor,vencimento,centro_id,data_emissao,status)
    values
      (ped.cliente_id,ped.id,'PED-'||ped.numero,n,valor_parcela,
       ped.data_pedido+((n-1)*30),ped.centro_id,current_date,'aberto');

    saldo:=saldo-valor_parcela;
  end loop;

  if ped.representante_id is not null and ped.comissao_valor>0 then
    insert into public.comissoes
      (representante_id,pedido_id,base_calculo,percentual,valor,centro_id)
    values
      (ped.representante_id,ped.id,ped.total_itens,
       ped.comissao_percentual,ped.comissao_valor,ped.centro_id);
  end if;

  update public.pedidos
     set status='confirmado'
   where id=_pedido_id
   returning * into ped;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('pedidos',_pedido_id,'confirmar',
         jsonb_build_object('total',ped.total_liquido,'parcelas',ped.parcelas,
                            'centro_id',ped.centro_id),auth.uid());

  return ped;
end;
$$;

revoke all on function public.criar_despesa(uuid,uuid,uuid,text,text,numeric,integer,date,integer,uuid,uuid) from public;
grant execute on function public.criar_despesa(uuid,uuid,uuid,text,text,numeric,integer,date,integer,uuid,uuid) to authenticated;

revoke all on function public.confirmar_pedido(uuid) from public;
grant execute on function public.confirmar_pedido(uuid) to authenticated;

commit;
