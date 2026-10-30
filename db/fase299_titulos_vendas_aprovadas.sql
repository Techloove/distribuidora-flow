-- Indicadores e análise de crédito consideram somente vendas aprovadas.
-- Não remove títulos, pagamentos, boletos ou o histórico financeiro.
begin;
create or replace function public.titulo_elegivel_indicadores_299(_pedido uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select _pedido is null or exists(select 1 from public.pedidos p where p.id=_pedido and p.tipo_documento='pedido' and p.status in('aprovado','confirmado','separacao','separado','conferido','faturado','nf_emitida','em_carga','em_rota','entregue','parcial','nao_entregue','devolvido'));
$$;
revoke all on function public.titulo_elegivel_indicadores_299(uuid) from public,anon,authenticated,service_role;
create or replace function public.titulo_venda_aprovada_299(_pedido uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select public.usuario_ativo() and (_pedido is null or exists(select 1 from public.pedidos p where p.id=_pedido and public.usuario_pode_acessar_centro(p.centro_id) and (not public.escopo_representante() or public.documento_na_minha_carteira('pedidos',p.id)))) and public.titulo_elegivel_indicadores_299(_pedido);
$$;
revoke all on function public.titulo_venda_aprovada_299(uuid) from public,anon;
grant execute on function public.titulo_venda_aprovada_299(uuid) to authenticated;
create or replace view public.vw_contas_receber_efetivas_299 with(security_invoker=true,security_barrier=true) as select cr.* from public.contas_receber cr where public.titulo_venda_aprovada_299(cr.pedido_id);
revoke all on public.vw_contas_receber_efetivas_299 from public,anon;
grant select on public.vw_contas_receber_efetivas_299 to authenticated;
-- Somente motores SECURITY DEFINER já autorizados usam a visão interna: a análise
-- de crédito continua somando dívidas válidas do cliente em todas as lojas.
create or replace view public.contas_receber_efetivas_internas_299 with(security_invoker=true,security_barrier=true) as select cr.* from public.contas_receber cr where public.titulo_elegivel_indicadores_299(cr.pedido_id);
revoke all on public.contas_receber_efetivas_internas_299 from public,anon,authenticated,service_role;
do $$declare r record;d text;alvo text;begin
 for r in select p.oid,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('validar_pedido','dashboard_resumo','dashboard_financeiro','agenda_clientes_228','agenda_titulos_228','agenda_leads_base_229') loop
  d:=pg_get_functiondef(r.oid);
  if position('public.contas_receber' in d)>0 and position('contas_receber_efetivas_' in d)=0 then
   alvo:=case when r.prosecdef then 'public.contas_receber_efetivas_internas_299' else 'public.vw_contas_receber_efetivas_299' end;
   execute replace(d,'public.contas_receber',alvo);
  end if;
 end loop;
end $$;
-- Agregados públicos: mantêm o RLS da tabela e não contam rascunhos como dívida.
do $$declare nome text;d text;begin
 foreach nome in array array['vw_cliente_credito','vw_cobranca_clientes_209','vw_fluxo_previsto'] loop
  select pg_get_viewdef(('public.'||nome)::regclass,true) into d;
  if position('vw_contas_receber_efetivas_299' in d)=0 then
   d:=regexp_replace(d,'\m(public\.)?contas_receber\M','public.vw_contas_receber_efetivas_299','g');
   execute format('create or replace view public.%I with(security_invoker=true) as %s',nome,d);
  end if;
 end loop;
 -- Histórico de títulos permanece visível: somente a classificação muda.
 foreach nome in array array['vw_titulos_receber','vw_cliente_titulos'] loop
  select pg_get_viewdef(('public.'||nome)::regclass,true) into d;
  if position('titulo_venda_aprovada_299' in d)=0 then
   if nome='vw_titulos_receber' then
    d:=replace(d,'WHEN COALESCE(t.valor_pago', 'WHEN NOT public.titulo_venda_aprovada_299(t.pedido_id) THEN ''venda_nao_aprovada''::text WHEN COALESCE(t.valor_pago');
   else
    d:=replace(d,'WHEN cr.vencimento < CURRENT_DATE', 'WHEN NOT public.titulo_venda_aprovada_299(cr.pedido_id) THEN ''venda_nao_aprovada''::text WHEN cr.vencimento < CURRENT_DATE');
   end if;
   execute format('create or replace view public.%I with(security_invoker=true) as select origem.*,public.titulo_venda_aprovada_299(origem.pedido_id) as venda_aprovada from (%s) origem',nome,rtrim(d,'; '||chr(10)));
  end if;
 end loop;
 -- Fluxo de caixa conserva recebimentos reais; apenas a previsão exclui vendas não aprovadas.
 select pg_get_viewdef('public.vw_fluxo_caixa'::regclass,true) into d;
 if position('titulo_venda_aprovada_299' in d)=0 then
  d:=replace(d,'WHEN contas_receber.status <> ALL','WHEN public.titulo_venda_aprovada_299(contas_receber.pedido_id) AND contas_receber.status <> ALL');
  execute 'create or replace view public.vw_fluxo_caixa with(security_invoker=true) as '||d;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
