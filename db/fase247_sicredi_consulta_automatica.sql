-- Consulta bancária automática. Execute inteiro e publique o código no Lovable.
begin;
do $$begin
 if to_regprocedure('public.sicredi_liquidar_api_224(uuid,uuid,jsonb)') is null then raise exception 'Aplique as fases224 e237 antes da fase247';end if;
end $$;
create table if not exists public.sicredi_auto_config_247(
 id bool primary key default true check(id),ativo bool not null default true,
 endpoint text not null default 'https://caparaosystem.lovable.app/api/sicredi/sincronizar',
 segredo text not null default (replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','')),
 ultima_chamada timestamptz,bloqueado_ate timestamptz
);
insert into public.sicredi_auto_config_247(id) values(true) on conflict do nothing;
create table if not exists public.sicredi_auto_fila_247(
 boleto_id uuid primary key references public.boletos(id) on delete cascade,
 proxima_consulta timestamptz not null default now(),lease uuid,lease_ate timestamptz,actor uuid references public.profiles(id),
 ultima_consulta timestamptz,resultado text,erro text
);
alter table public.sicredi_auto_config_247 enable row level security;
alter table public.sicredi_auto_fila_247 enable row level security;
revoke all on public.sicredi_auto_config_247,public.sicredi_auto_fila_247 from public,anon,authenticated;
grant all on public.sicredi_auto_config_247,public.sicredi_auto_fila_247 to service_role;
create or replace function public.sicredi_auto_reservar_247(_segredo text) returns jsonb
language plpgsql security definer set search_path=public as $$declare cfg public.sicredi_auto_config_247;r record;responsavel uuid;outros jsonb:='[]';chave uuid:=gen_random_uuid();begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 select * into cfg from public.sicredi_auto_config_247 where id for update;
 if _segredo is null or _segredo is distinct from cfg.segredo then raise exception 'Agendamento não autorizado';end if;
 if not cfg.ativo or cfg.bloqueado_ate>now() then return jsonb_build_object('itens','[]'::jsonb);end if;
 update public.sicredi_auto_config_247 set ultima_chamada=now(),bloqueado_ate=now()+interval '90 seconds' where id;
 for r in select b.* from public.boletos b left join public.sicredi_auto_fila_247 f on f.boleto_id=b.id
  where b.banco='sicredi' and b.canal='api' and b.ambiente='producao' and b.status='registrado' and nullif(b.nosso_numero,'') is not null
  and coalesce(f.proxima_consulta,'epoch'::timestamptz)<=now() and coalesce(f.lease_ate,'epoch'::timestamptz)<=now()
  order by coalesce(f.proxima_consulta,'epoch'::timestamptz),b.id limit 10 for update of b skip locked loop
  select p.id into responsavel from public.profiles p where p.ativo and public.has_role(p.id,'admin') and public.ator_financeiro_pode_acessar_centro(p.id,r.centro_id) order by p.id limit 1;
  insert into public.sicredi_auto_fila_247(boleto_id,lease,lease_ate,actor) values(r.id,chave,now()+interval '3 minutes',responsavel)
   on conflict(boleto_id) do update set lease=excluded.lease,lease_ate=excluded.lease_ate,actor=excluded.actor;
  outros:=outros||jsonb_build_object('id',r.id,'nosso_numero',r.nosso_numero,'cooperativa',r.cooperativa,'posto',r.posto,'codigo_beneficiario',r.codigo_beneficiario,'responsavel',responsavel);
 end loop;
 return jsonb_build_object('lease',chave,'itens',outros);
end $$;
revoke all on function public.sicredi_auto_reservar_247(text) from public,anon,authenticated;
grant execute on function public.sicredi_auto_reservar_247(text) to service_role;
create or replace function public.sicredi_auto_finalizar_247(_lease uuid,_boleto uuid,_situacao text,_dados jsonb default null) returns text
language plpgsql security definer set search_path=public as $$declare f public.sicredi_auto_fila_247;b public.boletos;estado text;falha text;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 -- Mesma ordem do bloqueio da consulta manual e do reservador: boleto antes da fila.
 select * into b from public.boletos where id=_boleto for update;
 select * into f from public.sicredi_auto_fila_247 where boleto_id=_boleto for update;
 if f.lease is distinct from _lease or _lease is null or f.lease_ate<now() then raise exception 'Reserva expirada';end if;
 estado:=_situacao;
 if b.status='liquidado' then estado:='ja_processado';
 elsif b.status in ('baixado','cancelado') then
  if _situacao='liquidado' then estado:='conferencia';falha:='SITUACAO_DIVERGENTE';else estado:='ja_processado';end if;
 elsif _situacao in ('liquidado','baixado') then
  begin
   if f.actor is null then raise exception 'Sem responsável financeiro';end if;
   if _situacao='liquidado' then
    perform public.sicredi_liquidar_api_224(f.actor,b.id,_dados);
   else
    perform public.sincronizar_boleto_sicredi_servidor(f.actor,b.id,'baixado',jsonb_build_object('origem','consulta_automatica'));
   end if;
   insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('boletos',b.id,'sicredi_consulta_automatica_247',f.actor,jsonb_build_object('situacao',_situacao,'origem','agendamento'));
  exception when others then estado:='conferencia';falha:='CONFERENCIA_FINANCEIRA';end;
 elsif _situacao in ('consulta_falhou','convenio_divergente','sem_responsavel','dados_incompletos') then falha:=upper(_situacao);
 elsif _situacao not in ('pendente','adiado') then raise exception 'Resultado inválido';end if;
 update public.sicredi_auto_fila_247 set lease=null,lease_ate=null,ultima_consulta=case when estado='adiado' then ultima_consulta else now() end,
  resultado=estado,erro=falha,proxima_consulta=now()+case when estado='adiado' then interval '0 minutes' when falha is not null then interval '30 minutes' else interval '5 minutes' end where boleto_id=b.id;
 return estado;
end $$;
revoke all on function public.sicredi_auto_finalizar_247(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.sicredi_auto_finalizar_247(uuid,uuid,text,jsonb) to service_role;
create or replace function public.sicredi_auto_status_247(_centro uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$begin
 if not public.usuario_ativo() or not (public.can_manage(auth.uid()) or public.has_role(auth.uid(),'financeiro')) or (_centro is not null and not public.usuario_pode_acessar_centro(_centro)) then raise exception 'Sem acesso ao acompanhamento';end if;
 return (select jsonb_build_object('ativo',c.ativo,'ultima_chamada',c.ultima_chamada,'pendencias',(select count(*) from public.sicredi_auto_fila_247 f join public.boletos b on b.id=f.boleto_id where f.erro is not null and b.status<>'liquidado' and (b.status='registrado' or f.resultado='conferencia') and (_centro is null or b.centro_id=_centro) and public.usuario_pode_acessar_centro(b.centro_id))) from public.sicredi_auto_config_247 c where id);
end $$;
revoke all on function public.sicredi_auto_status_247(uuid) from public,anon;
grant execute on function public.sicredi_auto_status_247(uuid) to authenticated;
-- O segredo fica exclusivamente no banco e no transporte HTTPS para o servidor.
create or replace function public.sicredi_auto_disparar_247() returns void
language plpgsql security definer set search_path=public as $$declare c public.sicredi_auto_config_247;begin
 select * into c from public.sicredi_auto_config_247 where id;
 if not c.ativo then return;end if;
 perform net.http_post(url:=c.endpoint,headers:=jsonb_build_object('Authorization','Bearer '||c.segredo,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;
revoke all on function public.sicredi_auto_disparar_247() from public,anon,authenticated;
grant execute on function public.sicredi_auto_disparar_247() to service_role;
-- Extensões oferecidas pelo Supabase. O agendamento não depende do navegador aberto.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$begin
 if not exists(select 1 from cron.job where jobname='sicredi-consulta-automatica-247') then
  perform cron.schedule('sicredi-consulta-automatica-247','*/5 * * * *','select public.sicredi_auto_disparar_247()');
 end if;
end $$;
-- A limpeza administrativa preserva o agendamento e seu segredo; a fila acompanha os boletos.
do $$declare d text;begin
 if to_regprocedure('public.admin_limpar_dados_interno_f130(text)') is not null then
  select pg_get_functiondef('public.admin_limpar_dados_interno_f130(text)'::regprocedure) into d;
  if position('sicredi_auto_config_247' in d)=0 then
   if position('''sicredi_config''' in d)=0 then raise exception 'Revise a preservação da configuração automática na rotina de limpeza';end if;
   execute replace(d,'''sicredi_config''','''sicredi_config'',''sicredi_auto_config_247''');
  end if;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
