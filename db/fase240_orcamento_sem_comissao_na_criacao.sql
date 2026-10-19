-- Correção da criação de orçamentos: natureza definida antes dos gatilhos de INSERT.
-- Execute este arquivo inteiro após a fase236. Não apaga comissões nem desativa gatilhos.
begin;
do $$ begin
 if to_regprocedure('public.criar_orcamento_236(uuid,uuid,uuid,uuid,date,date,text,uuid)') is null
 or to_regprocedure('public.criar_pedido_rascunho(uuid,uuid,uuid,uuid,date,text,uuid,date)') is null
 or to_regprocedure('public.apurar_comissao_pedido(uuid)') is null then
  raise exception 'Aplique as fases de pedidos e a fase236 antes da fase240';
 end if;
end $$;

-- Copia o motor atual para uma função PRIVADA, conservando todas as validações
-- instaladas de carteira, centro, cliente, representante, rota e pagamento.
-- A única diferença na gravação é inserir a natureza orçamento e seus metadados.
-- O motor público de pedidos normais e seu OID/ACL permanecem inalterados.
do $$
declare s text; colunas text:='data_pedido, previsao_entrega, observacoes)';
 valores text:='coalesce(_data_pedido,current_date), _previsao_entrega, nullif(_observacoes,''''))';
 novo text;
begin
 select pg_get_functiondef('public.criar_pedido_rascunho(uuid,uuid,uuid,uuid,date,text,uuid,date)'::regprocedure) into s;
 if position('FUNCTION public.criar_pedido_rascunho(' in s)=0
 or (length(s)-length(replace(s,colunas,'')))/length(colunas)<>1
 or (length(s)-length(replace(s,valores,'')))/length(valores)<>1 then
  raise exception 'Motor de criação incompatível com a fase240. Nenhuma alteração aplicada';
 end if;
 s:=replace(s,'FUNCTION public.criar_pedido_rascunho(','FUNCTION public.criar_orcamento_base_240(');
 s:=replace(s,colunas,'data_pedido, previsao_entrega, observacoes, tipo_documento, orcamento_situacao, orcamento_data, orcamento_validade)');
 novo:=$patch$coalesce(_data_pedido,current_date), _previsao_entrega, nullif(_observacoes,''),
 'orcamento', 'negociacao', coalesce(_data_pedido,(now() at time zone 'America/Sao_Paulo')::date),
 greatest(coalesce(_data_pedido,(now() at time zone 'America/Sao_Paulo')::date),(now() at time zone 'America/Sao_Paulo')::date))$patch$;
 s:=replace(s,valores,novo);
 execute s;
end $$;
revoke all on function public.criar_orcamento_base_240(uuid,uuid,uuid,uuid,date,text,uuid,date) from public,anon,authenticated;

-- Reforça a guarda do apurador, inclusive se uma fase antiga a tiver sobrescrito.
-- Preserva o restante do apurador atual, incluindo comissões pagas/devoluções.
do $$ declare s text;begin
 select pg_get_functiondef('public.apurar_comissao_pedido(uuid)'::regprocedure) into s;
 if position('orcamento_comissao_236' in s)=0 and position('orcamento_comissao_240' in s)=0 then
  if s!~*'\mbegin\M' then raise exception 'Apurador de comissão incompatível com a fase240';end if;
  s:=regexp_replace(s,'\mbegin\M',$patch$begin
 -- orcamento_comissao_240
 if exists(select 1 from public.pedidos q240 where q240.id=_pedido_id and q240.tipo_documento='orcamento') then return;end if;
 $patch$,'i');execute s;
 end if;
end $$;

-- Conserva assinatura, OID, ACL e todas as validações do endpoint de orçamentos.
-- Não remove a proteção que acusa uma comissão indevida: elimina sua causa.
do $$ declare s text;begin
 select pg_get_functiondef('public.criar_orcamento_236(uuid,uuid,uuid,uuid,date,date,text,uuid)'::regprocedure) into s;
 if position('public.criar_pedido_rascunho(' in s)>0 then
  s:=replace(s,'public.criar_pedido_rascunho(','public.criar_orcamento_base_240(');execute s;
 elsif position('public.criar_orcamento_base_240(' in s)=0 then
  raise exception 'Criação de orçamento incompatível com a fase240';
 end if;
end $$;
notify pgrst,'reload schema';
commit;
