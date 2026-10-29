-- Cancelamento administrativo antes da saída; devolução e acerto financeiro após saída.
begin;
alter table public.pedidos add column if not exists cancelamento_motivo_285 text;
alter table public.pedidos add column if not exists cancelamento_por_285 uuid references public.profiles(id);
alter table public.pedidos add column if not exists cancelamento_em_285 timestamptz;
alter table public.boletos add column if not exists ajuste_pedido_motivo_285 text;
alter table public.boletos add column if not exists ajuste_pedido_tipo_285 text;
alter table public.boletos add column if not exists baixa_motivo_285 text;
alter table public.boletos add column if not exists pagamento_apos_ajuste_285 boolean not null default false;
alter table public.contas_receber add column if not exists titulo_substituido_285 uuid references public.contas_receber(id);
alter table public.devolucoes add column if not exists financeiro_ajustado_285 boolean not null default false;
alter table public.devolucoes add column if not exists chave_ajuste_285 uuid;
alter table public.devolucoes add column if not exists hash_ajuste_285 text;
create unique index if not exists devolucao_chave_285 on public.devolucoes(chave_ajuste_285) where chave_ajuste_285 is not null;

create or replace function public.exigir_admin_pedido_285(_pedido uuid,_motivo text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not public.usuario_ativo() or not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador ativo pode cancelar ou ajustar a venda';end if;
 if length(trim(coalesce(_motivo,'')))<10 or length(_motivo)>2000 then raise exception 'Descreva o motivo com 10 a 2000 caracteres';end if;
 if not exists(select 1 from public.pedidos p where p.id=_pedido and p.tipo_documento='pedido' and public.usuario_pode_acessar_centro(p.centro_id)) then raise exception 'Pedido indisponível para esta loja';end if;
end $$;
revoke all on function public.exigir_admin_pedido_285(uuid,text) from public,anon,authenticated,service_role;

-- Motor privado: conserva títulos com vínculos e nunca elimina recebimentos.
create or replace function public.ajustar_titulos_pedido_285(_pedido uuid,_valor numeric,_devolucao uuid,_motivo text,_excluir boolean default false) returns numeric
language plpgsql security definer set search_path=public as $$
declare t public.contas_receber; restante numeric:=_valor; abatido numeric:=0; usar numeric; novo uuid; tipo text;
begin
 perform public.exigir_admin_pedido_285(_pedido,_motivo);
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
revoke all on function public.ajustar_titulos_pedido_285(uuid,numeric,uuid,text,boolean) from public,anon,authenticated,service_role;

create or replace function public.cancelar_pedido_admin_285(_pedido uuid,_motivo text) returns void
language plpgsql security definer set search_path=public as $$
declare p public.pedidos; item record; carga record; op uuid; excluir boolean;
begin
 perform public.exigir_admin_pedido_285(_pedido,_motivo);
 select * into p from public.pedidos where id=_pedido for update;
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
 perform public.ajustar_titulos_pedido_285(_pedido,null,null,_motivo,excluir);
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
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',_pedido,'cancelar_admin_285',auth.uid(),jsonb_build_object('motivo',trim(_motivo),'status_anterior',p.status,'exclusao_somente_titulos_sem_vinculos',excluir));
end $$;
revoke all on function public.cancelar_pedido_admin_285(uuid,text) from public,anon,service_role;
grant execute on function public.cancelar_pedido_admin_285(uuid,text) to authenticated;

-- Assinatura antiga é preservada, mas não oferece um caminho sem motivo.
create or replace function public.cancelar_pedido(_pedido_id uuid) returns void
language plpgsql security definer set search_path=public as $$begin
 raise exception 'Use o cancelamento administrativo com descrição do motivo';
end $$;
revoke all on function public.cancelar_pedido(uuid) from public,anon;
grant execute on function public.cancelar_pedido(uuid) to authenticated;

create or replace function public.proteger_ajustes_pedido_285() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if tg_table_name='pedidos' then
  if auth.uid() is not null and old.status in('cancelado','devolvido') and new.status is distinct from old.status then raise exception 'Pedido encerrado não pode ser reaberto por alteração de status';end if;
  if auth.uid() is not null and not public.has_role(auth.uid(),'admin') and (new.cancelamento_motivo_285 is distinct from old.cancelamento_motivo_285 or new.cancelamento_por_285 is distinct from old.cancelamento_por_285 or new.cancelamento_em_285 is distinct from old.cancelamento_em_285) then raise exception 'Somente administrador registra o cancelamento';end if;
  if new.status='cancelado' and old.status is distinct from 'cancelado' and auth.uid() is not null and
   (not public.has_role(auth.uid(),'admin') or current_setting('app.cancelamento_pedido_285',true) is distinct from new.id::text) then raise exception 'Use o cancelamento administrativo com motivo';end if;
 elsif tg_table_name='devolucoes' then
  if tg_op='INSERT' then
   if new.financeiro_ajustado_285 then raise exception 'O acerto financeiro exige a operação administrativa completa';end if;
   return new;
  end if;
  if old.financeiro_ajustado_285 and (new.status is distinct from old.status or new.valor_total is distinct from old.valor_total or not new.financeiro_ajustado_285 or new.pedido_id is distinct from old.pedido_id) then raise exception 'Devolução com acerto financeiro exige estorno específico; não pode ser cancelada isoladamente';end if;
  if new.financeiro_ajustado_285 is distinct from old.financeiro_ajustado_285 and auth.uid() is not null and not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador ajusta o financeiro da devolução';end if;
 elsif tg_table_name='boletos' then
  if auth.uid() is not null and not public.has_role(auth.uid(),'admin') and (new.ajuste_pedido_motivo_285 is distinct from old.ajuste_pedido_motivo_285 or new.ajuste_pedido_tipo_285 is distinct from old.ajuste_pedido_tipo_285 or new.baixa_motivo_285 is distinct from old.baixa_motivo_285 or new.pagamento_apos_ajuste_285 is distinct from old.pagamento_apos_ajuste_285) then raise exception 'Somente administrador registra motivo de baixa e ajuste do pedido';end if;
 elsif tg_table_name='contas_receber' then
  if auth.uid() is not null and not public.has_role(auth.uid(),'admin') and new.titulo_substituido_285 is distinct from old.titulo_substituido_285 then raise exception 'Somente administrador altera o vínculo de substituição do título';end if;
 end if;
 return new;
end $$;
revoke all on function public.proteger_ajustes_pedido_285() from public,anon,authenticated;
drop trigger if exists zz_ajustes_pedido_285 on public.pedidos;
create trigger zz_ajustes_pedido_285 before update on public.pedidos for each row execute function public.proteger_ajustes_pedido_285();
drop trigger if exists zz_ajustes_pedido_285 on public.devolucoes;
create trigger zz_ajustes_pedido_285 before insert or update on public.devolucoes for each row execute function public.proteger_ajustes_pedido_285();
drop trigger if exists zz_ajustes_pedido_285 on public.boletos;
create trigger zz_ajustes_pedido_285 before update on public.boletos for each row execute function public.proteger_ajustes_pedido_285();
drop trigger if exists zz_ajustes_pedido_285 on public.contas_receber;
create trigger zz_ajustes_pedido_285 before update on public.contas_receber for each row execute function public.proteger_ajustes_pedido_285();

-- Preço de venda rateado não é custo do estoque que retorna.
create or replace function public.custo_devolucao_pedido_285() returns trigger
language plpgsql security definer set search_path=public as $$declare origem_pedido uuid;begin
 if new.origem='devolucao' then
  select d.pedido_id into origem_pedido from public.devolucoes d where d.id=new.documento_id and d.chave_ajuste_285 is not null;
  if origem_pedido is not null then
   select coalesce((select sum(m.quantidade*coalesce(m.custo_unitario,pr.custo_medio,0))/nullif(sum(m.quantidade),0) from public.estoque_movimentos m join public.produtos pr on pr.id=m.produto_id where m.documento_id=origem_pedido and m.origem='pedido' and m.tipo='saida' and m.produto_id=new.produto_id),pr.custo_medio,0)
    into new.custo_unitario from public.produtos pr where pr.id=new.produto_id;
  end if;
 end if;
 return new;end $$;
revoke all on function public.custo_devolucao_pedido_285() from public,anon,authenticated;
drop trigger if exists ab_custo_devolucao_285 on public.estoque_movimentos;
create trigger ab_custo_devolucao_285 before insert on public.estoque_movimentos for each row execute function public.custo_devolucao_pedido_285();

-- O motor original mantém estoque por condição, limites de quantidade e comissões.
do $$ declare d text; antigo text:=$literal$ped.status not in ('confirmado','faturado','entregue','parcial','nao_entregue','devolvido')$literal$; begin
 select pg_get_functiondef('public.confirmar_devolucao(uuid)'::regprocedure) into d;
 if position('devolucao_estagios_285' in d)=0 then
  if position(antigo in d)=0 then raise exception 'Revise os estágios do motor de devolução antes da fase285';end if;
  execute replace(d,antigo,'/* devolucao_estagios_285 */ ped.status not in (''confirmado'',''separacao'',''separado'',''conferido'',''faturado'',''nf_emitida'',''em_carga'',''em_rota'',''entregue'',''parcial'',''nao_entregue'',''devolvido'')');
 end if;
end $$;

create or replace function public.acao_pedido_admin_285(_pedido uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare p public.pedidos; resultado jsonb;
begin
 perform public.exigir_admin_pedido_285(_pedido,'Consulta administrativa do pedido');
 select * into p from public.pedidos where id=_pedido;
 with originais as(select produto_id,sum(quantidade) qtd,sum(total) valor from public.pedido_itens where pedido_id=_pedido group by produto_id),
 devolvidos as(select i.produto_id,sum(i.quantidade) qtd from public.devolucao_itens i join public.devolucoes d on d.id=i.devolucao_id where d.pedido_id=_pedido and d.status='confirmada' group by i.produto_id)
 select jsonb_build_object('status',p.status,'total',p.total_liquido,'itens',coalesce((select jsonb_agg(jsonb_build_object('produto_id',o.produto_id,'descricao',pr.descricao,'quantidade',o.qtd,'disponivel',greatest(o.qtd-coalesce(d.qtd,0),0),'valor_unitario',case when o.qtd>0 and (select sum(valor) from originais)>0 then p.total_liquido*o.valor/o.qtd/(select sum(valor) from originais) else 0 end) order by pr.descricao,o.produto_id) from originais o join public.produtos pr on pr.id=o.produto_id left join devolvidos d on d.produto_id=o.produto_id),'[]'::jsonb),
 'recebimentos',exists(select 1 from public.contas_receber where pedido_id=_pedido and (valor_pago>0 or status='pago')) or exists(select 1 from public.boletos where pedido_id=_pedido and status='liquidado'),
 'financeiro_especial',exists(select 1 from public.contas_receber where pedido_id=_pedido and (coalesce(juros,0)<>0 or coalesce(multa,0)<>0 or coalesce(acrescimo,0)<>0 or coalesce(desconto,0)<>0)) or exists(select 1 from public.devolucoes where pedido_id=_pedido and status='confirmada' and not financeiro_ajustado_285) or exists(select 1 from public.renegociacao_origens r join public.contas_receber cr on cr.id=r.titulo_id where cr.pedido_id=_pedido),
 'boletos_aguardando_baixa',(select count(*) from public.boletos where pedido_id=_pedido and status='registrado'),
 'devolucoes',(select count(*) from public.devolucoes where pedido_id=_pedido and status='confirmada')) into resultado;
 return resultado;
end $$;
revoke all on function public.acao_pedido_admin_285(uuid) from public,anon,service_role;
grant execute on function public.acao_pedido_admin_285(uuid) to authenticated;

create or replace function public.devolver_pedido_admin_285(_pedido uuid,_itens jsonb,_motivo text,_chave uuid,_recebido boolean) returns uuid
language plpgsql security definer set search_path=public as $$
declare p public.pedidos; dev public.devolucoes; c public.creditos_clientes; x record; j jsonb; qtd numeric; valor_itens numeric; peso numeric:=0; valor numeric; abatido numeric; integral boolean; hash text; carga record;
begin
 perform public.exigir_admin_pedido_285(_pedido,_motivo);
 if _recebido is distinct from true then raise exception 'Confirme o recebimento físico dos itens antes de devolver ao estoque';end if;
 if _chave is null or _itens is null or jsonb_typeof(_itens)<>'array' or jsonb_array_length(_itens) not between 1 and 200 or length(_itens::text)>50000 then raise exception 'Itens ou chave de devolução inválidos';end if;
 hash:=md5(jsonb_build_object('itens',_itens,'motivo',trim(_motivo))::text);
 select * into p from public.pedidos where id=_pedido for update;
 select * into dev from public.devolucoes where chave_ajuste_285=_chave;
 if dev.id is not null then
  if dev.pedido_id is distinct from _pedido or dev.hash_ajuste_285 is distinct from hash or not dev.financeiro_ajustado_285 then raise exception 'Chave de devolução já usada para outra operação';end if;
  return dev.id;
 end if;
 if p.status not in('confirmado','separacao','separado','conferido','faturado','nf_emitida','em_carga','em_rota','entregue','parcial','nao_entregue','devolvido') then raise exception 'Pedido não permite devolução neste estágio';end if;
 if exists(select 1 from public.devolucoes where pedido_id=_pedido and status='confirmada' and not financeiro_ajustado_285) then raise exception 'Há devolução anterior com crédito separado. Concilie-a antes de usar o novo ajuste automático';end if;
 if exists(select 1 from public.contas_receber where pedido_id=_pedido and (valor_pago>0 or status='pago')) or exists(select 1 from public.boletos where pedido_id=_pedido and status='liquidado') then raise exception 'Há recebimentos. Registre devolução com crédito na tela Devoluções e faça o acerto financeiro específico; não se apagam pagamentos';end if;
 if abs(p.total_liquido-coalesce((select sum(ar.valor) from public.contas_receber ar where ar.pedido_id=_pedido and ar.status in('aberto','parcial')),0)
  -coalesce((select sum(dr.valor_total) from public.devolucoes dr where dr.pedido_id=_pedido and dr.status='confirmada' and dr.financeiro_ajustado_285),0)
  -coalesce((select sum(ac.valor) from public.creditos_clientes_aplicacoes ac where ac.pedido_id=_pedido and ac.status='aplicado'),0))>0.01 then
  raise exception 'O financeiro não corresponde ao saldo da venda. Use devolução com crédito e conciliação específica antes de compensar títulos';end if;
 if (select count(distinct v->>'produto_id') from jsonb_array_elements(_itens) v)<>jsonb_array_length(_itens) then raise exception 'Não repita produtos na devolução';end if;
 select sum(total) into valor_itens from public.pedido_itens where pedido_id=_pedido;
 if coalesce(valor_itens,0)<=0 or p.total_liquido<=0 then raise exception 'Pedido sem base de valor para ajuste proporcional';end if;
 for j in select * from jsonb_array_elements(_itens) loop
  if jsonb_typeof(j)<>'object' or exists(select 1 from jsonb_object_keys(j) k where k not in('produto_id','quantidade','condicao')) then raise exception 'Item de devolução inválido';end if;
  qtd:=(j->>'quantidade')::numeric;
  if qtd is null or qtd<=0 or qtd::text in('NaN','Infinity','-Infinity') or round(qtd,3)<>qtd or coalesce(j->>'condicao','revenda') not in('revenda','avaria') then raise exception 'Quantidade ou condição inválida';end if;
  select sum(quantidade) original,sum(total)/nullif(sum(quantidade),0) unitario into x from public.pedido_itens where pedido_id=_pedido and produto_id=(j->>'produto_id')::uuid;
  if x.original is null or qtd>x.original-coalesce((select sum(di.quantidade) from public.devolucao_itens di join public.devolucoes d on d.id=di.devolucao_id where d.pedido_id=_pedido and d.status='confirmada' and di.produto_id=(j->>'produto_id')::uuid),0) then raise exception 'Quantidade supera o saldo vendido e ainda não devolvido';end if;
  peso:=peso+qtd*x.unitario;
 end loop;
 select not exists(select 1 from (select produto_id,sum(quantidade) qtd from public.pedido_itens where pedido_id=_pedido group by produto_id) o
  where o.qtd>coalesce((select sum(di.quantidade) from public.devolucao_itens di join public.devolucoes d on d.id=di.devolucao_id where d.pedido_id=_pedido and d.status='confirmada' and di.produto_id=o.produto_id),0)+coalesce((select sum((v->>'quantidade')::numeric) from jsonb_array_elements(_itens) v where (v->>'produto_id')::uuid=o.produto_id),0)) into integral;
 valor:=case when integral then p.total_liquido-coalesce((select sum(valor_total) from public.devolucoes where pedido_id=_pedido and status='confirmada'),0) else round(p.total_liquido*peso/valor_itens,2) end;
 if valor<=0 then raise exception 'Devolução sem valor financeiro disponível';end if;
 insert into public.devolucoes(pedido_id,cliente_id,centro_id,data_devolucao,motivo,chave_ajuste_285,hash_ajuste_285,created_by) values(_pedido,p.cliente_id,p.centro_id,(now() at time zone 'America/Sao_Paulo')::date,trim(_motivo),_chave,hash,auth.uid()) returning * into dev;
 for j in select * from jsonb_array_elements(_itens) loop
  select sum(total)/nullif(sum(quantidade),0) unitario into x from public.pedido_itens where pedido_id=_pedido and produto_id=(j->>'produto_id')::uuid;
  insert into public.devolucao_itens(devolucao_id,produto_id,quantidade,preco_unitario,condicao) values(dev.id,(j->>'produto_id')::uuid,(j->>'quantidade')::numeric,round(p.total_liquido*x.unitario/valor_itens,4),coalesce(j->>'condicao','revenda'));
 end loop;
 update public.devolucoes set valor_total=valor where id=dev.id;
 perform public.confirmar_devolucao(dev.id);
 abatido:=public.ajustar_titulos_pedido_285(_pedido,valor,dev.id,_motivo,false);
 select * into c from public.creditos_clientes where devolucao_id=dev.id for update;
 if c.id is null or c.valor_utilizado<>0 or c.status<>'disponivel' then raise exception 'Crédito da devolução inconsistente; nenhuma alteração foi concluída';end if;
 -- A parte que cancela dívida não vira crédito reutilizável nem recebimento/comissão.
 if abatido>=valor then update public.creditos_clientes set status='cancelado',observacao=coalesce(observacao,'')||' / compensado pelo cancelamento de títulos' where id=c.id;
 elsif abatido>0 then update public.creditos_clientes set valor_original=valor-abatido,observacao=coalesce(observacao,'')||' / saldo após compensar títulos: '||abatido::text where id=c.id;end if;
 update public.devolucoes set financeiro_ajustado_285=true where id=dev.id;
 if integral then
  update public.pedidos set status='devolvido' where id=_pedido;
  for carga in select cg.id from public.cargas cg join public.carga_pedidos cp on cp.carga_id=cg.id where cp.pedido_id=_pedido and cg.status in('em_rota','entregando') order by cg.id for update of cg loop
   if public.carga_pode_concluir_285(carga.id) then perform public.avancar_carga(carga.id,'concluida',(now() at time zone 'America/Sao_Paulo')::date);end if;
  end loop;
 end if;
 perform public.apurar_comissao_pedido(_pedido);
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('devolucoes',dev.id,'devolucao_financeira_285',auth.uid(),jsonb_build_object('pedido',_pedido,'motivo',trim(_motivo),'integral',integral,'valor_proporcional',valor,'titulos_compensados',abatido,'credito_residual',greatest(valor-abatido,0),'recebimento_fisico_confirmado',true));
 return dev.id;
end $$;
revoke all on function public.devolver_pedido_admin_285(uuid,jsonb,text,uuid,boolean) from public,anon,service_role;
grant execute on function public.devolver_pedido_admin_285(uuid,jsonb,text,uuid,boolean) to authenticated;

create or replace function public.autorizar_baixa_boleto_285(_boleto uuid,_motivo text) returns void
language plpgsql security definer set search_path=public as $$declare b public.boletos;begin
 if not public.usuario_ativo() or not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador ativo pode solicitar baixa de boleto';end if;
 if length(trim(coalesce(_motivo,'')))<10 or length(_motivo)>2000 then raise exception 'Descreva o motivo com 10 a 2000 caracteres';end if;
 select * into b from public.boletos where id=_boleto for update;
 if b.id is null or not public.usuario_pode_acessar_centro(b.centro_id) or b.status<>'registrado' or b.banco<>'sicredi' or b.canal<>'api' then raise exception 'Boleto indisponível para baixa';end if;
 update public.boletos set baixa_motivo_285=trim(_motivo) where id=_boleto;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('boletos',_boleto,'autorizar_baixa_285',auth.uid(),jsonb_build_object('motivo',trim(_motivo),'estado','autorizacao_previa_nao_confirma_baixa'));end $$;
revoke all on function public.autorizar_baixa_boleto_285(uuid,text) from public,anon,service_role;
grant execute on function public.autorizar_baixa_boleto_285(uuid,text) to authenticated;

create or replace function public.boleto_substituicao_285() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if exists(select 1 from public.pedidos where id=new.pedido_id and status in('cancelado','devolvido')) then raise exception 'Não emita nova cobrança para pedido cancelado ou integralmente devolvido';end if;
 if exists(with recursive anteriores as (
  select c.titulo_substituido_285 id,array[c.id] caminho from public.contas_receber c where c.id=new.conta_receber_id and c.titulo_substituido_285 is not null
  union all select c.titulo_substituido_285,a.caminho||c.id from anteriores a join public.contas_receber c on c.id=a.id where c.titulo_substituido_285 is not null and not c.id=any(a.caminho)
 ) select 1 from anteriores a join public.boletos b on b.conta_receber_id=a.id where b.status not in('baixado','cancelado')) then raise exception 'Aguarde a baixa bancária do boleto anterior antes de emitir o saldo da devolução';end if;
 return new;end $$;
revoke all on function public.boleto_substituicao_285() from public,anon,authenticated;
drop trigger if exists zz_boleto_substituicao_285 on public.boletos;
create trigger zz_boleto_substituicao_285 before insert on public.boletos for each row execute function public.boleto_substituicao_285();

-- Concluir uma carga aceita devolução integral comprovada, sem forjar entrega.
create or replace function public.carga_pode_concluir_285(_carga uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.carga_pedidos where carga_id=_carga) and not exists(
  select 1 from public.carga_pedidos cp join public.pedidos p on p.id=cp.pedido_id where cp.carga_id=_carga and not (
   (p.status in('entregue','devolvido') and exists(select 1 from public.expedicoes e where e.pedido_id=p.id and e.carga_id=_carga and e.status='entregue' and exists(select 1 from public.entrega_registros er where er.expedicao_id=e.id and er.tipo='entrega'))) or
   (p.status='devolvido' and exists(select 1 from public.devolucoes d where d.pedido_id=p.id and d.status='confirmada' and d.financeiro_ajustado_285) and
    not exists(select 1 from public.pedido_itens i where i.pedido_id=p.id and (select sum(oi.quantidade) from public.pedido_itens oi where oi.pedido_id=p.id and oi.produto_id=i.produto_id)>coalesce((select sum(di.quantidade) from public.devolucao_itens di join public.devolucoes d on d.id=di.devolucao_id where d.pedido_id=p.id and d.status='confirmada' and di.produto_id=i.produto_id),0)))
  ));
$$;
revoke all on function public.carga_pode_concluir_285(uuid) from public,anon,authenticated,service_role;
do $$ declare d text; antigo text:=$literal$pp.status not in ('entregue','devolvido') or not exists(select 1 from public.expedicoes e where e.pedido_id=pp.id and e.carga_id=c.id and e.status='entregue' and exists(select 1 from public.entrega_registros er where er.expedicao_id=e.id and er.tipo='entrega'))$literal$;begin
 if to_regprocedure('public.avancar_carga(uuid,text,date)') is not null then
  select pg_get_functiondef('public.avancar_carga(uuid,text,date)'::regprocedure) into d;
  if position('carga_pode_concluir_285' in d)=0 then
   if position(antigo in d)=0 then raise exception 'Revise a conclusão de cargas antes da fase285';end if;
   execute replace(d,antigo,'not public.carga_pode_concluir_285(c.id)');
  end if;
 end if;
end $$;

do $$ declare d text; antigo text:=$literal$p.status not in ('entregue','devolvido') or not exists(select 1 from public.expedicoes e where e.pedido_id=p.id and e.carga_id=new.carga_id and e.status='entregue' and exists(select 1 from public.entrega_registros er where er.expedicao_id=e.id and er.tipo='entrega'))$literal$;begin
 if to_regprocedure('public.sincronizar_carga_entregue_233()') is not null then
  select pg_get_functiondef('public.sincronizar_carga_entregue_233()'::regprocedure) into d;
  if position('carga_pode_concluir_285' in d)=0 then
   if position(antigo in d)=0 then raise exception 'Revise a conclusão automática da carga antes da fase285';end if;
   execute replace(d,antigo,'not public.carga_pode_concluir_285(new.carga_id)');
  end if;
 end if;
end $$;

-- Pagamento ocorrido no intervalo entre o ajuste local e a baixa bancária:
-- conserva a prova bancária sem reabrir título cancelado nem criar caixa fictício.
do $$ declare d text; alvo text:='saldo:=round(coalesce(cr.valor,0)'; begin
 if to_regprocedure('public.sicredi_liquidar_api_224(uuid,uuid,jsonb)') is not null then
  select pg_get_functiondef('public.sicredi_liquidar_api_224(uuid,uuid,jsonb)'::regprocedure) into d;
  if position('pagamento_apos_ajuste_285' in d)=0 then
   if position(alvo in d)=0 then raise exception 'Revise a liquidação Sicredi antes da fase285';end if;
   execute replace(d,alvo,$patch$if cr.status='cancelado' and b.ajuste_pedido_motivo_285 is not null then
    update public.boletos set status='liquidado',valor_liquidado=v,data_liquidacao=dt,sicredi_liquidacao_api=_dados,pagamento_apos_ajuste_285=true where id=b.id;
    insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id) values('boletos',b.id,'pagamento_apos_ajuste_285',jsonb_build_object('dados_banco',_dados,'titulo_cancelado_preservado',cr.id,'conciliacao_especifica',true),_actor);
    return;
   end if;
   saldo:=round(coalesce(cr.valor,0)$patch$);
  end if;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
