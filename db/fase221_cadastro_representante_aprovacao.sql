-- Fase221: primeiro cadastro público como representante, sem acesso até aprovação.
-- Usuários existentes e a criação administrativa conservam seu comportamento.
begin;
alter table public.profiles add column if not exists cadastro_status text not null default 'interno' check(cadastro_status in ('interno','pendente','aprovado','recusado'));
alter table public.profiles add column if not exists cadastro_decidido_por uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists cadastro_decidido_em timestamptz;
alter table public.profiles add column if not exists cadastro_motivo text;
create index if not exists cadastro_pendente_221 on public.profiles(created_at,id) where cadastro_status='pendente';

create or replace function public.usuario_ativo()
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.ativo and p.cadastro_status in ('interno','aprovado'))
 and exists(select 1 from public.user_roles where user_id=auth.uid());
$$;
revoke all on function public.usuario_ativo() from public,anon;
grant execute on function public.usuario_ativo() to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 -- Metadados do solicitante nunca escolhem papel, situação ou centros.
 insert into public.profiles(id,nome,email,telefone,ativo,todos_centros,cadastro_status)
 values(new.id,left(trim(coalesce(new.raw_user_meta_data->>'nome','')),120),new.email,
 nullif(left(trim(coalesce(new.raw_user_meta_data->>'telefone','')),30),''),false,false,'pendente');
 insert into public.user_roles(user_id,role) values(new.id,'representante');
 return new;
end $$;
revoke all on function public.handle_new_user() from public,anon,authenticated;

create or replace function public.proteger_cadastro_221()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.cadastro_status is distinct from old.cadastro_status or new.cadastro_decidido_por is distinct from old.cadastro_decidido_por or
 new.cadastro_decidido_em is distinct from old.cadastro_decidido_em or new.cadastro_motivo is distinct from old.cadastro_motivo or
 (old.cadastro_status in ('pendente','recusado') and new.ativo) then
  if auth.uid() is not null and (not public.usuario_ativo() or not public.has_role(auth.uid(),'admin')) then raise exception 'Somente administrador ativo pode autorizar cadastros' using errcode='42501'; end if;
 end if;
 if new.cadastro_status in ('pendente','recusado') and new.ativo then raise exception 'Autorize o cadastro antes de ativar o usuário'; end if;
 if old.cadastro_status in ('pendente','recusado') and new.cadastro_status='aprovado' then
  if new.cadastro_decidido_por is null or new.cadastro_decidido_em is null or not new.ativo or new.todos_centros or
   not exists(select 1 from public.representantes r where r.profile_id=new.id and r.ativo) or
   not exists(select 1 from public.usuario_centros uc join public.centros c on c.id=uc.centro_id and c.ativo where uc.user_id=new.id) or
   not exists(select 1 from public.user_roles where user_id=new.id and role::text='representante') or
   exists(select 1 from public.user_roles where user_id=new.id and role::text<>'representante') then
   raise exception 'A autorização exige representante, centros definidos e somente o papel representante';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists proteger_cadastro_221 on public.profiles;
create trigger proteger_cadastro_221 before update on public.profiles for each row execute function public.proteger_cadastro_221();
revoke all on function public.proteger_cadastro_221() from public,anon,authenticated;

create or replace function public.admin_decidir_cadastro_221(_usuario uuid,_autorizar boolean,_representante uuid default null,_centros uuid[] default null,_motivo text default null)
returns void language plpgsql security definer set search_path=public as $$
declare p public.profiles; r public.representantes;
begin
 if not public.usuario_ativo() or not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador ativo pode decidir cadastros'; end if;
 if _autorizar is null or _usuario=auth.uid() then raise exception 'Decisão inválida'; end if;
 select * into p from public.profiles where id=_usuario for update;
 if p.id is null or p.cadastro_status not in ('pendente','recusado') then raise exception 'Cadastro inexistente ou já autorizado; atualize a lista'; end if;
 if _autorizar then
  if not exists(select 1 from auth.users where id=p.id and email_confirmed_at is not null and lower(email)=lower(p.email)) then raise exception 'O representante precisa confirmar o e-mail antes da autorização'; end if;
  if _centros is null or cardinality(_centros)=0 or cardinality(_centros)>100 or exists(select 1 from unnest(_centros) x where x is null or not exists(select 1 from public.centros where id=x and ativo)) then raise exception 'Selecione centros de custo ativos'; end if;
  if _representante is null then
   if exists(select 1 from public.representantes where profile_id=p.id) then raise exception 'Selecione o representante já vinculado ao usuário'; end if;
   insert into public.representantes(nome,email,telefone) values(coalesce(nullif(p.nome,''),p.email),p.email,p.telefone) returning * into r;
  else
   select * into r from public.representantes where id=_representante for update;
   if r.id is null or not r.ativo or (r.profile_id is not null and r.profile_id<>p.id) then raise exception 'Representante inativo ou vinculado a outro usuário'; end if;
  end if;
  perform public.admin_vincular_representante(p.id,r.id);
  perform public.definir_centros_usuario(p.id,false,_centros);
  delete from public.user_roles where user_id=p.id;
  insert into public.user_roles(user_id,role) values(p.id,'representante');
  update public.profiles set cadastro_status='aprovado',ativo=true,cadastro_decidido_por=auth.uid(),cadastro_decidido_em=now(),cadastro_motivo=null where id=p.id;
 else
  if nullif(trim(_motivo),'') is null or length(_motivo)>1000 then raise exception 'Informe uma justificativa de até 1000 caracteres'; end if;
  update public.profiles set cadastro_status='recusado',ativo=false,cadastro_decidido_por=auth.uid(),cadastro_decidido_em=now(),cadastro_motivo=trim(_motivo) where id=p.id;
 end if;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('profiles',p.id,case when _autorizar then 'autorizar_cadastro' else 'recusar_cadastro' end,auth.uid(),jsonb_build_object('representante',r.id,'centros',case when _autorizar then to_jsonb(_centros) else null end,'motivo',case when not _autorizar then trim(_motivo) else null end));
end $$;
revoke all on function public.admin_decidir_cadastro_221(uuid,boolean,uuid,uuid[],text) from public,anon;
grant execute on function public.admin_decidir_cadastro_221(uuid,boolean,uuid,uuid[],text) to authenticated;

-- Mantém a criação deliberada por administrador; o cadastro público não passa por esse RPC.
do $$ declare d text; begin
 select pg_get_functiondef('public.admin_criar_usuario(text,text,text,text)'::regprocedure) into d;
 if position('cadastro_interno_221' in d)=0 then
  if position('return novo_id;' in lower(d))=0 then raise exception 'Criação administrativa incompatível com fase221'; end if;
  d:=regexp_replace(d,'return novo_id;',E'-- cadastro_interno_221\n update public.profiles set cadastro_status=''interno'',ativo=true where id=novo_id;\n delete from public.user_roles where user_id=novo_id and role::text=''representante'';\n return novo_id;','i');
  execute d;
 end if;
end $$;

-- Sinal público sem dados pessoais: a interface só habilita cadastro após a migração.
create or replace function public.cadastro_representante_disponivel_221()
returns boolean language sql stable security invoker set search_path=public as $$ select true; $$;
revoke all on function public.cadastro_representante_disponivel_221() from public;
grant execute on function public.cadastro_representante_disponivel_221() to anon,authenticated;
notify pgrst,'reload schema';
commit;
