-- Menor espera para identificar pagamentos. Não cria baixa por suposição nem muda limites do extrato.
begin;
do $$begin
 if to_regclass('public.sicoob_confirmacao_instalada_362') is null then raise exception 'Aplique a fase362 antes da fase363';end if;
end $$;
create or replace function public.sicoob_auto_finalizar_358(_lease uuid,_boleto uuid,_banco jsonb default null,_diagnostico jsonb default null,_erro text default null) returns void
language plpgsql security definer set search_path=public as $$
declare f sicoob_auto_fila_358;b boletos;c sicoob_config_316;mudou boolean;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 select * into b from boletos where id=_boleto for update;
 select * into f from sicoob_auto_fila_358 where boleto_id=_boleto for update;
 if f.lease is distinct from _lease or _lease is null or f.lease_ate<now() then raise exception 'Reserva expirada';end if;
 if _erro is not null then
  update sicoob_auto_fila_358 set ultima_consulta=now(),resultado=left(_erro,60),diagnostico=coalesce(_diagnostico,diagnostico),erros=erros+1,
    proxima_consulta=now()+least(240,(case when b.status='em_processamento' then 5 else 15 end)*(erros+1))*interval '1 minute',lease=null,lease_ate=null where boleto_id=_boleto;return;
 end if;
 perform validar_sicoob_316(f.actor,b.centro_id);
 select * into c from sicoob_config_316 where centro_id=b.centro_id and ambiente='producao' for share;
 if not coalesce(c.ativo,false) or c.versao is distinct from f.config_versao
  or c.numero_cliente is distinct from (b.sicoob_snapshot_316->>'numero_cliente')::bigint
  or c.numero_conta is distinct from (b.sicoob_snapshot_316->>'numero_conta')::bigint
  or c.numero_contrato is distinct from (b.sicoob_snapshot_316->>'numero_contrato')::bigint
  or not exists(select 1 from cobranca_centros where centro_id=b.centro_id and banco='sicoob' and canal='api' and ativo)
  then raise exception 'Configuração ou convênio mudou';end if;
 if b.banco<>'sicoob' or b.canal<>'api' or b.ambiente<>'producao' then raise exception 'Boleto divergente';end if;
 if b.nosso_numero is null or b.nosso_numero='' then
  if b.status is distinct from 'em_processamento' or not exists(select 1 from sicoob_operacoes_316 o
   where o.id=b.sicoob_pendente_316 and o.boleto_id=b.id and o.centro_id=b.centro_id and o.tipo='emissao' and o.estado in('enviado','incerto')
   and o.requisicao->>'seuNumero'=b.seu_numero and (o.requisicao->>'valor')::numeric=b.valor)
  then raise exception 'Emissão pendente não autorizada para recuperação';end if;
 elsif b.nosso_numero is distinct from (_banco->>'nossoNumero') then raise exception 'Boleto divergente';end if;
 -- A sincronização existente valida modalidade, identidade, valor e códigos e impede regressão de estados terminais.
 mudou:=b.retorno is distinct from _banco or b.sicoob_pendente_316 is not null;
 if mudou then perform sicoob_sincronizar_316(f.actor,b.id,_banco);end if;
 update sicoob_auto_fila_358 set ultima_consulta=now(),resultado=_banco->>'situacao',erros=0,
   diagnostico=_diagnostico,proxima_consulta=date_trunc('minute',now())+case when _banco->>'situacao'='EM ABERTO' then interval '5 minutes' else interval '6 hours' end,
   lease=null,lease_ate=null where boleto_id=_boleto;
end $$;
create or replace function public.sicoob_liqui_concluir_359(j public.sicoob_liqui_jobs_359) returns void
language plpgsql security definer set search_path=public as $$begin
 update sicoob_liqui_jobs_359 set estado='concluido',lease=null,lease_ate=null,updated_at=now(),erro=null where id=j.id;
 update sicoob_liqui_config_359 set ultima_consulta=now(),proxima_consulta=date_trunc('minute',now())+interval '5 minutes',erro=null,recente=not j.recente,
  cursor=case when j.recente then cursor else j.fim+1 end where centro_id=j.centro_id;
end $$;
create or replace function public.sicoob_liqui_etapa_359(_job uuid,_lease uuid,_acao text,_dados jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare j sicoob_liqui_jobs_359;ids bigint[];v record;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 select * into j from sicoob_liqui_jobs_359 where id=_job for update;
 if _lease is null or j.lease is distinct from _lease or j.lease_ate<now() then raise exception 'Reserva expirada';end if;
 if _acao='erro' then
  update sicoob_liqui_jobs_359 set estado=case when _dados->>'codigo'='CONFIG_ALTERADA' then 'conferir' else estado end,erros=erros+1,erro=left(_dados->>'codigo',80),diagnostico=_dados->'diagnostico',proxima=now()+least(240,5*(erros+1))*interval '1 minute',lease=null,lease_ate=null,updated_at=now() where id=j.id;
  update sicoob_liqui_config_359 set erro=left(_dados->>'codigo',80),proxima_consulta=now()+interval '5 minutes' where centro_id=j.centro_id;
  return '{}';
 end if;
 perform sicoob_liqui_validar_359(j);
 if _acao='solicitacao' and j.estado='solicitar' and (_dados->>'codigo')~'^[1-9][0-9]{0,14}$' then
  update sicoob_liqui_jobs_359 set codigo=(_dados->>'codigo')::bigint,estado='aguardar',proxima=date_trunc('minute',now())+interval '1 minute',lease=null,lease_ate=null,updated_at=now(),erro=null where id=j.id;
 elsif _acao='aguardar' and j.estado='aguardar' then
  update sicoob_liqui_jobs_359 set proxima=date_trunc('minute',now())+interval '1 minute',lease=null,lease_ate=null,updated_at=now() where id=j.id;
 elsif _acao='arquivos' and j.estado='aguardar' and jsonb_typeof(_dados->'ids')='array' and jsonb_array_length(_dados->'ids')<=20 then
  for v in select value #>> '{}' as id from jsonb_array_elements(_dados->'ids') loop
   if v.id!~'^[1-9][0-9]{0,14}$' then raise exception 'Arquivo inválido';end if;
  end loop;
  select coalesce(array_agg((value #>> '{}')::bigint),'{}'::bigint[]) into ids from jsonb_array_elements(_dados->'ids');
  if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'Arquivos duplicados';end if;
  update sicoob_liqui_jobs_359 set arquivos=ids,estado='baixar',proxima=now(),lease=null,lease_ate=null,updated_at=now(),erro=null where id=j.id;
  if cardinality(ids)=0 then perform sicoob_liqui_concluir_359(j);end if;
 else raise exception 'Etapa inválida';end if;
 return '{}';
end $$;
create or replace function public.sicoob_auto_status_358(_actor uuid,_centro uuid) returns jsonb
language plpgsql security definer set search_path=public as $$begin
 perform validar_sicoob_316(_actor,_centro);
 return jsonb_build_object('intervaloAbertoMinutos',5,'intervaloLiquiMinutos',1,'ativo',(select ativo from sicoob_auto_config_358 where id),
 'ultimaConsulta',(select max(f.ultima_consulta) from sicoob_auto_fila_358 f join boletos b on b.id=f.boleto_id where b.centro_id=_centro),
 'falhas',(select count(*) from sicoob_auto_fila_358 f join boletos b on b.id=f.boleto_id where b.centro_id=_centro and f.erros>0),
 'baixarFinanceiro',exists(select 1 from sicoob_liqui_config_359 l join cobranca_centros cc using(centro_id) join sicoob_config_316 c using(centro_id) where l.centro_id=_centro and l.ativo and cc.banco='sicoob' and cc.canal='api' and cc.ativo and c.ambiente='producao' and c.ativo and c.autenticado_versao=c.versao and exists(select 1 from sicoob_auto_config_358 where id and ativo)),
 'ultimaLiqui',(select ultima_consulta from sicoob_liqui_config_359 where centro_id=_centro),
 'erroLiqui',(select erro from sicoob_liqui_config_359 where centro_id=_centro),
 'pendenciasLiqui',(select count(*) from sicoob_liqui_eventos_359 where centro_id=_centro and estado='conferir'));
end $$;
create or replace function public.sicoob_liqui_disparar_359() returns void
language plpgsql security definer set search_path=public as $$declare s text;begin
 if not exists(select 1 from sicoob_liqui_config_359 where ativo) then return;end if;
 if exists(select 1 from sicoob_liqui_jobs_359 where lease_ate>now()) then return;end if;
 if not exists(select 1 from sicoob_liqui_jobs_359 j join sicoob_liqui_config_359 c using(centro_id)
  where c.ativo and j.estado in('solicitar','aguardar','baixar') and j.proxima<=now())
 and not exists(select 1 from sicoob_liqui_config_359 c where c.ativo and c.proxima_consulta<=now()
  and not exists(select 1 from sicoob_liqui_jobs_359 j where j.centro_id=c.centro_id and j.estado in('solicitar','aguardar','baixar'))
  and exists(select 1 from boletos b where b.centro_id=c.centro_id and b.banco='sicoob' and b.canal='api' and b.ambiente='producao'
   and b.status in('registrado','liquidado') and b.sicoob_recebimento_359 is null
   and exists(select 1 from sicoob_operacoes_316 o where o.boleto_id=b.id and o.tipo='emissao' and o.estado='confirmado')
   and not exists(select 1 from sicoob_liqui_eventos_359 e where e.boleto_id=b.id and e.estado='conferir')))
 then return;end if;
 select segredo into s from sicoob_auto_config_358 where id and ativo;
 if s is null then return;end if;
 perform net.http_post(url:='https://caparaosystem.com.br/api/sicoob/liquidacoes',headers:=jsonb_build_object('X-Sicoob-Automacao',s,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;

-- Altera somente o cron LIQUI já existente, preservando sua ativação e as credenciais.
do $$declare ident bigint;begin
 select jobid into ident from cron.job where jobname='sicoob-liqui-359';
 if ident is null then raise exception 'Agendamento LIQUI359 não encontrado';end if;
 perform cron.alter_job(job_id:=ident,schedule:='* * * * *');
end $$;
-- Antecipa apenas trabalho normal ou a resposta exata de consulta sem registros já identificada.
-- Preserva leases, recusas, configurações pausadas e backoffs dos demais erros.
update public.sicoob_liqui_jobs_359 set proxima=least(proxima,now())
 where estado in('solicitar','aguardar','baixar') and coalesce(lease_ate,'epoch'::timestamptz)<=now()
 and (erro is null or (estado='aguardar' and erro='HTTP_400' and diagnostico#>>'{respostaHttp,motivo}'='[5002] Solicitação não retornou nenhum registro.'));
update public.sicoob_liqui_config_359 set proxima_consulta=least(proxima_consulta,now()) where ativo and erro is null;
update public.sicoob_auto_fila_358 f set proxima_consulta=least(f.proxima_consulta,now())
 from public.boletos b where b.id=f.boleto_id and b.banco='sicoob' and b.canal='api' and b.ambiente='producao'
 and b.status='registrado' and f.erros=0 and coalesce(f.lease_ate,'epoch'::timestamptz)<=now();
notify pgrst,'reload schema';
commit;
