-- Fila e histórico administrativo; backup completo executado em host externo.
begin;
create table if not exists public.backup_execucoes_268(
 id uuid primary key default gen_random_uuid(),
 origem text not null check(origem in ('manual','agendado')),
 estado text not null default 'pendente' check(estado in ('pendente','executando','sucesso','falha')),
 solicitado_por uuid references public.profiles(id),
 solicitado_em timestamptz not null default now(),iniciado_em timestamptz,finalizado_em timestamptz,
 lease uuid,lease_ate timestamptz,arquivo text,
 copia_externa_verificada boolean not null default false,
 mensagem text,
 check(estado<>'sucesso' or (copia_externa_verificada and arquivo is not null))
);
create unique index if not exists backup_unico_ativo_268 on public.backup_execucoes_268((true)) where estado in ('pendente','executando');
alter table public.backup_execucoes_268 enable row level security;
revoke all on public.backup_execucoes_268 from public,anon,authenticated,service_role;

create or replace function public.exigir_admin_backup_268() returns void
language plpgsql stable security definer set search_path=public as $$begin
 if auth.uid() is null or not coalesce(public.has_role(auth.uid(),'admin'),false)
 or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.ativo and not coalesce(p.precisa_completar_cadastro,false) and coalesce(to_jsonb(p)->>'cadastro_status','interno') in ('interno','aprovado')) then
 raise exception 'Backup completo exige administrador ativo';end if;
end $$;
revoke all on function public.exigir_admin_backup_268() from public,anon,authenticated,service_role;

create or replace function public.solicitar_backup_268() returns uuid
language plpgsql security definer set search_path=public as $$declare v uuid;begin
 perform public.exigir_admin_backup_268();
 perform pg_advisory_xact_lock(268,1);
 select id into v from public.backup_execucoes_268 where estado in ('pendente','executando');
 if v is not null then return v;end if;
 if exists(select 1 from public.backup_execucoes_268 where solicitado_em>now()-interval '5 minutes') then raise exception 'Aguarde cinco minutos entre solicitações de backup';end if;
 insert into public.backup_execucoes_268(origem,solicitado_por) values('manual',auth.uid()) returning id into v;
 insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id) values('backup_execucoes_268',v,'backup_solicitado','{"escopo":"banco_e_storage_completos"}',auth.uid());
 return v;
end $$;
revoke all on function public.solicitar_backup_268() from public,anon,service_role;
grant execute on function public.solicitar_backup_268() to authenticated;

create or replace function public.listar_backups_268() returns jsonb
language plpgsql stable security definer set search_path=public as $$begin
 perform public.exigir_admin_backup_268();
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.solicitado_em desc) from (select id,origem,estado,solicitado_em,iniciado_em,finalizado_em,arquivo,copia_externa_verificada,mensagem from public.backup_execucoes_268 order by solicitado_em desc limit 20)x),'[]'::jsonb);
end $$;
revoke all on function public.listar_backups_268() from public,anon,service_role;
grant execute on function public.listar_backups_268() to authenticated;

create or replace function public.assumir_backup_268(_agendado boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$declare j public.backup_execucoes_268;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Exclusivo do executor administrativo';end if;
 perform pg_advisory_xact_lock(268,1);
 update public.backup_execucoes_268 set estado='falha',finalizado_em=now(),lease=null,lease_ate=null,mensagem='Executor interrompido. Verifique as cópias e solicite nova execução.' where estado='executando' and lease_ate<now();
 if exists(select 1 from public.backup_execucoes_268 where estado='executando') then return null;end if;
 if coalesce(_agendado,false) and not exists(select 1 from public.backup_execucoes_268 where estado='pendente') then
 insert into public.backup_execucoes_268(origem) values('agendado');end if;
 select * into j from public.backup_execucoes_268 where estado='pendente' order by solicitado_em limit 1 for update;
 if j.id is null then return null;end if;
 update public.backup_execucoes_268 set estado='executando',iniciado_em=now(),lease=gen_random_uuid(),lease_ate=now()+interval '7 hours',mensagem=null where id=j.id returning * into j;
 return jsonb_build_object('id',j.id,'lease',j.lease);
end $$;
revoke all on function public.assumir_backup_268(boolean) from public,anon,authenticated;
grant execute on function public.assumir_backup_268(boolean) to service_role;

create or replace function public.finalizar_backup_268(_id uuid,_lease uuid,_sucesso boolean,_arquivo text default null) returns void
language plpgsql security definer set search_path=public as $$declare j public.backup_execucoes_268;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Exclusivo do executor administrativo';end if;
 select * into j from public.backup_execucoes_268 where id=_id for update;
 if j.id is null or j.estado<>'executando' or j.lease is distinct from _lease or j.lease_ate<now() then raise exception 'Execução expirada ou divergente';end if;
 if _sucesso is null or (_sucesso and (_arquivo is null or _arquivo !~ '^backup-[0-9TZ.-]+$')) then raise exception 'Resultado de backup inválido';end if;
 update public.backup_execucoes_268 set estado=case when _sucesso then 'sucesso' else 'falha' end,finalizado_em=now(),lease=null,lease_ate=null,arquivo=case when _sucesso then _arquivo end,copia_externa_verificada=_sucesso,mensagem=case when _sucesso then 'Banco e arquivos criptografados, com cópia externa verificada.' else 'Backup incompleto. O responsável pela infraestrutura deve verificar o executor e o destino externo.' end where id=_id;
 insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id) values('backup_execucoes_268',_id,'backup_finalizado',jsonb_build_object('sucesso',_sucesso),j.solicitado_por);
end $$;
revoke all on function public.finalizar_backup_268(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.finalizar_backup_268(uuid,uuid,boolean,text) to service_role;
notify pgrst,'reload schema';
commit;
