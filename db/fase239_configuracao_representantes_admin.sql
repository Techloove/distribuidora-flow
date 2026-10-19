-- Execute inteiro após a fase238. Comissão zero exige confirmação explícita do administrador.
begin;
do $$ begin
 if to_regprocedure('public.completar_meu_cadastro_238(jsonb)') is null then raise exception 'Aplique a fase238 antes da fase239';end if;
end $$;
alter table public.representantes add column if not exists comissao_definida_em timestamptz;
alter table public.representantes add column if not exists comissao_definida_por uuid references public.profiles(id) on delete set null;

create or replace function public.proteger_definicao_comissao_239() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if tg_op='INSERT' then
  if (new.comissao_definida_em is not null or new.comissao_definida_por is not null) and auth.uid() is not null and (not public.usuario_ativo() or not public.has_role(auth.uid(),'admin')) then
   raise exception 'Somente administrador confirma a comissão do representante' using errcode='42501';
  end if;
  return new;
 end if;
 if (new.comissao_definida_em is distinct from old.comissao_definida_em or new.comissao_definida_por is distinct from old.comissao_definida_por)
 and auth.uid() is not null and (not public.usuario_ativo() or not public.has_role(auth.uid(),'admin')) then
  raise exception 'Somente administrador confirma a comissão do representante' using errcode='42501';
 end if;
 if new.comissao_percentual is distinct from old.comissao_percentual and new.comissao_definida_em is not distinct from old.comissao_definida_em then
  new.comissao_definida_em:=null;new.comissao_definida_por:=null;
 end if;
 return new;
end $$;
revoke all on function public.proteger_definicao_comissao_239() from public,anon,authenticated;
drop trigger if exists proteger_definicao_comissao_239 on public.representantes;
create trigger proteger_definicao_comissao_239 before insert or update on public.representantes for each row execute function public.proteger_definicao_comissao_239();

-- Chamado internamente pelas duas operações administrativas; não é RPC pública.
create or replace function public.definir_comissao_representante_239(_representante uuid,_comissao numeric) returns void
language plpgsql security definer set search_path=public as $$
declare r public.representantes;
begin
 if not public.usuario_ativo() or not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador ativo define a comissão'; end if;
 if _comissao is null or _comissao<0 or _comissao>100 or _comissao<>round(_comissao,2) then raise exception 'Defina a comissão entre 0 e 100%%, com até duas casas decimais. Informe 0 explicitamente quando não houver comissão';end if;
 select * into r from public.representantes where id=_representante and ativo for update;
 if r.id is null then raise exception 'Representante ativo não encontrado';end if;
 update public.representantes set comissao_percentual=_comissao,comissao_definida_em=clock_timestamp(),comissao_definida_por=auth.uid() where id=r.id;
 if r.pessoa_id is not null then
  update public.pessoas set comissao_percentual=_comissao where id=r.pessoa_id;
 end if;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('representantes',r.id,'definir_comissao',auth.uid(),jsonb_build_object('comissao_anterior',r.comissao_percentual,'comissao_percentual',_comissao));
end $$;
revoke all on function public.definir_comissao_representante_239(uuid,numeric) from public,anon,authenticated;

-- Mesmo a RPC antiga não pode aprovar sem uma comissão deliberadamente confirmada.
create or replace function public.exigir_configuracao_aprovacao_239() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if old.cadastro_status in ('pendente','recusado') and new.cadastro_status='aprovado' then
  if not exists(select 1 from public.representantes r where r.profile_id=new.id and r.ativo and r.comissao_definida_em is not null and r.comissao_definida_por is not null and r.comissao_percentual between 0 and 100) then
   raise exception 'Antes de autorizar, o administrador deve definir e confirmar a comissão do representante';end if;
  if not exists(select 1 from public.usuario_centros uc join public.centros c on c.id=uc.centro_id and c.ativo where uc.user_id=new.id) or new.todos_centros then
   raise exception 'Antes de autorizar, o administrador deve selecionar os centros de custo permitidos';end if;
 end if;
 return new;
end $$;
revoke all on function public.exigir_configuracao_aprovacao_239() from public,anon,authenticated;
drop trigger if exists exigir_configuracao_aprovacao_239 on public.profiles;
create trigger exigir_configuracao_aprovacao_239 before update on public.profiles for each row execute function public.exigir_configuracao_aprovacao_239();

create or replace function public.admin_decidir_cadastro_239(_usuario uuid,_autorizar boolean,_representante uuid default null,_centros uuid[] default null,_motivo text default null,_comissao numeric default null) returns void
language plpgsql security definer set search_path=public as $$
declare p public.profiles;rid uuid;
begin
 if not public.usuario_ativo() or not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador ativo pode decidir cadastros';end if;
 select * into p from public.profiles where id=_usuario for update;
 if p.id is null or p.cadastro_status not in ('pendente','recusado') then raise exception 'Cadastro inexistente ou já autorizado';end if;
 if _autorizar then
  rid:=_representante;
  if rid is null then
   if exists(select 1 from public.representantes where profile_id=p.id) then raise exception 'Selecione o representante já vinculado ao usuário';end if;
   insert into public.representantes(nome,email,telefone) values(coalesce(nullif(p.nome,''),p.email),p.email,p.telefone) returning id into rid;
  elsif not exists(select 1 from public.representantes where id=rid and ativo and (profile_id is null or profile_id=p.id)) then
   raise exception 'Representante inativo ou vinculado a outro usuário';
  end if;
  perform public.definir_comissao_representante_239(rid,_comissao);
 end if;
 -- Mantém e-mail confirmado, centros ativos, papel representante e vínculo da fase221.
 perform public.admin_decidir_cadastro_221(_usuario,_autorizar,coalesce(rid,_representante),_centros,_motivo);
end $$;
revoke all on function public.admin_decidir_cadastro_239(uuid,boolean,uuid,uuid[],text,numeric) from public,anon;
grant execute on function public.admin_decidir_cadastro_239(uuid,boolean,uuid,uuid[],text,numeric) to authenticated;

create or replace function public.admin_configurar_representante_239(_representante uuid,_centros uuid[],_comissao numeric) returns void
language plpgsql security definer set search_path=public as $$
declare r public.representantes;
begin
 if not public.usuario_ativo() or not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador ativo configura representantes';end if;
 select * into r from public.representantes where id=_representante and ativo for update;
 if r.id is null or r.profile_id is null then raise exception 'Vincule primeiro o usuário ao representante';end if;
 if _centros is null or cardinality(_centros)=0 or cardinality(_centros)>100 or exists(select 1 from unnest(_centros) x where x is null or not exists(select 1 from public.centros where id=x and ativo)) then raise exception 'Selecione pelo menos um centro de custo ativo';end if;
 perform public.definir_comissao_representante_239(r.id,_comissao);
 perform public.definir_centros_usuario(r.profile_id,false,_centros);
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('representantes',r.id,'configurar_representante',auth.uid(),jsonb_build_object('centros',_centros,'comissao_percentual',_comissao));
end $$;
revoke all on function public.admin_configurar_representante_239(uuid,uuid[],numeric) from public,anon;
grant execute on function public.admin_configurar_representante_239(uuid,uuid[],numeric) to authenticated;

create or replace function public.admin_configuracoes_representantes_239()
returns table(representante_id uuid,usuario_id uuid,nome text,comissao_percentual numeric,comissao_confirmada boolean,centros uuid[],pendencias text[])
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.usuario_ativo() or not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador ativo consulta configurações de representantes';end if;
 return query
 select r.id,r.profile_id,r.nome,r.comissao_percentual,
  r.comissao_definida_em is not null and r.comissao_definida_por is not null,
  array(select c.id from public.centros c where c.ativo and (p.todos_centros or exists(select 1 from public.usuario_centros uc where uc.user_id=p.id and uc.centro_id=c.id)) order by c.nome,c.id),
  array_remove(array[
   case when not exists(select 1 from public.centros c where c.ativo and (p.todos_centros or exists(select 1 from public.usuario_centros uc where uc.user_id=p.id and uc.centro_id=c.id))) then 'Definir centros de custo' end,
   case when r.comissao_definida_em is null or r.comissao_definida_por is null or r.comissao_percentual is null or r.comissao_percentual not between 0 and 100 then 'Definir e confirmar comissão' end
  ],null)
 from public.representantes r join public.profiles p on p.id=r.profile_id
 where r.ativo and p.cadastro_status in ('aprovado','interno') order by r.nome,r.id;
end $$;
revoke all on function public.admin_configuracoes_representantes_239() from public,anon;
grant execute on function public.admin_configuracoes_representantes_239() to authenticated;
notify pgrst,'reload schema';
commit;
