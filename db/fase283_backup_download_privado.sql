-- Download administrativo do pacote criptografado; não exporta credenciais ao navegador.
begin;
alter table public.backup_execucoes_268 add column if not exists download_objeto text;
alter table public.backup_execucoes_268 add column if not exists download_sha256 text;
alter table public.backup_execucoes_268 add column if not exists download_bytes bigint;

insert into storage.buckets(id,name,public) values('erp-backups','erp-backups',false)
on conflict(id) do update set public=false;

create or replace function public.registrar_download_backup_283(_id uuid,_lease uuid,_objeto text,_sha256 text,_bytes bigint) returns void
language plpgsql security definer set search_path=public as $$
declare j public.backup_execucoes_268;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Exclusivo do executor administrativo';end if;
 select * into j from public.backup_execucoes_268 where id=_id for update;
 if j.id is null or j.estado<>'executando' or j.lease is distinct from _lease or j.lease_ate<now() then raise exception 'Execução expirada ou divergente';end if;
 if _objeto is null or _objeto !~ ('^'||_id::text||'/backup-[0-9TZ.-]+\.tar$')
 or _sha256 is null or _sha256 !~ '^[a-f0-9]{64}$' or _bytes is null or _bytes<=0 then raise exception 'Pacote de backup inválido';end if;
 update public.backup_execucoes_268 set download_objeto=_objeto,download_sha256=_sha256,download_bytes=_bytes where id=_id;
end $$;
revoke all on function public.registrar_download_backup_283(uuid,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.registrar_download_backup_283(uuid,uuid,text,text,bigint) to service_role;

create or replace function public.pode_baixar_backup_283(_objeto text) returns boolean
language plpgsql stable security definer set search_path=public as $$
begin
 if auth.uid() is null then return false;end if;
 if not coalesce(public.has_role(auth.uid(),'admin'),false) then return false;end if;
 if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.ativo and not coalesce(p.precisa_completar_cadastro,false) and coalesce(to_jsonb(p)->>'cadastro_status','interno') in ('interno','aprovado')) then return false;end if;
 return exists(select 1 from public.backup_execucoes_268 b where b.download_objeto=_objeto and b.estado='sucesso' and b.copia_externa_verificada and b.download_bytes>0 and b.download_sha256 is not null);
end $$;
revoke all on function public.pode_baixar_backup_283(text) from public,anon,service_role;
grant execute on function public.pode_baixar_backup_283(text) to authenticated;

-- As restrições também protegem contra políticas permissivas anteriores de outros buckets.
drop policy if exists backup_283_leitura on storage.objects;
create policy backup_283_leitura on storage.objects for select to authenticated using(bucket_id='erp-backups' and public.pode_baixar_backup_283(name));
drop policy if exists backup_283_restringir_leitura on storage.objects;
create policy backup_283_restringir_leitura on storage.objects as restrictive for select to authenticated using(bucket_id<>'erp-backups' or public.pode_baixar_backup_283(name));
drop policy if exists backup_283_bloquear_anon on storage.objects;
create policy backup_283_bloquear_anon on storage.objects as restrictive for all to anon using(bucket_id<>'erp-backups') with check(bucket_id<>'erp-backups');
drop policy if exists backup_283_bloquear_insert on storage.objects;
create policy backup_283_bloquear_insert on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'erp-backups');
drop policy if exists backup_283_bloquear_update on storage.objects;
create policy backup_283_bloquear_update on storage.objects as restrictive for update to authenticated using(bucket_id<>'erp-backups') with check(bucket_id<>'erp-backups');
drop policy if exists backup_283_bloquear_delete on storage.objects;
create policy backup_283_bloquear_delete on storage.objects as restrictive for delete to authenticated using(bucket_id<>'erp-backups');

create or replace function public.obter_download_backup_283(_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare j public.backup_execucoes_268;
begin
 perform public.exigir_admin_backup_268();
 select * into j from public.backup_execucoes_268 where id=_id;
 if j.id is null or not public.pode_baixar_backup_283(j.download_objeto) then raise exception 'Backup concluído para download não disponível';end if;
 insert into public.auditoria(tabela,registro_id,acao,user_id) values('backup_execucoes_268',_id,'backup_download_solicitado',auth.uid());
 return jsonb_build_object('objeto',j.download_objeto,'nome',split_part(j.download_objeto,'/',2),'sha256',j.download_sha256,'bytes',j.download_bytes);
end $$;
revoke all on function public.obter_download_backup_283(uuid) from public,anon,service_role;
grant execute on function public.obter_download_backup_283(uuid) to authenticated;

create or replace function public.listar_backups_268() returns jsonb
language plpgsql stable security definer set search_path=public as $$begin
 perform public.exigir_admin_backup_268();
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.solicitado_em desc) from (
  select id,origem,estado,solicitado_em,iniciado_em,finalizado_em,arquivo,copia_externa_verificada,mensagem,
   (estado='sucesso' and copia_externa_verificada and download_objeto is not null and download_sha256 is not null and download_bytes>0) as download_disponivel
  from public.backup_execucoes_268 order by solicitado_em desc limit 20)x),'[]'::jsonb);
end $$;
revoke all on function public.listar_backups_268() from public,anon,service_role;
grant execute on function public.listar_backups_268() to authenticated;
notify pgrst,'reload schema';
commit;
