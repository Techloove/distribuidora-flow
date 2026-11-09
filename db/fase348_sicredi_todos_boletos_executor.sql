-- Corrige destino de execução e conferência de todos os boletos, inclusive antecipados.
begin;
alter table public.sicredi_auto_config_247 add column if not exists executor_versao_348 text,add column if not exists executor_em_348 timestamptz;
alter table public.sicredi_auto_fila_247 add column if not exists movimento_em_348 timestamptz;
-- Manifestos públicos conferidos: domínio atual1.43.4, destino antigo1.34.1. Segredo preservado.
update public.sicredi_auto_config_247 set endpoint='https://caparaosystem.com.br/api/sicredi/sincronizar'
 where id and endpoint='https://caparaosystem.lovable.app/api/sicredi/sincronizar';
create or replace function public.sicredi_auto_reservar_247(_segredo text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare cfg public.sicredi_auto_config_247;r record;responsavel uuid;outros jsonb:='[]';chave uuid:=gen_random_uuid();hoje date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 select * into cfg from public.sicredi_auto_config_247 where id for update;
 if _segredo is null or _segredo is distinct from cfg.segredo then raise exception 'Agendamento não autorizado';end if;
 if not cfg.ativo or cfg.bloqueado_ate>now() then return jsonb_build_object('itens','[]'::jsonb);end if;
 update public.sicredi_auto_config_247 set ultima_chamada=now(),bloqueado_ate=now()+interval '90 seconds' where id;
 for r in select b.* from public.boletos b left join public.sicredi_auto_fila_247 f on f.boleto_id=b.id
  where b.banco='sicredi' and b.canal='api' and b.ambiente='producao' and b.status='registrado' and nullif(b.nosso_numero,'') is not null
  and coalesce(f.proxima_consulta,'epoch'::timestamptz)<=now() and coalesce(f.lease_ate,'epoch'::timestamptz)<=now()
  order by case when f.movimento_em_348>coalesce(f.ultima_consulta,'epoch'::timestamptz) then 0 else 1 end,coalesce(f.ultima_consulta,'epoch'::timestamptz),b.vencimento,b.id
  limit 20 for update of b skip locked loop
  select p.id into responsavel from public.profiles p where p.ativo and public.has_role(p.id,'admin') and public.ator_financeiro_pode_acessar_centro(p.id,r.centro_id) order by p.id limit 1;
  insert into public.sicredi_auto_fila_247(boleto_id,lease,lease_ate,actor) values(r.id,chave,now()+interval '3 minutes',responsavel)
   on conflict(boleto_id) do update set lease=excluded.lease,lease_ate=excluded.lease_ate,actor=excluded.actor;
  outros:=outros||jsonb_build_object('id',r.id,'nosso_numero',r.nosso_numero,'cooperativa',r.cooperativa,'posto',r.posto,'codigo_beneficiario',r.codigo_beneficiario,'responsavel',responsavel);
 end loop;
 return jsonb_build_object('lease',chave,'itens',outros);
end $$;
revoke all on function public.sicredi_auto_reservar_247(text) from public,anon,authenticated;
grant execute on function public.sicredi_auto_reservar_247(text) to service_role;

create or replace function public.sicredi_auto_reservar_348(_segredo text,_versao text) returns jsonb
language plpgsql security definer set search_path=public as $$declare r jsonb;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 if _versao is null or _versao !~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$' then raise exception 'Versão inválida';end if;
 r:=public.sicredi_auto_reservar_247(_segredo);
 update public.sicredi_auto_config_247 set executor_versao_348=_versao,executor_em_348=now() where id;
 return r;
end $$;
revoke all on function public.sicredi_auto_reservar_348(text,text) from public,anon,authenticated;
grant execute on function public.sicredi_auto_reservar_348(text,text) to service_role;
-- Mesma espera para todos os vencimentos; falhas preservam30min.
do $$declare d text;alvo text;begin
 select pg_get_functiondef('public.sicredi_auto_finalizar_247(uuid,uuid,text,jsonb)'::regprocedure) into d;
 alvo:='when b.vencimento<=(now() at time zone ''America/Sao_Paulo'')::date+7 then interval ''15 minutes'' else interval ''6 hours'' end';
 if position(alvo in d)>0 then execute replace(d,alvo,'else interval ''15 minutes'' end');
 elsif position('else interval ''15 minutes'' end' in d)=0 then raise exception 'Revise a espera antes da fase348';end if;
end $$;
update public.sicredi_auto_fila_247 f set proxima_consulta=least(f.proxima_consulta,f.ultima_consulta+interval '15 minutes')
 from public.boletos b where b.id=f.boleto_id and b.banco='sicredi' and b.canal='api' and b.ambiente='producao' and b.status='registrado'
 and f.erro is null and f.ultima_consulta is not null;
-- Movimento é sinal para consulta, nunca confirmação de recebimento.
create or replace function public.sicredi_movimento_consulta_348() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if TG_OP='UPDATE' then if old.debitos is not distinct from new.debitos then return new;end if;end if;
 if exists(select 1 from public.boletos where id=new.boleto_id and banco='sicredi' and canal='api' and ambiente='producao' and status='registrado') then
  insert into public.sicredi_auto_fila_247(boleto_id,proxima_consulta,movimento_em_348) values(new.boleto_id,now(),now())
  on conflict(boleto_id) do update set proxima_consulta=least(sicredi_auto_fila_247.proxima_consulta,now()),movimento_em_348=now();
 end if;
 return new;
end $$;
revoke all on function public.sicredi_movimento_consulta_348() from public,anon,authenticated,service_role;
drop trigger if exists sicredi_movimento_consulta_348 on public.sicredi_tarifas_api_280;
create trigger sicredi_movimento_consulta_348 after insert or update on public.sicredi_tarifas_api_280 for each row execute function public.sicredi_movimento_consulta_348();
-- Movimentos anteriores ainda sem conferência atualizada ganham prioridade uma única vez.
insert into public.sicredi_auto_fila_247(boleto_id,proxima_consulta,movimento_em_348)
 select distinct b.id,now(),now() from public.boletos b join public.sicredi_tarifas_api_280 s on s.boleto_id=b.id
 where b.banco='sicredi' and b.canal='api' and b.ambiente='producao' and b.status='registrado'
 on conflict(boleto_id) do update set proxima_consulta=least(sicredi_auto_fila_247.proxima_consulta,excluded.proxima_consulta),movimento_em_348=excluded.movimento_em_348
 where sicredi_auto_fila_247.movimento_em_348 is null;
do $$declare d text;alvo text:='''ultima_chamada'',c.ultima_chamada';begin
 select pg_get_functiondef('public.sicredi_auto_status_247(uuid)'::regprocedure) into d;
 if position('executor_versao_348' in d)=0 then
  if position(alvo in d)=0 then raise exception 'Revise o acompanhamento antes da fase348';end if;
  execute replace(d,alvo,alvo||',''executor_versao'',c.executor_versao_348,''executor_em'',c.executor_em_348');
 end if;
end $$;
notify pgrst,'reload schema';
commit;
