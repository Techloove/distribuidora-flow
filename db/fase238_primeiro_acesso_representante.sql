-- Após237/221. Complemento obrigatório somente nas próximas aprovações públicas.
-- Preserva usuários existentes, papéis, carteiras, centros e regras comerciais.
begin;
do $$ begin
 if to_regprocedure('public.admin_decidir_cadastro_221(uuid,boolean,uuid,uuid[],text)') is null or to_regclass('public.cobranca_centros') is null then
  raise exception 'Aplique as fases221 e237 antes da fase238'; end if;
end $$;
alter table public.profiles add column if not exists precisa_completar_cadastro boolean not null default false;
alter table public.profiles add column if not exists cadastro_completo_em timestamptz;
create table if not exists public.cadastro_complementos_238(
 usuario_id uuid primary key references public.profiles(id),pessoa_id uuid not null references public.pessoas(id),concluido_em timestamptz not null
);
alter table public.cadastro_complementos_238 enable row level security;
revoke all on public.cadastro_complementos_238 from public,anon,authenticated;
grant all on public.cadastro_complementos_238 to service_role;
create or replace function public.complemento_pendente_238() returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles where id=auth.uid() and precisa_completar_cadastro);
$$;
revoke all on function public.complemento_pendente_238() from public,anon;
grant execute on function public.complemento_pendente_238() to authenticated;
-- CREATE OR REPLACE conserva os OIDs já referenciados em policies/views. Não renomeia helpers.
do $$ declare nome text; corpo text; assinatura text; argumento text; linguagem text; begin
 foreach nome in array array['usuario_ativo','can_manage','can_finance','can_stock','can_operate','can_ship','has_role'] loop
  assinatura:=case when nome='usuario_ativo' then '' when nome='has_role' then '_user_id uuid, _role public.app_role' else '_user_id uuid' end;
  select p.prosrc,l.lanname into corpo,linguagem from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
   where n.nspname='public' and p.proname=nome and p.oid=to_regprocedure(format('public.%I(%s)',nome,case when assinatura='' then '' when nome='has_role' then 'uuid,public.app_role' else 'uuid' end));
  if corpo is null or linguagem<>'sql' then raise exception 'Helper % ausente ou incompatível. Nenhuma alteração aplicada',nome; end if;
  if position('complemento238' in corpo)=0 then
   corpo:=regexp_replace(btrim(corpo),';\s*$','');
   argumento:=case when nome='usuario_ativo' then 'auth.uid()' else '_user_id' end;
   execute format('create or replace function public.%I(%s) returns boolean language sql stable security definer set search_path=public as $fn$ -- complemento238
    select coalesce((select not precisa_completar_cadastro from public.profiles where id=%s),false) and (%s) $fn$',nome,assinatura,argumento,corpo);
  end if;
 end loop;
end $$;
-- Defesa também contra leituras/escritas diretas em tabelas com RLS, sem restringir a leitura da própria sessão.
do $$ declare t record; begin
 for t in select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' and relrowsecurity and relname not in ('profiles','user_roles') loop
  execute format('drop policy if exists complemento_cadastro_238 on public.%I',t.relname);
  execute format('create policy complemento_cadastro_238 on public.%I as restrictive for all to authenticated using (not public.complemento_pendente_238()) with check (not public.complemento_pendente_238())',t.relname);
 end loop;
end $$;
-- Marca a próxima aprovação, sem alterar cadastros já aprovados na migração.
create or replace function public.exigir_complemento_aprovacao_238() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if old.cadastro_status in ('pendente','recusado') and new.cadastro_status='aprovado' then
  new.precisa_completar_cadastro:=true;new.cadastro_completo_em:=null;
 end if;
 return new;
end $$;
revoke all on function public.exigir_complemento_aprovacao_238() from public,anon,authenticated;
drop trigger if exists complemento_aprovacao_238 on public.profiles;
create trigger complemento_aprovacao_238 before update on public.profiles for each row execute function public.exigir_complemento_aprovacao_238();
-- Somente a RPC validada grava prova de conclusão. Um PATCH no perfil não consegue forjar essa prova.
create or replace function public.proteger_campos_perfil() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is not null and not public.can_manage(auth.uid()) and
  (to_jsonb(new)-array['nome','telefone','updated_at']) is distinct from (to_jsonb(old)-array['nome','telefone','updated_at']) then
  if not (new.id=auth.uid() and old.precisa_completar_cadastro and not new.precisa_completar_cadastro
   and new.cadastro_status='aprovado' and new.ativo
   and (to_jsonb(new)-array['nome','telefone','updated_at','precisa_completar_cadastro','cadastro_completo_em'])
    is not distinct from (to_jsonb(old)-array['nome','telefone','updated_at','precisa_completar_cadastro','cadastro_completo_em'])
   and exists(select 1 from public.cadastro_complementos_238 c join public.representantes r on r.pessoa_id=c.pessoa_id
    where c.usuario_id=new.id and r.profile_id=new.id and r.ativo and c.concluido_em=new.cadastro_completo_em
    and c.concluido_em>=coalesce(old.cadastro_decidido_em,'epoch'::timestamptz))) then
    raise exception 'Somente administradores alteram acesso. Complete seu cadastro pelo formulário inicial' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.proteger_campos_perfil() from public,anon,authenticated;

create or replace function public.meu_cadastro_inicial_238() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare p public.profiles;r public.representantes;c public.pessoas;
begin
 select * into p from public.profiles where id=auth.uid();
 if p.id is null or not p.ativo or p.cadastro_status<>'aprovado' or not p.precisa_completar_cadastro then raise exception 'Complemento disponível somente após aprovação do administrador'; end if;
 if (select count(*) from public.representantes where profile_id=p.id and ativo)<>1 then raise exception 'Solicite ao administrador a correção do seu vínculo de representante'; end if;
 select * into r from public.representantes where profile_id=p.id and ativo;
 select * into c from public.pessoas where id=r.pessoa_id;
 if c.id is not null and ((c.profile_id is not null and c.profile_id<>p.id) or exists(select 1 from public.representantes where pessoa_id=c.id and id<>r.id)) then raise exception 'Vínculo de cadastro inconsistente. Solicite revisão ao administrador'; end if;
 return jsonb_build_object('nome',coalesce(c.razao_social,p.nome,r.nome),'email',p.email,'telefone',coalesce(c.telefone,p.telefone,r.telefone),
  'tipo_pessoa',coalesce(c.tipo_pessoa,'PF'),'cnpj_cpf',c.cnpj_cpf,'logradouro',c.logradouro,'numero',c.numero,'complemento',c.complemento,'bairro',c.bairro,'cidade',c.cidade,'uf',c.uf,'cep',c.cep);
end $$;
revoke all on function public.meu_cadastro_inicial_238() from public,anon;
grant execute on function public.meu_cadastro_inicial_238() to authenticated;
create or replace function public.completar_meu_cadastro_238(_dados jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare p public.profiles;r public.representantes;c public.pessoas;pid uuid;v_doc text;v_nome text;v_fone text;v_uf text;v_cep text;instante timestamptz;
begin
 select * into p from public.profiles where id=auth.uid() for update;
 if p.id is null or not p.ativo or p.cadastro_status<>'aprovado' or not p.precisa_completar_cadastro then raise exception 'Complemento disponível somente após aprovação do administrador'; end if;
 if jsonb_typeof(_dados) is distinct from 'object' then raise exception 'Dados pessoais inválidos'; end if;
 if exists(select 1 from jsonb_object_keys(_dados) k where k<>all(array['nome','tipo_pessoa','cnpj_cpf','telefone','logradouro','numero','complemento','bairro','cidade','uf','cep'])) then raise exception 'O formulário não altera acesso, comissões, carteira ou centros'; end if;
 if exists(select 1 from jsonb_each(_dados) d where jsonb_typeof(d.value) not in ('string','null')) then raise exception 'Preencha os dados como texto'; end if;
 v_nome:=btrim(_dados->>'nome');v_fone:=regexp_replace(coalesce(_dados->>'telefone',''),'\D','','g');
 v_doc:=upper(regexp_replace(coalesce(_dados->>'cnpj_cpf',''),'[.\-/\s]','','g'));v_uf:=upper(btrim(_dados->>'uf'));v_cep:=regexp_replace(coalesce(_dados->>'cep',''),'\D','','g');
 if v_nome is null or length(v_nome) not between 3 and 120 or length(v_fone) not between 10 and 15 then raise exception 'Informe nome completo e telefone com DDD'; end if;
 if coalesce(_dados->>'tipo_pessoa','') not in ('PF','PJ') or
  ((_dados->>'tipo_pessoa')='PF' and (v_doc!~'^[0-9]{11}$' or v_doc~'^([0-9])\1{10}$')) or
  ((_dados->>'tipo_pessoa')='PJ' and v_doc!~'^[A-Z0-9]{12}[0-9]{2}$') then raise exception 'Confira CPF (11 dígitos) ou CNPJ (14 caracteres) e o tipo de pessoa'; end if;
 if v_uf is null or v_uf<>all(array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']) or length(v_cep)<>8 then raise exception 'Informe UF válida e CEP com 8 dígitos'; end if;
 if exists(select 1 from unnest(array['logradouro','numero','bairro','cidade']) k where nullif(btrim(_dados->>k),'') is null)
 or exists(select 1 from jsonb_each_text(_dados) d where length(d.value)>200) then raise exception 'Complete o endereço (incluindo número ou S/N), sem ultrapassar 200 caracteres por campo'; end if;
 if (select count(*) from public.representantes where profile_id=p.id and ativo)<>1 then raise exception 'Solicite ao administrador a correção do seu vínculo de representante'; end if;
 select * into r from public.representantes where profile_id=p.id and ativo for update;
 pid:=r.pessoa_id;
 if pid is null then
  if (select count(*) from public.pessoas where profile_id=p.id)>1 then raise exception 'Há cadastros duplicados para seu login. Solicite revisão ao administrador'; end if;
  select id into pid from public.pessoas where profile_id=p.id;
 end if;
 if pid is not null then
  select * into c from public.pessoas where id=pid for update;
  if c.id is null or (c.profile_id is not null and c.profile_id<>p.id) or exists(select 1 from public.representantes where pessoa_id=pid and id<>r.id) then raise exception 'Vínculo de cadastro inconsistente. Solicite revisão ao administrador'; end if;
 end if;
 if exists(select 1 from public.pessoas where id is distinct from pid and upper(regexp_replace(coalesce(cnpj_cpf,''),'[.\-/\s]','','g'))=v_doc and cnpj_cpf is not null) then raise exception 'Documento já cadastrado. Solicite a vinculação ao administrador'; end if;
 if pid is null then
  insert into public.pessoas(razao_social,tipo_pessoa,profile_id,email,telefone,is_representante,is_usuario,regiao,comissao_percentual)
   values(v_nome,_dados->>'tipo_pessoa',p.id,p.email,v_fone,false,true,r.regiao,coalesce(r.comissao_percentual,0)) returning id into pid;
  update public.representantes set pessoa_id=pid where id=r.id;
 else
  update public.representantes set pessoa_id=pid where id=r.id and pessoa_id is distinct from pid;
 end if;
 update public.pessoas set razao_social=v_nome,tipo_pessoa=_dados->>'tipo_pessoa',cnpj_cpf=v_doc,telefone=v_fone,email=p.email,
  logradouro=btrim(_dados->>'logradouro'),numero=btrim(_dados->>'numero'),complemento=nullif(btrim(_dados->>'complemento'),''),bairro=btrim(_dados->>'bairro'),cidade=btrim(_dados->>'cidade'),uf=v_uf,cep=v_cep,
  is_representante=true,is_usuario=true,ativo=true,profile_id=p.id,regiao=r.regiao,comissao_percentual=coalesce(r.comissao_percentual,0)
 where id=pid;
 if not exists(select 1 from public.representantes where id=r.id and pessoa_id=pid and profile_id=p.id and ativo) then raise exception 'Não foi possível preservar seu vínculo de representante'; end if;
 instante:=clock_timestamp();
 insert into public.cadastro_complementos_238(usuario_id,pessoa_id,concluido_em) values(p.id,pid,instante)
  on conflict(usuario_id) do update set pessoa_id=excluded.pessoa_id,concluido_em=excluded.concluido_em;
 update public.profiles set nome=v_nome,telefone=v_fone,precisa_completar_cadastro=false,cadastro_completo_em=instante where id=p.id;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pessoas',pid,'completar_cadastro_inicial',p.id,jsonb_build_object('representante_id',r.id));
 return pid;
end $$;
revoke all on function public.completar_meu_cadastro_238(jsonb) from public,anon;
grant execute on function public.completar_meu_cadastro_238(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
