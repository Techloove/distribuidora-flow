-- Fase 65: idempotencia de confirmacao de pedido.
-- Confirmar o mesmo pedido novamente retorna o pedido ja confirmado,
-- sem repetir estoque, contas a receber ou comissao.

begin;

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
  if not public.can_operate(auth.uid()) then
    raise exception 'Sem permissao para confirmar pedidos';
  end if;

  select * into ped
    from public.pedidos
   where id = _pedido_id
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

  -- Operacao idempotente: uma confirmacao ja concluida pode ser repetida
  -- com seguranca por retry do cliente, sem duplicar efeitos financeiros/estoque.
  if ped.status = 'confirmado' then
    return ped;
  end if;

  if ped.status <> 'rascunho' then
    raise exception 'Pedido nao pode ser confirmado no status atual: %', ped.status;
  end if;

  if not exists (
    select 1
      from public.pedido_itens
     where pedido_id = _pedido_id
  ) then
    raise exception 'Inclua ao menos um item no pedido';
  end if;

  perform public.recalcular_pedido(_pedido_id);
  select * into ped
    from public.pedidos
   where id = _pedido_id
   for update;

  for item in
    select produto_id, sum(quantidade) qtd
      from public.pedido_itens
     where pedido_id = _pedido_id
     group by produto_id
  loop
    insert into public.estoque_movimentos
      (produto_id, centro_id, tipo, quantidade, origem, documento_id, observacao, created_by)
    values
      (item.produto_id, ped.centro_id, 'saida', item.qtd, 'pedido', _pedido_id,
       'Baixa por confirmacao de pedido', auth.uid());
  end loop;

  valor_parcela := round(ped.total_liquido / greatest(ped.parcelas, 1), 2);
  saldo := ped.total_liquido;

  for n in 1..greatest(ped.parcelas, 1) loop
    if n = ped.parcelas then
      valor_parcela := saldo;
    end if;

    insert into public.contas_receber
      (cliente_id, pedido_id, documento, parcela, valor, vencimento)
    values
      (ped.cliente_id, ped.id, 'PED-' || ped.numero, n, valor_parcela,
       ped.data_pedido + (n * 30));

    saldo := saldo - valor_parcela;
  end loop;

  if ped.representante_id is not null and ped.comissao_valor > 0 then
    insert into public.comissoes
      (representante_id, pedido_id, base_calculo, percentual, valor)
    values
      (ped.representante_id, ped.id, ped.total_itens,
       ped.comissao_percentual, ped.comissao_valor);
  end if;

  update public.pedidos
     set status = 'confirmado'
   where id = _pedido_id
   returning * into ped;

  insert into public.auditoria
    (tabela, registro_id, acao, detalhe, user_id)
  values
    ('pedidos', _pedido_id, 'confirmar',
     jsonb_build_object(
       'total', ped.total_liquido,
       'parcelas', ped.parcelas
     ),
     auth.uid());

  return ped;
end;
$$;

grant execute on function public.confirmar_pedido(uuid) to authenticated;

commit;
