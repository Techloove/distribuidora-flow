-- Aplicativo de Conta Corrente separado da cobrança. Nenhum lançamento financeiro.
begin;
create table if not exists public.sicoob_extrato_config_352(
 centro_id uuid primary key references public.centros(id),client_id text not null default '',numero_conta text not null default '',segredo_id uuid,versao int not null default 0,ultima_consulta timestamptz,updated_at timestamptz not null default now()
);
alter table public.sicoob_extrato_config_352 enable row level security;
revoke all on public.sicoob_extrato_config_352 from public,anon,authenticated;
grant all on public.sicoob_extrato_config_352 to service_role;
create or replace function public.sicoob_extrato_config_352(_actor uuid,_centro uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c sicoob_extrato_config_352;
begin
 perform validar_sicoob_316(_actor,_centro,true);
 select * into c from sicoob_extrato_config_352 where centro_id=_centro;
 return jsonb_build_object('clientId',coalesce(c.client_id,''),'numeroConta',coalesce(c.numero_conta,''),'certificado',c.segredo_id is not null,'versao',coalesce(c.versao,0));
end $$;
create or replace function public.sicoob_extrato_salvar_352(_actor uuid,_centro uuid,_client text,_conta text,_versao int,_segredo jsonb default null) returns void
language plpgsql security definer set search_path=public as $$
declare c sicoob_extrato_config_352;
begin
 perform validar_sicoob_316(_actor,_centro,true);
 if _client is null or _client!~'^[A-Za-z0-9._-]{1,150}$' or _conta is null or _conta!~'^[0-9]{1,18}$' or _conta::numeric<=0 then raise exception 'Informe Client ID de Conta Corrente e conta sem pontuação';end if;
 insert into sicoob_extrato_config_352(centro_id) values(_centro) on conflict do nothing;
 select * into c from sicoob_extrato_config_352 where centro_id=_centro for update;
 if c.versao is distinct from _versao then raise exception 'Configuração alterada em outra sessão. Atualize antes de salvar';end if;
 if _segredo is not null then
  if jsonb_typeof(_segredo) is distinct from 'object' or length(coalesce(_segredo->>'pfx','')) not between 1 and 400000 or length(coalesce(_segredo->>'senha',''))>512 then raise exception 'Certificado inválido';end if;
  if c.segredo_id is null then select vault.create_secret(_segredo::text,'sicoob-extrato-'||_centro::text,'Certificado privado para consulta de extrato') into c.segredo_id;
  else perform vault.update_secret(c.segredo_id,_segredo::text);end if;
 end if;
 update sicoob_extrato_config_352 set client_id=_client,numero_conta=_conta,segredo_id=c.segredo_id,versao=versao+1,updated_at=now() where centro_id=_centro;
 insert into auditoria(tabela,registro_id,acao,user_id,detalhe) values('sicoob_extrato_config_352',_centro,'configurar_extrato',_actor,jsonb_build_object('certificado_substituido',_segredo is not null));
end $$;
create or replace function public.sicoob_extrato_reservar_352(_actor uuid,_centro uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c sicoob_extrato_config_352;s text;
begin
 perform validar_sicoob_316(_actor,_centro,true);
 perform pg_advisory_xact_lock(352,1);
 if exists(select 1 from sicoob_extrato_config_352 where ultima_consulta>now()-interval '15 seconds') then raise exception 'Aguarde quinze segundos antes de outra consulta de extrato Sicoob';end if;
 select * into c from sicoob_extrato_config_352 where centro_id=_centro for update;
 if c.client_id is null or c.client_id='' or c.segredo_id is null then raise exception 'Configure o aplicativo e certificado de Conta Corrente';end if;
 if c.ultima_consulta>now()-interval '15 seconds' then raise exception 'Aguarde quinze segundos entre consultas de extrato da loja';end if;
 select decrypted_secret into s from vault.decrypted_secrets where id=c.segredo_id;
 if s is null then raise exception 'Certificado do extrato indisponível no cofre';end if;
 update sicoob_extrato_config_352 set ultima_consulta=now() where centro_id=_centro;
 insert into auditoria(tabela,registro_id,acao,user_id,detalhe) values('sicoob_extrato_config_352',_centro,'consultar_extrato',_actor,'{}');
 return jsonb_build_object('clientId',c.client_id,'numeroConta',c.numero_conta,'certificado',s::jsonb);
end $$;
do $$declare f regprocedure;begin
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in('sicoob_extrato_config_352','sicoob_extrato_salvar_352','sicoob_extrato_reservar_352') loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
