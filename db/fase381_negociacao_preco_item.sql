-- Negociação administrativa, inclusive confirmados sem boleto/carga e sem compromissos financeiros.
begin;
create table if not exists public.pedido_item_precos_381 (
 id uuid primary key default gen_random_uuid(),
 pedido_id uuid not null references public.pedidos(id) on delete cascade,
 item_id uuid references public.pedido_itens(id) on delete set null,
 produto_id uuid not null references public.produtos(id),
 centro_id uuid not null references public.centros(id),
 preco_anterior numeric(14,4) not null,
 preco_novo numeric(14,4) not null,
 motivo text not null default '',
 usuario_id uuid references public.profiles(id) on delete set null,
 alterado_em timestamptz not null default now()
);
create index if not exists pedido_item_precos_consulta_381 on public.pedido_item_precos_381(pedido_id,alterado_em desc,id);
alter table public.pedido_item_precos_381 enable row level security;
revoke all on public.pedido_item_precos_381 from public,anon,authenticated,service_role;
grant select on public.pedido_item_precos_381 to authenticated;
drop policy if exists leitura_admin_381 on public.pedido_item_precos_381;
create policy leitura_admin_381 on public.pedido_item_precos_381 for select to authenticated using(public.usuario_ativo() and public.has_role(auth.uid(),'admin') and public.usuario_pode_acessar_centro(centro_id));

create or replace function public.negociar_preco_item_381(_item uuid,_preco_esperado numeric,_novo_preco numeric,_quantidade_esperada numeric,_desconto_esperado numeric,_motivo text default '') returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare antes public.pedido_itens;depois public.pedido_itens;p public.pedidos;atual public.pedidos;novo numeric;avancado boolean;
 titulo record; titulos integer:=0; posicao integer:=0; soma_titulos numeric:=0; distribuido numeric:=0; valor_parcela numeric;financeiro_antes jsonb;comissao_antes jsonb;
begin
 if auth.uid() is null or not coalesce(public.usuario_ativo(),false) or coalesce(public.complemento_pendente_238(),true) or not coalesce(public.saas_acesso_330(),false) or not coalesce(public.has_role(auth.uid(),'admin'),false) or not coalesce(public.can_operate(auth.uid()),false) then raise exception 'Somente administrador ativo pode negociar preços';end if;
 if _novo_preco is null or _novo_preco::text in('NaN','Infinity','-Infinity') or _novo_preco<0 or _novo_preco>9999999999.9999 or _novo_preco<>round(_novo_preco,4) or _preco_esperado is null or _preco_esperado::text in('NaN','Infinity','-Infinity') then raise exception 'Preço inválido; use até quatro casas decimais';end if;
 if length(coalesce(_motivo,''))>500 then raise exception 'Motivo deve ter até 500 caracteres';end if;
 -- Mesma ordem de bloqueios utilizada pela RPC legada de edição de itens.
 select * into antes from public.pedido_itens where id=_item for update;
 if antes.id is null then raise exception 'Item não encontrado';end if;
 select * into p from public.pedidos where id=antes.pedido_id for update;
 if p.id is null or not coalesce(public.usuario_pode_acessar_centro(p.centro_id),false) then raise exception 'Pedido sem acesso';end if;
 if p.status is null or p.status not in('rascunho','digitacao','aguardando_aprovacao','aprovado','confirmado','separacao','separado','conferido') then raise exception 'Pedido fora da negociação autorizada';end if;
 avancado:=p.status in('aprovado','confirmado','separacao','separado','conferido');
 if p.modalidade_venda is distinct from 'estoque' then raise exception 'Use a precificação própria da intermediação';end if;
 if p.tipo_documento='orcamento' and (p.orcamento_situacao is distinct from 'negociacao' or p.orcamento_validade is null or p.orcamento_validade<(now() at time zone 'America/Sao_Paulo')::date) then raise exception 'Orçamento fora da negociação válida';end if;
 if antes.preco_unitario is distinct from _preco_esperado or antes.quantidade is distinct from _quantidade_esperada or antes.desconto_percentual is distinct from _desconto_esperado then raise exception 'Item alterado por outra operação. Atualize e revise a negociação';end if;
 novo:=round(_novo_preco,4);
 if novo=antes.preco_unitario then return;end if;
 if avancado then
  -- O bloqueio do pedido serializa vínculo de carga; títulos/comissões serializam emissão e pagamentos.
  perform 1 from public.contas_receber where pedido_id=p.id order by id for update;
  perform 1 from public.comissoes where pedido_id=p.id order by id for update;
  if exists(select 1 from public.boletos b where b.pedido_id=p.id or b.conta_receber_id in(select id from public.contas_receber where pedido_id=p.id)) then raise exception 'Negociação bloqueada: pedido já possui boleto vinculado';end if;
  if exists(select 1 from public.carga_pedidos where pedido_id=p.id) then raise exception 'Negociação bloqueada: pedido já vinculado a carga';end if;
  perform public.validar_reabertura_289(p.id); -- Só valida; não reabre nem cancela o pedido.
  if exists(select 1 from public.creditos_clientes_aplicacoes where pedido_id=p.id and status='aplicado') then raise exception 'Pedido com crédito aplicado exige acerto financeiro';end if;
  if exists(select 1 from public.comissoes c where c.pedido_id=p.id and public.comissao_comprometida_373(c.id)) then raise exception 'Comissão paga ou agendada exige acerto antes da negociação';end if;
  if exists(select 1 from public.contas_receber where pedido_id=p.id and status<>'cancelado' and (status<>'aberto' or coalesce(valor_pago,0)<>0 or coalesce(juros,0)<>0 or coalesce(multa,0)<>0 or coalesce(acrescimo,0)<>0 or coalesce(desconto,0)<>0)) then raise exception 'Parcelas com recebimento ou ajustes exigem acerto financeiro';end if;
  select count(*),coalesce(sum(valor),0),coalesce(jsonb_agg(jsonb_build_object('id',id,'valor',valor,'parcela',parcela,'vencimento',vencimento) order by parcela,id),'[]') into titulos,soma_titulos,financeiro_antes from public.contas_receber where pedido_id=p.id and status='aberto';
  if (titulos=0 and p.status<>'aprovado') or (titulos>0 and (soma_titulos<=0 or soma_titulos is distinct from p.total_liquido)) then raise exception 'Confira as parcelas do pedido antes da negociação';end if;
  select coalesce(jsonb_agg(to_jsonb(c)),'[]') into comissao_antes from public.comissoes c where c.pedido_id=p.id;
  -- Só o preço é alterado: status, produto, quantidade, desconto e custo histórico são preservados.
  update public.pedido_itens set preco_unitario=novo where id=antes.id;
  perform public.recalcular_pedido(p.id);
  select * into atual from public.pedidos where id=p.id;
  if titulos>0 then
   for titulo in select id,valor from public.contas_receber where pedido_id=p.id and status='aberto' order by parcela,id loop
    posicao:=posicao+1;
    valor_parcela:=case when posicao=titulos then atual.total_liquido-distribuido else round(atual.total_liquido*titulo.valor/soma_titulos,2) end;
    if valor_parcela<=0 then raise exception 'Novo valor incompatível com o parcelamento; revise a forma de pagamento';end if;
    update public.contas_receber set valor=valor_parcela where id=titulo.id;
    distribuido:=distribuido+valor_parcela;
   end loop;
  end if;
  -- Reapuração pelo motor comercial vigente; não reabre comissão paga/agendada.
  update public.comissoes set base_original=greatest(atual.total_itens-coalesce(atual.desconto_valor,0),0),base_calculo=greatest(atual.total_itens-coalesce(atual.desconto_valor,0),0),valor_original=atual.comissao_valor,valor=atual.comissao_valor,percentual=atual.comissao_percentual
   where pedido_id=p.id and status in('prevista','liberada');
  perform public.apurar_comissao_pedido(p.id);
  insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',p.id,'negociar_confirmado_381',auth.uid(),jsonb_build_object('total_anterior',p.total_liquido,'total_novo',atual.total_liquido,'parcelas_antes',financeiro_antes,'parcelas_depois',(select jsonb_agg(jsonb_build_object('id',id,'valor',valor,'parcela',parcela,'vencimento',vencimento) order by parcela,id) from public.contas_receber where pedido_id=p.id and status='aberto'),'comissao_antes',comissao_antes,'comissao_depois',(select jsonb_agg(to_jsonb(c)) from public.comissoes c where c.pedido_id=p.id)));
 else
  perform public.atualizar_item_pedido(_item,antes.quantidade,novo,antes.desconto_percentual);
 end if;
 select * into depois from public.pedido_itens where id=_item;
 if depois.preco_unitario is distinct from novo or depois.quantidade is distinct from antes.quantidade or depois.desconto_percentual is distinct from antes.desconto_percentual then raise exception 'A negociação não foi aplicada integralmente';end if;
 insert into public.pedido_item_precos_381(pedido_id,item_id,produto_id,centro_id,preco_anterior,preco_novo,motivo,usuario_id)
 values(p.id,antes.id,antes.produto_id,p.centro_id,antes.preco_unitario,depois.preco_unitario,btrim(coalesce(_motivo,'')),auth.uid());
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedido_itens',antes.id,'negociar_preco_item_381',auth.uid(),jsonb_build_object('pedido_id',p.id,'preco_anterior',antes.preco_unitario,'preco_novo',depois.preco_unitario,'quantidade',antes.quantidade,'desconto_percentual',antes.desconto_percentual,'motivo',btrim(coalesce(_motivo,''))));
end $$;
revoke all on function public.negociar_preco_item_381(uuid,numeric,numeric,numeric,numeric,text) from public,anon;
grant execute on function public.negociar_preco_item_381(uuid,numeric,numeric,numeric,numeric,text) to authenticated;
-- Edições parciais preservam no banco os campos que o usuário não alterou.
create or replace function public.atualizar_item_pedido_parcial_381(_item_id uuid,_quantidade numeric default null,_preco_unitario numeric default null,_desconto_percentual numeric default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.pedido_itens;
begin
 if auth.uid() is null or not coalesce(public.usuario_ativo(),false) or coalesce(public.complemento_pendente_238(),true) or not coalesce(public.saas_acesso_330(),false) or not coalesce(public.can_operate(auth.uid()),false) then raise exception 'Sem permissão para editar itens';end if;
 if coalesce(_quantidade::text,'') in('NaN','Infinity','-Infinity') or coalesce(_preco_unitario::text,'') in('NaN','Infinity','-Infinity') or coalesce(_desconto_percentual::text,'') in('NaN','Infinity','-Infinity') then raise exception 'Valores inválidos';end if;
 select * into i from public.pedido_itens where id=_item_id for update;
 if i.id is null then raise exception 'Item não encontrado';end if;
 perform public.atualizar_item_pedido(_item_id,coalesce(_quantidade,i.quantidade),coalesce(_preco_unitario,i.preco_unitario),coalesce(_desconto_percentual,i.desconto_percentual));
end $$;
revoke all on function public.atualizar_item_pedido_parcial_381(uuid,numeric,numeric,numeric) from public,anon;
grant execute on function public.atualizar_item_pedido_parcial_381(uuid,numeric,numeric,numeric) to authenticated;
notify pgrst,'reload schema';
commit;
