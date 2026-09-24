-- Fase 78: reforco de centro no credito financeiro de devolucao.
-- A versao original de confirmar_devolucao criava o credito sem centro_id,
-- apesar de o pedido/devolucao ja possuirem centro. Mantem a semantica atual
-- do credito e apenas torna sua referencia de centro explicita.

begin;

create or replace function public.confirmar_devolucao(_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  dev public.devolucoes;
  ped public.pedidos;
  it record;
  op_id uuid;
  qtd_vendida numeric(14,3);
  qtd_devolvida numeric(14,3);
begin
  if not public.can_manage(auth.uid()) then
    raise exception 'Sem permissao para confirmar devolucoes';
  end if;

  select * into dev from public.devolucoes where id=_id for update;
  if dev.id is null then raise exception 'Devolucao nao encontrada'; end if;

  if dev.pedido_id is not null then
    select * into ped from public.pedidos where id=dev.pedido_id for update;
    if ped.id is null then raise exception 'Pedido de origem nao encontrado'; end if;
    if not public.usuario_pode_acessar_centro(ped.centro_id) then
      raise exception 'Pedido pertence a outro centro';
    end if;
    if ped.status not in ('confirmado','faturado','entregue','parcial','nao_entregue','devolvido') then
      raise exception 'Pedido no status % nao permite devolucao',ped.status;
    end if;
    if dev.centro_id is null then dev.centro_id:=ped.centro_id;
    elsif dev.centro_id<>ped.centro_id then
      raise exception 'Centro da devolucao difere do centro do pedido';
    end if;
  else
    if not public.usuario_pode_acessar_centro(dev.centro_id) then
      raise exception 'Devolucao pertence a outro centro';
    end if;
  end if;

  if dev.status='confirmada' then return; end if;
  if dev.status<>'rascunho' then raise exception 'Somente devolucoes em rascunho podem ser confirmadas'; end if;
  if not exists(select 1 from public.devolucao_itens where devolucao_id=_id) then raise exception 'Inclua ao menos um item na devolucao'; end if;
  if dev.centro_id is null then raise exception 'Centro da devolucao obrigatorio'; end if;

  insert into public.devolucao_operacoes(devolucao_id,tipo,created_by)
  values(_id,'confirmacao',auth.uid())
  on conflict(devolucao_id,tipo) do nothing
  returning id into op_id;
  if op_id is null then return; end if;

  for it in
    select produto_id,sum(quantidade) as qtd,sum(total) as total
    from public.devolucao_itens where devolucao_id=_id group by produto_id
  loop
    if dev.pedido_id is not null then
      select coalesce(sum(quantidade),0) into qtd_vendida from public.pedido_itens where pedido_id=dev.pedido_id and produto_id=it.produto_id;
      select coalesce(sum(di.quantidade),0) into qtd_devolvida
      from public.devolucao_itens di join public.devolucoes d on d.id=di.devolucao_id
      where d.pedido_id=dev.pedido_id and di.produto_id=it.produto_id and d.status='confirmada' and d.id<>_id;
      if it.qtd>greatest(qtd_vendida-qtd_devolvida,0) then raise exception 'Quantidade devolvida do produto % excede a quantidade vendida disponivel',it.produto_id; end if;
    end if;
    insert into public.estoque_movimentos
      (produto_id,centro_id,tipo,quantidade,custo_unitario,origem,documento_id,observacao,created_by)
    values(it.produto_id,dev.centro_id,'entrada',it.qtd,case when it.qtd<>0 then it.total/it.qtd else 0 end,'devolucao',dev.id,'Entrada de devolucao '||dev.numero,auth.uid());
  end loop;

  insert into public.contas_receber
    (cliente_id,pedido_id,centro_id,documento,parcela,valor,vencimento,status,observacao)
  values
    (dev.cliente_id,dev.pedido_id,dev.centro_id,'DEV-'||dev.numero,1,-1*dev.valor_total,current_date,'aberto','Credito de devolucao '||dev.numero)
  on conflict do nothing;

  update public.devolucoes set centro_id=dev.centro_id,status='confirmada' where id=_id;
  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('devolucoes',_id,'confirmar',jsonb_build_object('numero',dev.numero,'valor',dev.valor_total,'centro_id',dev.centro_id),auth.uid());
  perform public.notificar('Devolucao confirmada','Devolucao '||dev.numero||' retornou ao estoque e gerou credito ao cliente.','alerta','/devolucoes');
end;
$$;

grant execute on function public.confirmar_devolucao(uuid) to authenticated;

commit;
