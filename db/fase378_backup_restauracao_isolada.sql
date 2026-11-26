-- Recuperação para conferência: nunca substitui o banco de produção.
begin;
create table if not exists public.backup_restauracoes_378 (
 id uuid primary key default gen_random_uuid(),
 backup_id uuid not null references public.backup_execucoes_268(id),
 solicitado_por uuid not null,
 solicitado_em timestamptz not null default now(),
 iniciado_em timestamptz,
 finalizado_em timestamptz,
 estado text not null default 'pendente' check(estado in ('pendente','executando','sucesso','falha')),
 lease uuid,
 lease_ate timestamptz,
 relatorio jsonb,
 mensagem text
);
create unique index if not exists backup_restauracao_unica_378 on public.backup_restauracoes_378((true)) where estado in ('pendente','executando');
alter table public.backup_restauracoes_378 enable row level security;
revoke all on public.backup_restauracoes_378 from public,anon,authenticated,service_role;

create or replace function public.solicitar_restauracao_backup_378(_backup uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare resultado uuid;
begin
 perform public.exigir_admin_backup_268();
 perform pg_advisory_xact_lock(378,1);
 if not exists(select 1 from public.backup_execucoes_268 where id=_backup and estado='sucesso' and copia_externa_verificada and download_objeto is not null and download_bytes>0 and download_sha256 ~ '^[a-f0-9]{64}$') then raise exception 'Escolha um backup concluído e disponível';end if;
 update public.backup_restauracoes_378 set estado='falha',finalizado_em=now(),mensagem='Executor expirado; solicite nova conferência.' where estado='executando' and lease_ate<now();
 select id into resultado from public.backup_restauracoes_378 where estado in ('pendente','executando');
 if resultado is not null then return resultado;end if;
 if exists(select 1 from public.backup_restauracoes_378 where solicitado_em>now()-interval '5 minutes') then raise exception 'Aguarde cinco minutos entre solicitações';end if;
 insert into public.backup_restauracoes_378(backup_id,solicitado_por) values(_backup,auth.uid()) returning id into resultado;
 insert into public.auditoria(tabela,registro_id,acao,user_id) values('backup_restauracoes_378',resultado,'restauracao_isolada_solicitada',auth.uid());
 return resultado;
end $$;

create or replace function public.listar_restauracoes_backup_378() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.exigir_admin_backup_268();
 return coalesce((select jsonb_agg(to_jsonb(r) order by r.solicitado_em desc) from (select id,backup_id,solicitado_em,finalizado_em,estado,relatorio,mensagem from public.backup_restauracoes_378 order by solicitado_em desc limit 20) r),'[]'::jsonb);
end $$;

create or replace function public.assumir_restauracao_backup_378() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.backup_restauracoes_378; b public.backup_execucoes_268;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Exclusivo do executor';end if;
 perform pg_advisory_xact_lock(378,1);
 update public.backup_restauracoes_378 set estado='falha',finalizado_em=now(),mensagem='Executor expirado; solicite nova conferência.' where estado='executando' and lease_ate<now();
 if exists(select 1 from public.backup_restauracoes_378 where estado='executando') then return null;end if;
 select * into j from public.backup_restauracoes_378 where estado='pendente' order by solicitado_em limit 1 for update;
 if j.id is null then return null;end if;
 select * into b from public.backup_execucoes_268 where id=j.backup_id;
 if b.estado<>'sucesso' or not b.copia_externa_verificada or b.download_objeto is null then
  update public.backup_restauracoes_378 set estado='falha',finalizado_em=now(),mensagem='Cópia concluída indisponível.' where id=j.id;
  return null;
 end if;
 update public.backup_restauracoes_378 set estado='executando',iniciado_em=now(),lease=gen_random_uuid(),lease_ate=now()+interval '1 hour' where id=j.id returning * into j;
 return jsonb_build_object('id',j.id,'lease',j.lease,'objeto',b.download_objeto,'sha256',b.download_sha256,'bytes',b.download_bytes);
end $$;

create or replace function public.finalizar_restauracao_backup_378(_id uuid,_lease uuid,_sucesso boolean,_relatorio jsonb default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.backup_restauracoes_378;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Exclusivo do executor';end if;
 select * into j from public.backup_restauracoes_378 where id=_id for update;
 if j.id is null or j.estado<>'executando' or j.lease is distinct from _lease or j.lease_ate<now() then raise exception 'Execução expirada ou divergente';end if;
 if _sucesso is null then raise exception 'Resultado obrigatório';end if;
 if _sucesso and (_relatorio is null or jsonb_typeof(_relatorio)<>'object' or octet_length(_relatorio::text)>10000 or not (_relatorio ? 'tabelas_comparadas') or _relatorio->>'resultado' is distinct from 'restauracao_logica_verificada' or _relatorio->>'isolamento_rede' is distinct from 'none 0' or _relatorio->>'indices_invalidos' is distinct from '0') then raise exception 'Relatório obrigatório';end if;
 update public.backup_restauracoes_378 set estado=case when _sucesso then 'sucesso' else 'falha' end,finalizado_em=now(),relatorio=case when _sucesso then _relatorio else null end,mensagem=case when _sucesso then 'Conteúdo recuperado e comparado em banco isolado. Produção preservada.' else 'Conferência incompleta; responsável técnico deve revisar o executor.' end where id=j.id;
end $$;
revoke all on function public.solicitar_restauracao_backup_378(uuid),public.listar_restauracoes_backup_378(),public.assumir_restauracao_backup_378(),public.finalizar_restauracao_backup_378(uuid,uuid,boolean,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.solicitar_restauracao_backup_378(uuid),public.listar_restauracoes_backup_378() to authenticated;
grant execute on function public.assumir_restauracao_backup_378(),public.finalizar_restauracao_backup_378(uuid,uuid,boolean,jsonb) to service_role;
commit;
