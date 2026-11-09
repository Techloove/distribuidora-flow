-- Reaproveita o agendamento e a conciliação existentes, sem emitir ou baixar títulos na migração.
begin;
alter table public.sicredi_auto_config_247 add column if not exists ultima_solicitacao_345 timestamptz;
create index if not exists boletos_sicredi_abertos_345 on public.boletos(vencimento,id)
 where banco='sicredi' and canal='api' and ambiente='producao' and status='registrado';
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
  order by case when f.ultima_consulta<now()-interval '12 hours' then 0 when b.vencimento<=hoje+7 then 1 else 2 end,coalesce(f.ultima_consulta,'epoch'::timestamptz),b.vencimento,b.id
  limit 10 for update of b skip locked loop
  select p.id into responsavel from public.profiles p where p.ativo and public.has_role(p.id,'admin') and public.ator_financeiro_pode_acessar_centro(p.id,r.centro_id) order by p.id limit 1;
  insert into public.sicredi_auto_fila_247(boleto_id,lease,lease_ate,actor) values(r.id,chave,now()+interval '3 minutes',responsavel)
   on conflict(boleto_id) do update set lease=excluded.lease,lease_ate=excluded.lease_ate,actor=excluded.actor;
  outros:=outros||jsonb_build_object('id',r.id,'nosso_numero',r.nosso_numero,'cooperativa',r.cooperativa,'posto',r.posto,'codigo_beneficiario',r.codigo_beneficiario,'responsavel',responsavel);
 end loop;
 return jsonb_build_object('lease',chave,'itens',outros);
end $$;
revoke all on function public.sicredi_auto_reservar_247(text) from public,anon,authenticated;
grant execute on function public.sicredi_auto_reservar_247(text) to service_role;
-- Mantém integralmente a baixa financeira, guardas e diagnóstico do finalizador instalado.
do $$declare d text;alvo text:='else interval ''5 minutes'' end';begin
 select pg_get_functiondef('public.sicredi_auto_finalizar_247(uuid,uuid,text,jsonb)'::regprocedure) into d;
 if position('interval ''6 hours''' in d)=0 then
  if position(alvo in d)=0 then raise exception 'Revise a espera do finalizador Sicredi antes da fase345';end if;
  execute replace(d,alvo,'when b.vencimento<=(now() at time zone ''America/Sao_Paulo'')::date+7 then interval ''15 minutes'' else interval ''6 hours'' end');
 end if;
end $$;
create or replace function public.sicredi_auto_solicitar_345(_centro uuid default null) returns boolean
language plpgsql security definer set search_path=public as $$
declare c public.sicredi_auto_config_247;
begin
 if not public.usuario_ativo() or not(public.can_manage(auth.uid()) or public.has_role(auth.uid(),'financeiro'))
 or (_centro is not null and not public.usuario_pode_acessar_centro(_centro)) then raise exception 'Sem acesso à consulta automática' using errcode='42501';end if;
 select * into c from public.sicredi_auto_config_247 where id for update;
 if not found or not c.ativo or c.bloqueado_ate>now()
 or c.ultima_chamada>now()-interval '5 minutes' or c.ultima_solicitacao_345>now()-interval '5 minutes' then return false;end if;
 if not exists(select 1 from public.boletos b left join public.sicredi_auto_fila_247 f on f.boleto_id=b.id
 where b.banco='sicredi' and b.canal='api' and b.ambiente='producao' and b.status='registrado' and nullif(b.nosso_numero,'') is not null
 and (_centro is null or b.centro_id=_centro) and public.usuario_pode_acessar_centro(b.centro_id)
 and coalesce(f.proxima_consulta,'epoch'::timestamptz)<=now() and coalesce(f.lease_ate,'epoch'::timestamptz)<=now()) then return false;end if;
 update public.sicredi_auto_config_247 set ultima_solicitacao_345=now() where id;
 perform public.sicredi_auto_disparar_247();
 return true;
end $$;
revoke all on function public.sicredi_auto_solicitar_345(uuid) from public,anon,authenticated,service_role;
grant execute on function public.sicredi_auto_solicitar_345(uuid) to authenticated;
create or replace function public.sicredi_auto_status_247(_centro uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare resumo jsonb;
begin
 if not public.usuario_ativo() or not(public.can_manage(auth.uid()) or public.has_role(auth.uid(),'financeiro')) or (_centro is not null and not public.usuario_pode_acessar_centro(_centro)) then raise exception 'Sem acesso ao acompanhamento';end if;
 select jsonb_build_object('ultima_verificacao',max(f.ultima_consulta),'ultima_alteracao',max(f.ultima_consulta) filter(where f.resultado in('liquidado','baixado','ja_processado')),'pendencias',count(*) filter(where f.erro is not null and b.status<>'liquidado' and (b.status='registrado' or f.resultado='conferencia')))
 into resumo from public.boletos b join public.sicredi_auto_fila_247 f on f.boleto_id=b.id
 where (_centro is null or b.centro_id=_centro) and public.usuario_pode_acessar_centro(b.centro_id);
 return (select jsonb_build_object('ativo',c.ativo,'ultima_chamada',c.ultima_chamada)||resumo from public.sicredi_auto_config_247 c where id);
end $$;
revoke all on function public.sicredi_auto_status_247(uuid) from public,anon;
grant execute on function public.sicredi_auto_status_247(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
