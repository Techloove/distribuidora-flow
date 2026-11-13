-- Reconsulta tarifas tardias sem repetir recebimentos. Preserva baixa, extrato agrupado e boletos externos.
begin;
do $$begin
 if to_regprocedure('public.sicoob_tarifas_liqui_processar_361(uuid,integer)') is null then raise exception 'Aplique a fase361 antes da fase366';end if;
end $$;
alter table public.boletos add column if not exists sicoob_tarifa_consultada_366 timestamptz;
alter table public.sicoob_liqui_jobs_359 add column if not exists revisao_tarifas_366 boolean not null default false;
-- Zero/ausente não comprova isenção. Revisita os últimos 30 dias, no máximo uma vez a cada seis horas por boleto.
create or replace function public.sicoob_revisar_tarifa_366(b public.boletos) returns boolean
language sql stable set search_path=public as $$
 select b.status='liquidado' and b.sicoob_recebimento_359 is not null
 and (b.sicoob_tarifa_consultada_366 is null or b.sicoob_tarifa_consultada_366<=now()-interval '6 hours')
 and case when b.sicoob_recebimento_359->'tarifa' is null or b.sicoob_recebimento_359->'tarifa'='null'::jsonb then true
  when jsonb_typeof(b.sicoob_recebimento_359->'tarifa')='number' and b.sicoob_recebimento_359->>'tarifa'~'^[0-9]+(\.[0-9]{1,2})?$'
  then (b.sicoob_recebimento_359->>'tarifa')::numeric=0 else false end
 and b.sicoob_recebimento_359->>'dataMovimento' between ((now() at time zone 'America/Sao_Paulo')::date-30)::text and (now() at time zone 'America/Sao_Paulo')::date::text
 and exists(select 1 from sicoob_tarifas_config_355 c where c.centro_id=b.centro_id and c.ativo and b.data_emissao>=c.inicio)
$$;
revoke all on function public.sicoob_revisar_tarifa_366(public.boletos) from public,anon,authenticated,service_role;
create or replace function public.sicoob_liqui_reservar_359(_segredo text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare j sicoob_liqui_jobs_359;r record;ator uuid;primeira date;somente_tarifas boolean;hoje date:=(now() at time zone 'America/Sao_Paulo')::date;begin
 if coalesce(auth.role(),'')<>'service_role' or not exists(select 1 from sicoob_auto_config_358 where id and ativo and segredo=_segredo) then raise exception 'Agendamento não autorizado';end if;
 perform pg_advisory_xact_lock(359,1);
 if exists(select 1 from sicoob_liqui_jobs_359 where lease_ate>now()) then return '{}'::jsonb;end if;
 select x.* into j from sicoob_liqui_jobs_359 x join sicoob_liqui_config_359 c using(centro_id) where c.ativo and x.estado in('solicitar','aguardar','baixar') and x.proxima<=now() order by x.proxima,x.id limit 1 for update of x;
 if j.id is null then
  for r in select c.*,b.versao,b.numero_cliente,b.numero_conta,b.numero_contrato,cc.conta_financeira_id from sicoob_liqui_config_359 c
   join sicoob_config_316 b on b.centro_id=c.centro_id and b.ambiente='producao' and b.ativo and b.autenticado_versao=b.versao
   join cobranca_centros cc on cc.centro_id=c.centro_id and cc.banco='sicoob' and cc.canal='api' and cc.ativo
   where c.ativo and c.proxima_consulta<=now() and cc.conta_financeira_id is not null
   and not exists(select 1 from sicoob_liqui_jobs_359 x where x.centro_id=c.centro_id and x.estado in('solicitar','aguardar','baixar'))
   order by c.proxima_consulta,c.centro_id loop
   select min(case when z.sicoob_recebimento_359 is null then z.data_emissao else (z.sicoob_recebimento_359->>'dataMovimento')::date end) into primeira from boletos z where z.centro_id=r.centro_id and z.banco='sicoob' and z.canal='api' and z.ambiente='producao'
    and z.status in('registrado','liquidado') and z.nosso_numero is not null and (z.sicoob_recebimento_359 is null or public.sicoob_revisar_tarifa_366(z))
    and not exists(select 1 from sicoob_liqui_eventos_359 e where e.boleto_id=z.id and e.estado='conferir')
    and exists(select 1 from sicoob_operacoes_316 o where o.boleto_id=z.id and o.tipo='emissao' and o.estado='confirmado');
   if primeira is null or primeira>hoje then continue;end if;
   somente_tarifas:=not exists(select 1 from boletos z where z.centro_id=r.centro_id and z.banco='sicoob' and z.canal='api' and z.ambiente='producao'
    and z.status in('registrado','liquidado') and z.nosso_numero is not null and z.sicoob_recebimento_359 is null
    and not exists(select 1 from sicoob_liqui_eventos_359 e where e.boleto_id=z.id and e.estado='conferir')
    and exists(select 1 from sicoob_operacoes_316 o where o.boleto_id=z.id and o.tipo='emissao' and o.estado='confirmado'));

   select p.id into ator from profiles p where p.ativo and not coalesce(p.precisa_completar_cadastro,false) and has_role(p.id,'admin') and ator_financeiro_pode_acessar_centro(p.id,r.centro_id) order by p.id limit 1;
   if ator is null then continue;end if;
   insert into sicoob_liqui_jobs_359(centro_id,actor,versao,numero_cliente,numero_conta,contrato,conta_id,inicio,fim,recente,revisao_tarifas_366)
    values(r.centro_id,ator,r.versao,r.numero_cliente,r.numero_conta,r.numero_contrato,r.conta_financeira_id,
     case when somente_tarifas then primeira when r.recente then greatest(primeira,hoje-1) else case when r.cursor is null or r.cursor>hoje then primeira else greatest(primeira,r.cursor) end end,
     case when somente_tarifas then least(primeira+1,hoje) when r.recente then hoje else least(case when r.cursor is null or r.cursor>hoje then primeira else greatest(primeira,r.cursor) end+1,hoje) end,r.recente,somente_tarifas) returning * into j;
   exit;
  end loop;
 end if;
 if j.id is null then return '{}'::jsonb;end if;
 select p.id into ator from profiles p where p.ativo and not coalesce(p.precisa_completar_cadastro,false) and has_role(p.id,'admin') and ator_financeiro_pode_acessar_centro(p.id,j.centro_id) order by p.id limit 1;
 if ator is null then
  update sicoob_liqui_jobs_359 set proxima=now()+interval '15 minutes' where id=j.id;
  update sicoob_liqui_config_359 set erro='SEM_ADMINISTRADOR_AUTORIZADO' where centro_id=j.centro_id;return '{}'::jsonb;
 end if;
 update sicoob_liqui_jobs_359 set actor=ator,lease=gen_random_uuid(),lease_ate=now()+interval '3 minutes' where id=j.id returning * into j;
 return to_jsonb(j);
end $$;
create or replace function public.sicoob_liqui_concluir_359(j public.sicoob_liqui_jobs_359) returns void
language plpgsql security definer set search_path=public as $$begin
 update boletos b set sicoob_tarifa_consultada_366=now() where b.centro_id=j.centro_id and b.banco='sicoob' and b.canal='api' and b.ambiente='producao'
  and b.status='liquidado' and b.conta_cobranca_id=j.conta_id and b.sicoob_recebimento_359->>'dataMovimento' between j.inicio::text and j.fim::text
  and exists(select 1 from sicoob_operacoes_316 o where o.boleto_id=b.id and o.tipo='emissao' and o.estado='confirmado');
 update sicoob_liqui_jobs_359 set estado='concluido',lease=null,lease_ate=null,updated_at=now(),erro=null where id=j.id;
 update sicoob_liqui_config_359 set ultima_consulta=now(),proxima_consulta=date_trunc('minute',now())+interval '5 minutes',erro=null,recente=case when j.revisao_tarifas_366 then recente else not j.recente end,
  cursor=case when j.revisao_tarifas_366 or j.recente then cursor else j.fim+1 end where centro_id=j.centro_id;
end $$;
-- Complementa só a tarifa de um recebimento já validado e idêntico. Nunca chama receber_titulo.
create or replace function public.sicoob_atualizar_tarifa_366(j public.sicoob_liqui_jobs_359,d jsonb) returns boolean
language plpgsql security definer set search_path=public as $$
declare b boletos;e sicoob_liqui_eventos_359;valor numeric;anterior jsonb;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 perform sicoob_liqui_validar_359(j);
 select * into e from sicoob_liqui_eventos_359 where centro_id=j.centro_id and chave=d->>'chave' for update;
 select * into b from boletos where id=e.boleto_id for update;
 if b.id is null or e.estado not in('baixado','repetido') or b.sicoob_recebimento_359 is null
  or e.dados is distinct from b.sicoob_recebimento_359
  or (b.sicoob_recebimento_359-'tarifa') is distinct from (d-'tarifa')
  or b.banco is distinct from 'sicoob' or b.canal is distinct from 'api' or b.ambiente is distinct from 'producao' or b.status is distinct from 'liquidado'
  or b.centro_id is distinct from j.centro_id or b.conta_cobranca_id is distinct from j.conta_id
  or b.seu_numero is distinct from d->>'seuNumero' or ltrim(b.nosso_numero,'0') is distinct from d->>'nossoNumero' or b.codigo_barras is distinct from d->>'codigoBarras'
  or b.sicoob_snapshot_316->>'numero_cliente' is distinct from j.numero_cliente::text or b.sicoob_snapshot_316->>'numero_conta' is distinct from j.numero_conta::text
  or (b.sicoob_snapshot_316->>'numero_contrato')::bigint is distinct from j.contrato
  or b.valor_liquidado is distinct from (d->>'valor')::numeric or b.data_liquidacao is distinct from (d->>'data')::date
  or d->>'dataMovimento' not between j.inicio::text and j.fim::text
  or not exists(select 1 from sicoob_operacoes_316 o where o.boleto_id=b.id and o.tipo='emissao' and o.estado='confirmado')
 then raise exception 'TARIFA_RECEBIMENTO_DIVERGENTE';end if;
 if d->'tarifa' is null or d->'tarifa'='null'::jsonb then return false;end if;
 if jsonb_typeof(d->'tarifa') is distinct from 'number' or coalesce(d->>'tarifa','')!~'^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'TARIFA_VALOR_INVALIDO';end if;
 valor:=(d->>'tarifa')::numeric;
 if valor>999999999999.99 then raise exception 'TARIFA_VALOR_INVALIDO';end if;
 if valor=0 or b.sicoob_recebimento_359->'tarifa'=d->'tarifa' then return false;end if;
 if coalesce((b.sicoob_recebimento_359->>'tarifa')::numeric,0)>0 then raise exception 'TARIFA_ANTERIOR_DIVERGENTE';end if;
 anterior:=b.sicoob_recebimento_359;
 update boletos set sicoob_recebimento_359=d where id=b.id;
 update sicoob_liqui_eventos_359 set dados=d where centro_id=j.centro_id and chave=e.chave;
 insert into auditoria(tabela,registro_id,acao,user_id,detalhe) values('boletos',b.id,'complementar_tarifa_sicoob_366',j.actor,
  jsonb_build_object('chave',e.chave,'tarifa_anterior',anterior->'tarifa','tarifa',valor,'job',j.id));
 return true;
end $$;
revoke all on function public.sicoob_atualizar_tarifa_366(public.sicoob_liqui_jobs_359,jsonb) from public,anon,authenticated,service_role;
create or replace function public.sicoob_liqui_arquivo_359(_job uuid,_lease uuid,_arquivo bigint,_registros jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare j sicoob_liqui_jobs_359;d jsonb;b boletos;estado text;motivo text;novos int:=0;conferir int:=0;ignorados int:=0;atualizadas int:=0;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 select * into j from sicoob_liqui_jobs_359 where id=_job for update;
 if _lease is null or j.lease is distinct from _lease or j.lease_ate<now() or j.estado<>'baixar' or not _arquivo=any(j.arquivos) then raise exception 'Reserva ou arquivo inválido';end if;
 perform sicoob_liqui_validar_359(j);
 if _arquivo=any(j.feitos) then return jsonb_build_object('repetido',true);end if;
 if jsonb_typeof(_registros) is distinct from 'array' or jsonb_array_length(_registros)>10000 then raise exception 'Registros inválidos';end if;
 for d in select value from jsonb_array_elements(_registros) loop
  if (d->>'numeroCliente')::bigint is distinct from j.numero_cliente or (d->>'numeroConta')::bigint is distinct from j.numero_conta then ignorados:=ignorados+1;continue;end if;
  if d->>'chave'!~'^[a-f0-9]{64}$' then raise exception 'Chave inválida';end if;
  if exists(select 1 from sicoob_liqui_eventos_359 where centro_id=j.centro_id and chave=d->>'chave') then
   if exists(select 1 from sicoob_liqui_eventos_359 e where e.centro_id=j.centro_id and e.chave=d->>'chave' and e.estado='conferir') then continue;end if;
   begin
    if public.sicoob_atualizar_tarifa_366(j,d) then atualizadas:=atualizadas+1;end if;
   exception when sqlstate 'P0001' then
    update sicoob_liqui_eventos_359 set estado='conferir',motivo=left(sqlerrm,200) where centro_id=j.centro_id and chave=d->>'chave';
    conferir:=conferir+1;
   end;
   continue;
  end if;
  select * into b from boletos z where z.centro_id=j.centro_id and z.banco='sicoob' and z.canal='api' and z.ambiente='producao'
   and ltrim(z.nosso_numero,'0')=d->>'nossoNumero'
   and exists(select 1 from sicoob_operacoes_316 o where o.boleto_id=z.id and o.tipo='emissao' and o.estado='confirmado') order by z.created_at desc limit 1 for update;
  if b.id is null then ignorados:=ignorados+1;continue;end if;
  estado:='baixado';motivo:=null;
  begin
   if j.contrato is not null and d->>'contratoCobranca' is not null and (d->>'contratoCobranca')::bigint is distinct from j.contrato then raise exception 'CONTRATO_DIVERGENTE';end if;
   estado:=sicoob_liqui_receber_359(j,b.id,d);
  exception when sqlstate 'P0001' then estado:='conferir';motivo:=left(sqlerrm,200);
  end;
  insert into sicoob_liqui_eventos_359(centro_id,chave,boleto_id,dados,estado,motivo) values(j.centro_id,d->>'chave',b.id,d,estado,motivo);
  if estado='baixado' then novos:=novos+1;elsif estado='conferir' then conferir:=conferir+1;end if;
 end loop;
 update sicoob_liqui_jobs_359 set feitos=array_append(feitos,_arquivo),lease=null,lease_ate=null,proxima=now(),erro=null,updated_at=now() where id=j.id returning * into j;
 if cardinality(j.feitos)=cardinality(j.arquivos) then perform sicoob_liqui_concluir_359(j);end if;
 return jsonb_build_object('baixados',novos,'conferir',conferir,'ignorados',ignorados,'tarifasAtualizadas',atualizadas);
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
   and b.status in('registrado','liquidado') and (b.sicoob_recebimento_359 is null or public.sicoob_revisar_tarifa_366(b))
   and exists(select 1 from sicoob_operacoes_316 o where o.boleto_id=b.id and o.tipo='emissao' and o.estado='confirmado')
   and not exists(select 1 from sicoob_liqui_eventos_359 e where e.boleto_id=b.id and e.estado='conferir')))
 then return;end if;
 select segredo into s from sicoob_auto_config_358 where id and ativo;
 if s is null then return;end if;
 perform net.http_post(url:='https://caparaosystem.com.br/api/sicoob/liquidacoes',headers:=jsonb_build_object('X-Sicoob-Automacao',s,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;

revoke all on function public.sicoob_liqui_reservar_359(text),public.sicoob_liqui_concluir_359(public.sicoob_liqui_jobs_359),public.sicoob_liqui_arquivo_359(uuid,uuid,bigint,jsonb),public.sicoob_liqui_disparar_359() from public,anon,authenticated;
grant execute on function public.sicoob_liqui_reservar_359(text),public.sicoob_liqui_arquivo_359(uuid,uuid,bigint,jsonb) to service_role;
-- Apenas torna elegível a leitura normal; mantém falhas/backoffs e reservas em andamento.
update public.sicoob_liqui_config_359 set proxima_consulta=least(proxima_consulta,now()) where ativo and erro is null;
notify pgrst,'reload schema';
commit;
