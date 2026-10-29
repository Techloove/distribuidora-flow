begin;
-- A autoria, a carteira e o estágio são conferidos no servidor, sob bloqueio.
create or replace function public.exigir_cancelamento_representante_286(_pedido uuid,_motivo text) returns void
language plpgsql security definer set search_path=public as $$begin
 if not public.usuario_ativo() or not public.has_role(auth.uid(),'representante') or not exists(
  select 1 from public.pedidos p where p.id=_pedido and p.tipo_documento='pedido' and p.status='aprovado'
   and p.created_by=auth.uid() and p.representante_id=public.meu_representante_id()
   and public.documento_na_minha_carteira('pedidos',p.id) and public.usuario_pode_acessar_centro(p.centro_id)
 ) then raise exception 'Representante só pode cancelar pedido aprovado criado por ele e pertencente à sua carteira';end if;
 if length(trim(coalesce(_motivo,'')))<10 or length(_motivo)>2000 then raise exception 'Descreva o motivo com 10 a 2000 caracteres';end if;
end $$;
revoke all on function public.exigir_cancelamento_representante_286(uuid,text) from public,anon,authenticated,service_role;
create or replace function public.contexto_cancelamento_representante_286(_pedido uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce(public.usuario_ativo() and public.has_role(auth.uid(),'representante')
 and current_setting('app.cancelamento_representante_286',true)=_pedido::text
 and exists(select 1 from public.pedidos p where p.id=_pedido and p.created_by=auth.uid()
 and p.representante_id=public.meu_representante_id() and p.status in('aprovado','cancelado')
 and public.documento_na_minha_carteira('pedidos',p.id) and public.usuario_pode_acessar_centro(p.centro_id)),false);
$$;
revoke all on function public.contexto_cancelamento_representante_286(uuid) from public,anon,authenticated,service_role;
create or replace function public.ajustar_titulos_representante_286(_pedido uuid,_valor numeric,_devolucao uuid,_motivo text,_excluir boolean default false) returns numeric
language plpgsql security definer set search_path=public as $$
declare t public.contas_receber; restante numeric:=_valor; abatido numeric:=0; usar numeric; novo uuid; tipo text;
begin
 perform public.exigir_cancelamento_representante_286(_pedido,_motivo);
 perform 1 from public.contas_receber where pedido_id=_pedido order by id for update;
 perform 1 from public.boletos where pedido_id=_pedido or conta_receber_id in(select id from public.contas_receber where pedido_id=_pedido) order by id for update;
 if exists(select 1 from public.contas_receber where pedido_id=_pedido and (coalesce(valor_pago,0)>0 or status='pago')) or
 exists(select 1 from public.boletos where (pedido_id=_pedido or conta_receber_id in(select id from public.contas_receber where pedido_id=_pedido)) and status='liquidado') then
  raise exception 'Pedido possui recebimentos ou boleto liquidado. Use devolução com crédito e acerto financeiro específico; nenhum recebimento será excluído';end if;
 if exists(select 1 from public.movimentos_financeiros m join public.contas_receber c on c.id=m.conta_receber_id where c.pedido_id=_pedido and m.status<>'estornado') or
 exists(select 1 from public.renegociacao_origens r join public.contas_receber c on c.id=r.titulo_id where c.pedido_id=_pedido) or exists(select 1 from public.contas_receber where pedido_id=_pedido and acordo_id is not null) then raise exception 'Há movimentação ou renegociação vinculada. Faça a conciliação financeira antes desta operação';end if;
 if exists(select 1 from public.boletos where pedido_id=_pedido and canal='api' and status not in('registrado','baixado','cancelado','liquidado')) then raise exception 'Resolva a emissão ou consulta pendente do boleto antes de ajustar a venda';end if;
 if _valor is not null and (_valor<=0 or _valor::text in('NaN','Infinity','-Infinity')) then raise exception 'Valor de ajuste inválido';end if;
 for t in select * from public.contas_receber where pedido_id=_pedido and status in('aberto','parcial') order by vencimento,parcela,id for update loop
  exit when restante is not null and restante<=0;
  usar:=case when restante is null then t.valor else least(t.valor,restante) end;
  if usar<=0 then continue;end if;
  if _devolucao is not null and (coalesce(t.juros,0)<>0 or coalesce(t.multa,0)<>0 or coalesce(t.acrescimo,0)<>0 or coalesce(t.desconto,0)<>0) then raise exception 'Título com encargos ou descontos exige devolução com crédito e acerto financeiro específico';end if;
  tipo:=case when _devolucao is null then 'cancelamento_pedido' when usar<t.valor then 'devolucao_parcial' else 'devolucao' end;
  update public.boletos set ajuste_pedido_motivo_285=trim(_motivo),ajuste_pedido_tipo_285=tipo
   where conta_receber_id=t.id;
  insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('contas_receber',t.id,'ajuste_pedido_285',auth.uid(),jsonb_build_object('antes',to_jsonb(t),'motivo',trim(_motivo),'devolucao',_devolucao,'abatimento',usar));
  if _excluir and usar=t.valor and not exists(select 1 from public.boletos where conta_receber_id=t.id) and not exists(select 1 from public.movimentos_financeiros where conta_receber_id=t.id) and not exists(select 1 from public.contas_receber where titulo_substituido_285=t.id) then
   delete from public.contas_receber where id=t.id;
  else
   update public.contas_receber set status='cancelado' where id=t.id;
   if usar<t.valor then
    insert into public.contas_receber(cliente_id,pedido_id,documento,parcela,valor,vencimento,centro_id,data_emissao,status,titulo_substituido_285,forma_pagamento_id,conta_financeira_id,categoria_id,descricao,observacao)
    values(t.cliente_id,t.pedido_id,left(coalesce(t.documento,'Pedido')||' / ajuste devolução',240),t.parcela,t.valor-usar,t.vencimento,t.centro_id,(now() at time zone 'America/Sao_Paulo')::date,'aberto',t.id,t.forma_pagamento_id,t.conta_financeira_id,t.categoria_id,t.descricao,concat_ws(E'\n',nullif(t.observacao,''),'Saldo após devolução '||_devolucao::text)) returning id into novo;
    insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('contas_receber',novo,'saldo_devolucao_285',auth.uid(),jsonb_build_object('titulo_substituido',t.id,'valor',t.valor-usar,'devolucao',_devolucao));
   end if;
  end if;
  abatido:=abatido+usar;if restante is not null then restante:=restante-usar;end if;
 end loop;
 return abatido;
end $$;
revoke all on function public.ajustar_titulos_representante_286(uuid,numeric,uuid,text,boolean) from public,anon,authenticated,service_role;
create or replace function public.cancelar_pedido_representante_286(_pedido uuid,_motivo text) returns void
language plpgsql security definer set search_path=public as $$
declare p public.pedidos; item record; carga record; op uuid; excluir boolean;
begin
 select * into p from public.pedidos where id=_pedido for update;
 perform public.exigir_cancelamento_representante_286(_pedido,_motivo);
 perform set_config('app.cancelamento_representante_286',_pedido::text,true);
 if p.status='cancelado' then return;end if;
 perform 1 from public.expedicoes where pedido_id=_pedido order by id for update;
 perform 1 from public.cargas where id in(select carga_id from public.carga_pedidos where pedido_id=_pedido) order by id for update;
 if p.status not in('rascunho','digitacao','aguardando_aprovacao','aprovado','recusado','confirmado','separacao','separado','conferido','faturado','nf_emitida','em_carga') or
 exists(select 1 from public.expedicoes where pedido_id=_pedido and (status in('em_rota','entregue') or data_saida is not null)) or
 exists(select 1 from public.cargas c join public.carga_pedidos cp on cp.carga_id=c.id where cp.pedido_id=_pedido and c.status not in('aberta','em_preparacao')) then
  raise exception 'A venda passou da montagem da carga. Registre devolução dos itens em vez de cancelar diretamente';end if;
 if exists(select 1 from public.devolucoes where pedido_id=_pedido and status='confirmada') then raise exception 'Pedido já tem devolução. Conclua o fluxo de devolução e acerto financeiro';end if;
 if exists(select 1 from public.comissoes where pedido_id=_pedido and status='paga') then raise exception 'Pedido com comissão paga exige acerto financeiro específico';end if;
 if exists(select 1 from public.notas_saida where pedido_id=_pedido and status in('autorizada','emitida')) then raise exception 'Pedido com nota fiscal autorizada exige cancelamento fiscal ou devolução antes do encerramento';end if;
 excluir:=p.status in('rascunho','digitacao','aguardando_aprovacao','aprovado','recusado','confirmado','separacao','separado','conferido');
 perform public.ajustar_titulos_representante_286(_pedido,null,null,_motivo,excluir);
 insert into public.pedido_operacoes(pedido_id,tipo,created_by) values(_pedido,'cancelamento',auth.uid()) on conflict(pedido_id,tipo) do nothing returning id into op;
 if op is null then raise exception 'Há cancelamento anterior inconsistente; confira o histórico';end if;
 for carga in select carga_id from public.carga_pedidos where pedido_id=_pedido order by carga_id loop
  perform public.remover_pedido_carga(carga.carga_id,_pedido);
 end loop;
 -- Reverte somente saídas efetivamente registradas. Aprovação/reserva não gera entrada fictícia.
 for item in select produto_id,sum(case when tipo='saida' and origem='pedido' then quantidade when tipo='entrada' and origem='pedido_cancelado' then -quantidade else 0 end) qtd
  from public.estoque_movimentos where documento_id=_pedido group by produto_id order by produto_id loop
  if item.qtd>0 then perform public.registrar_movimento_estoque_controlado(item.produto_id,p.centro_id,'entrada',item.qtd,null,'pedido_cancelado',_pedido,'Cancelamento administrativo: '||trim(_motivo));end if;
 end loop;
 update public.comissoes set status='cancelada' where pedido_id=_pedido and status<>'paga';
 update public.expedicoes set status='cancelada' where pedido_id=_pedido and status<>'cancelada';
 perform public.restaurar_creditos_cancelamento_pedido(_pedido);
 perform set_config('app.cancelamento_pedido_285',_pedido::text,true);
 update public.pedidos set status='cancelado',cancelamento_motivo_285=trim(_motivo),cancelamento_por_285=auth.uid(),cancelamento_em_285=now() where id=_pedido;
 update public.boletos set ajuste_pedido_motivo_285=trim(_motivo),ajuste_pedido_tipo_285='cancelamento_pedido' where pedido_id=_pedido;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',_pedido,'cancelar_representante_286',auth.uid(),jsonb_build_object('motivo',trim(_motivo),'status_anterior',p.status,'exclusao_somente_titulos_sem_vinculos',excluir));
 perform set_config('app.cancelamento_representante_286','',true);
end $$;
revoke all on function public.cancelar_pedido_representante_286(uuid,text) from public,anon,service_role;
grant execute on function public.cancelar_pedido_representante_286(uuid,text) to authenticated;
create or replace function public.proteger_ajustes_pedido_285() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if tg_table_name='pedidos' then
  if auth.uid() is not null and old.status in('cancelado','devolvido') and new.status is distinct from old.status then raise exception 'Pedido encerrado não pode ser reaberto por alteração de status';end if;
  if auth.uid() is not null and not public.has_role(auth.uid(),'admin') and not public.contexto_cancelamento_representante_286(old.id) and (new.cancelamento_motivo_285 is distinct from old.cancelamento_motivo_285 or new.cancelamento_por_285 is distinct from old.cancelamento_por_285 or new.cancelamento_em_285 is distinct from old.cancelamento_em_285) then raise exception 'Somente administrador registra o cancelamento';end if;
  if new.status='cancelado' and old.status is distinct from 'cancelado' and auth.uid() is not null and
   ((not public.has_role(auth.uid(),'admin') and not public.contexto_cancelamento_representante_286(old.id)) or current_setting('app.cancelamento_pedido_285',true) is distinct from new.id::text) then raise exception 'Use o cancelamento administrativo com motivo';end if;
 elsif tg_table_name='devolucoes' then
  if tg_op='INSERT' then
   if new.financeiro_ajustado_285 then raise exception 'O acerto financeiro exige a operação administrativa completa';end if;
   return new;
  end if;
  if old.financeiro_ajustado_285 and (new.status is distinct from old.status or new.valor_total is distinct from old.valor_total or not new.financeiro_ajustado_285 or new.pedido_id is distinct from old.pedido_id) then raise exception 'Devolução com acerto financeiro exige estorno específico; não pode ser cancelada isoladamente';end if;
  if new.financeiro_ajustado_285 is distinct from old.financeiro_ajustado_285 and auth.uid() is not null and not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador ajusta o financeiro da devolução';end if;
 elsif tg_table_name='boletos' then
  if auth.uid() is not null and not public.has_role(auth.uid(),'admin') and (not public.contexto_cancelamento_representante_286(old.pedido_id) or new.baixa_motivo_285 is distinct from old.baixa_motivo_285 or new.pagamento_apos_ajuste_285 is distinct from old.pagamento_apos_ajuste_285) and (new.ajuste_pedido_motivo_285 is distinct from old.ajuste_pedido_motivo_285 or new.ajuste_pedido_tipo_285 is distinct from old.ajuste_pedido_tipo_285 or new.baixa_motivo_285 is distinct from old.baixa_motivo_285 or new.pagamento_apos_ajuste_285 is distinct from old.pagamento_apos_ajuste_285) then raise exception 'Somente administrador registra motivo de baixa e ajuste do pedido';end if;
 elsif tg_table_name='contas_receber' then
  if auth.uid() is not null and not public.has_role(auth.uid(),'admin') and new.titulo_substituido_285 is distinct from old.titulo_substituido_285 then raise exception 'Somente administrador altera o vínculo de substituição do título';end if;
 end if;
 return new;
end $$;
create or replace function public.previa_cancelamento_representante_286(_pedido uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$begin
 perform public.exigir_cancelamento_representante_286(_pedido,'Consulta de cancelamento do pedido');
 return jsonb_build_object('recebimentos',exists(select 1 from public.contas_receber where pedido_id=_pedido and (valor_pago>0 or status='pago')) or exists(select 1 from public.boletos where pedido_id=_pedido and status='liquidado'),
 'boletos_aguardando_baixa',(select count(*) from public.boletos where pedido_id=_pedido and status='registrado'),'itens','[]'::jsonb);
end $$;
revoke all on function public.previa_cancelamento_representante_286(uuid) from public,anon,service_role;
grant execute on function public.previa_cancelamento_representante_286(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
