-- Consulta de recibos já enviados; nunca cria ou reenvia uma NF-e.
begin;
do $$begin
 if to_regprocedure('public.assumir_nfe_259(uuid,uuid,boolean)') is null then raise exception 'Aplique a fase259 antes da fase260';end if;
end $$;
create table if not exists public.faznotas_auto_config_260 (
 id boolean primary key default true check(id),
 ativo boolean not null default true,
 segredo text not null default replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),
 ultima_chamada timestamptz,bloqueado_ate timestamptz,
 ultimo_resultado text
);
alter table public.faznotas_auto_config_260 enable row level security;
revoke all on public.faznotas_auto_config_260 from public,anon,authenticated;
grant all on public.faznotas_auto_config_260 to service_role;
insert into public.faznotas_auto_config_260(id) values(true) on conflict do nothing;
create or replace function public.faznotas_auto_reservar_260(_segredo text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.faznotas_auto_config_260;e public.faznotas_emissoes_259;j jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 select * into c from public.faznotas_auto_config_260 where id for update;
 if _segredo is null or _segredo is distinct from c.segredo then raise exception 'Credencial inválida';end if;
 if not c.ativo or c.bloqueado_ate>clock_timestamp() then return null;end if;
 update public.faznotas_auto_config_260 set ultima_chamada=clock_timestamp(),bloqueado_ate=clock_timestamp()+interval '55 seconds',ultimo_resultado='consultando' where id;
 -- Um recibo por chamada limita tempo de execução e divide a fila com o navegador.
 for e in select * from public.faznotas_emissoes_259
  where estado='processando' and nullif(recibo,'') is not null
   and proxima_consulta<=clock_timestamp() and (lease_ate is null or lease_ate<=clock_timestamp())
  order by proxima_consulta,created_at limit 10 for update skip locked
 loop
  begin
   j:=public.assumir_nfe_259(e.created_by,e.nota_id,false);
  exception when others then
   update public.faznotas_emissoes_259 set proxima_consulta=clock_timestamp()+interval '5 minutes' where nota_id=e.nota_id;
   update public.faznotas_auto_config_260 set ultimo_resultado='conferir_acesso_ou_credencial' where id;
   continue;
  end;
  if j is not null then
   update public.faznotas_auto_config_260 set ultimo_resultado='recibo_reservado' where id;
   return jsonb_build_object('nota',e.nota_id,'actor',e.created_by,'lease',j->>'lease','centro',j->>'centro_id','cnpj',e.cnpj,'recibo',e.recibo);
  end if;
 end loop;
 update public.faznotas_auto_config_260 set ultimo_resultado=case when ultimo_resultado='consultando' then 'sem_recibo_pendente' else ultimo_resultado end where id;
 return null;
end $$;
revoke all on function public.faznotas_auto_reservar_260(text) from public,anon,authenticated;
grant execute on function public.faznotas_auto_reservar_260(text) to service_role;
create or replace function public.faznotas_auto_disparar_260() returns void
language plpgsql security definer set search_path=public as $$declare c public.faznotas_auto_config_260;begin
 select * into c from public.faznotas_auto_config_260 where id;
 if not c.ativo then return;end if;
 perform net.http_post(url:='https://caparaosystem.lovable.app/api/faznotas/sincronizar',headers:=jsonb_build_object('Authorization','Bearer '||c.segredo,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;
revoke all on function public.faznotas_auto_disparar_260() from public,anon,authenticated;
grant execute on function public.faznotas_auto_disparar_260() to service_role;
-- Configuração não pode ser apagada pela limpeza administrativa genérica.
do $$declare d text;begin
 if to_regprocedure('public.admin_limpar_dados_interno_f130(text)') is not null then
  select pg_get_functiondef('public.admin_limpar_dados_interno_f130(text)'::regprocedure) into d;
  if position('faznotas_auto_config_260' in d)=0 then
   if position('''sicredi_config''' in d)=0 then raise exception 'Revise a preservação do agendamento na limpeza';end if;
   execute replace(d,'''sicredi_config''','''sicredi_config'',''faznotas_auto_config_260''');
  end if;
 end if;
end $$;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$begin
 if not exists(select 1 from cron.job where jobname='faznotas-consulta-automatica-260') then
  perform cron.schedule('faznotas-consulta-automatica-260','* * * * *','select public.faznotas_auto_disparar_260()');
 end if;
end $$;
notify pgrst,'reload schema';
commit;
