CREATE OR REPLACE FUNCTION public.decidir_orcamento_236(_pedido uuid, _acao text, _motivo text DEFAULT NULL::text)
 RETURNS pedidos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p public.pedidos;antes public.pedidos;validacoes jsonb;bloqueios jsonb;
begin
 if not public.orcamento_acessivel_236(_pedido) then raise exception 'Orçamento sem acesso';end if;
 select * into antes from public.pedidos where id=_pedido for update;
 -- Serializa decisões para o mesmo cliente e impede troca de carteira durante a análise.
 perform 1 from public.clientes where id=antes.cliente_id for update;
 p:=public.decidir_orcamento_base_241(_pedido,_acao,_motivo);
 -- Repetir aceite retorna a decisão original, sem tentar aprovar novamente nem duplicar reservas.
 if _acao<>'aceitar' or antes.tipo_documento<>'orcamento' then return p;end if;
 validacoes:=public.validar_pedido(_pedido);
 if validacoes is null or jsonb_typeof(validacoes)<>'array' then raise exception 'Não foi possível validar o pedido para aprovação automática';end if;
 select coalesce(jsonb_agg(v),'[]'::jsonb) into bloqueios from jsonb_array_elements(validacoes) v where v->>'nivel'='bloqueio';
 if jsonb_array_length(bloqueios)=0 then
  begin
   insert into public.orcamento_contexto_aprovacao_241(pedido_id,usuario_id,transacao) values(_pedido,auth.uid(),txid_current());
   update public.pedidos set status='aprovado',aprovacao_automatica_em=clock_timestamp(),aprovacao_automatica_motivos='[]'::jsonb where id=_pedido returning * into p;
   delete from public.orcamento_contexto_aprovacao_241 where pedido_id=_pedido;
   insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',_pedido,'aprovar_orcamento_automaticamente_241',auth.uid(),jsonb_build_object('origem','aceite_orcamento','validacoes',validacoes));
  exception when sqlstate 'P0001' then
   -- A insuficiência é verificada com bloqueio físico pelo motor de reserva.
   -- Somente essa condição operacional fica pendente; erros inesperados abortam.
   if sqlerrm not like 'Estoque disponível insuficiente para reservar produto%' then raise;end if;
   bloqueios:=jsonb_build_array(jsonb_build_object('nivel','bloqueio','mensagem','Estoque disponível insuficiente para reservar os itens. A gestão deve revisar a disponibilidade.'));
  end;
 end if;
 if jsonb_array_length(bloqueios)>0 then
  update public.pedidos set aprovacao_automatica_em=null,aprovacao_automatica_motivos=bloqueios where id=_pedido returning * into p;
  insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',_pedido,'orcamento_requer_aprovacao_241',auth.uid(),jsonb_build_object('bloqueios',bloqueios));
 end if;
 return p;
end $function$;
CREATE OR REPLACE FUNCTION public.impedir_efeito_orcamento_236()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pid236 uuid;
begin
 if tg_table_name='estoque_movimentos' then
  if new.origem<>'pedido' then return new; end if; pid236:=new.documento_id;
 else pid236:=new.pedido_id; end if;
 perform 1 from public.pedidos where id=pid236 and tipo_documento='orcamento' for share;
 if found then raise exception 'Orçamento não gera reserva, saída de estoque, título, comissão, crédito aplicado ou entrega'; end if;
 return new;
end $function$;
CREATE OR REPLACE FUNCTION public.orcamento_acessivel_236(_pedido uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 select public.usuario_ativo() and public.can_operate(auth.uid()) and public.pode_rotina('pedidos_orcamentos') and exists(
  select 1 from public.pedidos q236 where q236.id=_pedido and public.usuario_pode_acessar_centro(q236.centro_id)
   and (not public.escopo_representante() or public.documento_na_minha_carteira('pedidos',q236.id))
 );
$function$;
CREATE OR REPLACE FUNCTION public.proteger_orcamento_236()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p236 public.pedidos; pid236 uuid; hoje236 date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if tg_table_name='pedido_itens' then
  pid236:=case when tg_op='DELETE' then old.pedido_id else new.pedido_id end;
  select * into p236 from public.pedidos where id=pid236 and tipo_documento='orcamento' for update;
  if tg_op='UPDATE' and old.pedido_id is distinct from new.pedido_id and exists(select 1 from public.pedidos where id=old.pedido_id and tipo_documento='orcamento') then raise exception 'Não transfira itens de orçamento para outro documento'; end if;
  if p236.tipo_documento='orcamento' then
   perform 1 from public.clientes where id=p236.cliente_id for share;
   if not public.orcamento_acessivel_236(p236.id) then raise exception 'Orçamento sem acesso'; end if;
   if p236.orcamento_situacao<>'negociacao' or p236.orcamento_validade<hoje236 then raise exception 'Revise a validade e reabra o orçamento antes de editar os itens'; end if;
  end if;
  return coalesce(new,old);
 end if;
 if new.tipo_documento<>'orcamento' and old.tipo_documento<>'orcamento' then return new; end if;
 perform 1 from public.clientes where id=old.cliente_id for share;
 if not public.orcamento_acessivel_236(old.id) then raise exception 'Orçamento sem acesso'; end if;
 if new.cliente_id is distinct from old.cliente_id or new.representante_id is distinct from old.representante_id or new.centro_id is distinct from old.centro_id then raise exception 'Não altere cliente, representante ou centro de um orçamento'; end if;
 if new.tipo_documento='orcamento' then
  if new.status<>'rascunho' then raise exception 'Registre o aceite e converta o orçamento antes de avançar o pedido'; end if;
  if new.orcamento_data is null or new.orcamento_validade is null or new.orcamento_validade<new.orcamento_data or new.orcamento_situacao is null then raise exception 'Informe data, validade e situação do orçamento'; end if;
  if old.tipo_documento='orcamento' and (old.orcamento_situacao<>'negociacao' or old.orcamento_validade<hoje236) then
   if not (new.orcamento_situacao='negociacao' and new.orcamento_validade>=hoje236
     and (to_jsonb(new)-array['updated_at','orcamento_situacao','orcamento_validade','orcamento_motivo','orcamento_encerrado_em','observacoes'])
       =(to_jsonb(old)-array['updated_at','orcamento_situacao','orcamento_validade','orcamento_motivo','orcamento_encerrado_em','observacoes'])) then
    raise exception 'Revise a validade e reabra o orçamento antes de alterar a proposta';
   end if;
  end if;
 else
  if old.orcamento_situacao<>'negociacao' or old.orcamento_validade<hoje236 or new.orcamento_situacao<>'aceito' or new.orcamento_aceito_em is null then raise exception 'Orçamento precisa estar válido e aceito pelo cliente para conversão'; end if;
 end if;
 return new;
end $function$;
CREATE OR REPLACE FUNCTION public.decidir_orcamento_base_241(_pedido uuid, _acao text, _motivo text DEFAULT NULL::text)
 RETURNS pedidos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p236 public.pedidos; hoje236 date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if not public.orcamento_acessivel_236(_pedido) then raise exception 'Orçamento sem acesso'; end if;
 select * into p236 from public.pedidos where id=_pedido for update;
 perform 1 from public.clientes where id=p236.cliente_id for share;
 if not public.orcamento_acessivel_236(_pedido) then raise exception 'Orçamento sem acesso'; end if;
 if _acao is null or _acao not in ('aceitar','recusar') or length(coalesce(_motivo,''))>1000 then raise exception 'Decisão inválida'; end if;
 if _acao='aceitar' and p236.tipo_documento='pedido' and p236.orcamento_situacao='aceito' then return p236; end if;
 if p236.tipo_documento<>'orcamento' or p236.status<>'rascunho' then raise exception 'Documento não é orçamento em negociação'; end if;
 if _acao='recusar' then
  if nullif(trim(_motivo),'') is null then raise exception 'Informe o motivo da não aprovação pelo cliente'; end if;
  if p236.orcamento_situacao='recusado' and p236.orcamento_motivo=trim(_motivo) then return p236; end if;
  if p236.orcamento_situacao<>'negociacao' or p236.orcamento_validade<hoje236 then raise exception 'Revise e reabra o orçamento antes de registrar uma nova decisão'; end if;
  update public.pedidos set orcamento_situacao='recusado',orcamento_motivo=trim(_motivo),orcamento_encerrado_em=now() where id=_pedido returning * into p236;
 else
  if p236.orcamento_situacao<>'negociacao' or p236.orcamento_validade<hoje236 then raise exception 'Orçamento vencido ou encerrado. Revise a validade antes do aceite'; end if;
  if not exists(select 1 from public.pedido_itens where pedido_id=_pedido) or coalesce(p236.total_liquido,0)<=0 then raise exception 'Inclua os itens e valores da proposta antes do aceite'; end if;
  update public.pedidos set tipo_documento='pedido',orcamento_situacao='aceito',orcamento_aceito_em=now(),orcamento_encerrado_em=now(),data_pedido=hoje236 where id=_pedido;
  -- Aceite comercial não é aprovação interna. Não chama confirmar_pedido.
  p236:=public.avancar_pedido(_pedido,'aguardando_aprovacao');
 end if;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',_pedido,'orcamento_'||_acao||'_236',auth.uid(),jsonb_build_object('motivo',_motivo,'status',p236.status,'data_pedido',p236.data_pedido));
 return p236;
end $function$;
