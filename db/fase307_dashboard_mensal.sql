-- Novas consultas mensais; conserva as RPCs existentes e todas as regras de acesso.
begin;
do $migration$declare r record;d text;n text;origem text;guard text:=E'\n if _mes is not null and (not isfinite(_mes) or _mes<date ''2000-01-01'') then raise exception ''Mês inválido'';end if;\n inicio_307:=date_trunc(''month'',coalesce(_mes,hoje_307))::date;fim_307:=(inicio_307+interval ''1 month'')::date;\n if inicio_307>date_trunc(''month'',hoje_307)::date then raise exception ''Selecione o mês atual ou um mês anterior'';end if;\n';begin
 foreach origem in array array['dashboard_resumo','dashboard_resumo_mod_300','dashboard_rankings','dashboard_rankings_mod_300'] loop
  select prosrc into r from pg_proc where pronamespace='public'::regnamespace and proname=origem;
  if r.prosrc is null then raise exception 'Consulta base % não encontrada',origem;end if;
  d:=regexp_replace(r.prosrc,'\mdeclare\M', 'declare inicio_307 date;fim_307 date;hoje_307 date:=(now() at time zone ''America/Sao_Paulo'')::date;','i');
  d:=regexp_replace(d,'\mbegin\M','begin'||guard,'i');
  if origem like 'dashboard_resumo%' then
   if position('where cr.status in (''aberto'',''parcial'')' in d)=0 or position('where cp.status in (''aberto'',''parcial'')' in d)=0 then raise exception 'Escopo financeiro incompatível';end if;
   d:=replace(d,'where (_centro_id is null or p.centro_id = _centro_id)','where p.tipo_documento=''pedido'' and (_centro_id is null or p.centro_id = _centro_id)');
   d:=replace(d,'where cr.status in (''aberto'',''parcial'')','where cr.status in (''aberto'',''parcial'') and cr.vencimento>=inicio_307 and cr.vencimento<fim_307');
   d:=replace(d,'where cp.status in (''aberto'',''parcial'')','where cp.status in (''aberto'',''parcial'') and cp.vencimento>=inicio_307 and cp.vencimento<fim_307');
   d:=replace(d,'where status in (''rascunho'',''digitacao'',''aguardando_aprovacao'')','where status in (''rascunho'',''digitacao'',''aguardando_aprovacao'') and data_pedido>=inicio_307 and data_pedido<fim_307');
   d:=regexp_replace(d,'where status in \([[:space:]]*''confirmado''','where data_pedido>=inicio_307 and data_pedido<fim_307 and status in (''confirmado''');
   if position('where data_pedido>=inicio_307' in d)=0 then raise exception 'Escopo de vendas incompatível';end if;
   d:=replace(d,'where c.status not in (''cancelada'',''paga'')','where c.status not in (''cancelada'',''paga'') and public.data_comissao_305(p.id)>=inicio_307 and public.data_comissao_305(p.id)<fim_307');
   d:=replace(d,'current_date','hoje_307');
   n:=case when origem='dashboard_resumo' then 'dashboard_resumo_mes_307' else 'dashboard_resumo_mes_307_mod_300' end;
  else
   if position('where v.data_pedido >= coalesce(_de, date_trunc(''month'', current_date)::date)' in d)=0 then raise exception 'Ranking incompatível';end if;
   d:=replace(d,'where v.data_pedido >= coalesce(_de, date_trunc(''month'', current_date)::date)','where v.data_pedido>=inicio_307 and v.data_pedido<fim_307');
   n:=case when origem='dashboard_rankings' then 'dashboard_rankings_mes_307' else 'dashboard_rankings_mes_307_mod_300' end;
  end if;
  d:=replace(d,'return resultado;','return resultado || jsonb_build_object(''mes'',to_char(inicio_307,''YYYY-MM''),''inicio'',inicio_307,''fim'',fim_307-1);');
  execute format('create or replace function public.%I(_centro_id uuid default null,_mes date default null) returns jsonb language plpgsql stable security invoker set search_path=public as %L',n,d);
  execute format('revoke all on function public.%I(uuid,date) from public,anon',n);
  execute format('grant execute on function public.%I(uuid,date) to authenticated',n);
 end loop;
end $migration$;
notify pgrst,'reload schema';
commit;
