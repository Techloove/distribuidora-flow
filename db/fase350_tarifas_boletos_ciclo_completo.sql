-- Coleta de todas as tarifas de boletos desde a emissão, inclusive baixados/cancelados.
begin;
create or replace function public.sicredi_despesa_identificada_347(_descricao text) returns boolean
language sql immutable set search_path=public as $$
 select coalesce(upper(_descricao) ~ '\m(TARIFA|TARIFAS|TAXA|TAXAS|DESPESA|DESPESAS|CUSTA|CUSTAS|EMOLUMENTO|EMOLUMENTOS)\M'
 and upper(_descricao) !~ '^[[:space:]]*(ESTORNO|ESTORNADO|ESTORNADA|DEVOLUÇÃO|DEVOLUCAO)\M'
 and upper(_descricao) !~ '\m(ESTORNADO|ESTORNADA)\M',false)
$$;
revoke all on function public.sicredi_despesa_identificada_347(text) from public,anon,authenticated,service_role;
create or replace function public.sicredi_tarifas_reservar_280(_segredo text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare cfg public.sicredi_auto_config_247;c public.sicredi_config;f public.sicredi_tarifas_fila_280;
 chave uuid:=gen_random_uuid();hoje date:=(now() at time zone 'America/Sao_Paulo')::date;inicio date;primeiro date;ultimo date;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 select * into cfg from public.sicredi_auto_config_247 where id;
 if _segredo is null or _segredo is distinct from cfg.segredo then raise exception 'Agendamento não autorizado';end if;
 if not coalesce(cfg.ativo,false) then return '{}'::jsonb;end if;
 perform pg_advisory_xact_lock(hashtext('sicredi-tarifas-280'));
 if exists(select 1 from public.sicredi_tarifas_fila_280 where lease_ate>now()) then return '{}'::jsonb;end if;
 if (select count(*) from public.sicredi_config)<>1 then return '{}'::jsonb;end if;
 select * into c from public.sicredi_config limit 1;
 if c.ambiente is distinct from 'producao' or nullif(c.cooperativa,'') is null or nullif(c.posto,'') is null
 or nullif(c.codigo_beneficiario,'') is null then return '{}'::jsonb;end if;
 select min(b.data_emissao) into inicio from public.boletos b
 where b.banco='sicredi' and b.canal='api' and b.ambiente='producao'
 and b.cooperativa=c.cooperativa and b.posto=c.posto and b.codigo_beneficiario=c.codigo_beneficiario;
 if inicio is null then return '{}'::jsonb;end if;
 -- Acrescenta apenas os intervalos ausentes, em vez de reinserir todo o histórico a cada ciclo.
 select min(dia),max(dia) into primeiro,ultimo from public.sicredi_tarifas_fila_280 where cooperativa=c.cooperativa and posto=c.posto and beneficiario=c.codigo_beneficiario;
 if primeiro is null then
  insert into public.sicredi_tarifas_fila_280(cooperativa,posto,beneficiario,dia)
  select c.cooperativa,c.posto,c.codigo_beneficiario,d::date from generate_series(inicio,hoje,interval '1 day') d on conflict do nothing;
 else
  insert into public.sicredi_tarifas_fila_280(cooperativa,posto,beneficiario,dia)
  select c.cooperativa,c.posto,c.codigo_beneficiario,d::date from generate_series(inicio,primeiro-1,interval '1 day') d on conflict do nothing;
  insert into public.sicredi_tarifas_fila_280(cooperativa,posto,beneficiario,dia)
  select c.cooperativa,c.posto,c.codigo_beneficiario,d::date from generate_series(ultimo+1,hoje,interval '1 day') d on conflict do nothing;
 end if;
 select * into f from public.sicredi_tarifas_fila_280
 where cooperativa=c.cooperativa and posto=c.posto and beneficiario=c.codigo_beneficiario
 and dia between inicio and hoje and proxima_consulta<=now() and coalesce(lease_ate,'epoch')<=now()
 order by case when dia=hoje then 0 when dia>=hoje-7 then 1 when consultado_em is null then 2 else 3 end,proxima_consulta,dia desc limit 1 for update skip locked;
 if not found then return '{}'::jsonb;end if;
 update public.sicredi_tarifas_fila_280 set lease=chave,lease_ate=now()+interval '3 minutes'
 where cooperativa=f.cooperativa and posto=f.posto and beneficiario=f.beneficiario and dia=f.dia;
 return jsonb_build_object('lease',chave,'dia',f.dia,'cooperativa',f.cooperativa,'posto',f.posto,'beneficiario',f.beneficiario);
end $$;
revoke all on function public.sicredi_tarifas_reservar_280(text) from public,anon,authenticated;
grant execute on function public.sicredi_tarifas_reservar_280(text) to service_role;

do $$declare d text;alvo text:='case when dia>=hoje-7 then interval ''6 hours'' else interval ''7 days'' end';begin
 select pg_get_functiondef('public.sicredi_tarifas_finalizar_280(uuid,jsonb,text)'::regprocedure) into d;
 if position(alvo in d)>0 then
  d:=replace(d,alvo,'case when dia=hoje then interval ''10 minutes'' when dia>=hoje-7 then interval ''30 minutes'' else interval ''7 days'' end');
  execute d;
 elsif position('interval ''10 minutes''' in d)=0 then raise exception 'Revise a espera das tarifas antes da fase350';end if;
 -- Só percorre boletos mencionados no retorno ou com cache anterior daquele dia a reconciliar.
 select pg_get_functiondef('public.sicredi_tarifas_finalizar_280(uuid,jsonb,text)'::regprocedure) into d;
 if position('cache_relevante_350' in d)=0 then
  if position('  for share loop' in d)=0 then raise exception 'Revise a seleção do cache antes da fase350';end if;
  execute replace(d,'  for share loop',
  $patch$  and (exists(select 1 from jsonb_array_elements(_movimentos) mv where ltrim(mv->>'nosso_numero','0')=ltrim(b3.nosso_numero,'0'))
   or exists(select 1 from public.sicredi_tarifas_api_280 cache_relevante_350 where cache_relevante_350.boleto_id=b3.id and cache_relevante_350.data_lancamento=f.dia))
  for share loop$patch$);
 end if;
end $$;
-- Reagenda a coleta recente sem tocar no cache bancário, reservas ou lançamentos.
update public.sicredi_tarifas_fila_280 set proxima_consulta=least(proxima_consulta,coalesce(consultado_em,'epoch'::timestamptz)+
 case when dia=(now() at time zone 'America/Sao_Paulo')::date then interval '10 minutes' else interval '30 minutes' end)
 where dia>=(now() at time zone 'America/Sao_Paulo')::date-7 and erro is null;
-- Inclui na nova conferência datas cujo cache pode conter tarifas antes excluídas pela descrição.
update public.sicredi_tarifas_fila_280 f set proxima_consulta=least(f.proxima_consulta,now())
 where exists(select 1 from public.sicredi_tarifas_api_280 s join public.boletos b on b.id=s.boleto_id
 where s.data_lancamento=f.dia and b.cooperativa=f.cooperativa and b.posto=f.posto and b.codigo_beneficiario=f.beneficiario
 and s.tarifa_total is distinct from (select coalesce(sum((d->>'valor')::numeric),0) from jsonb_array_elements(s.debitos) d where public.sicredi_despesa_identificada_347(d->>'descricao')));
do $$declare j bigint;begin
 select jobid into j from cron.job where jobname='sicredi-tarifas-api-280';
 if j is null then raise exception 'Agendamento de tarifas ausente';end if;
 perform cron.alter_job(j,schedule:='*/5 * * * *');
end $$;
notify pgrst,'reload schema';
commit;
