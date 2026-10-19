-- Correção pontual: mantém o representante e o login existentes; não cria outro representante.
begin;
set local lock_timeout='5s';
do $vincular$
declare r public.representantes; p public.pessoas; pid uuid; n integer; antes jsonb;
begin
 if current_user not in ('postgres','supabase_admin') and not public.has_role(auth.uid(),'admin') then raise exception 'Execute como administrador no SQL Editor'; end if;
 lock table public.pessoas,public.representantes in share row exclusive mode nowait;
 select * into r from public.representantes where id='dfa871a6-0b2e-4624-aaa4-c2e0cc71f548' for update;
 if r.id is null or r.ativo is distinct from true then raise exception 'Representante principal nao encontrado/ativo'; end if;
 if r.profile_id is null or not exists(select 1 from public.profiles where id=r.profile_id and ativo) then raise exception 'Confira o login ativo do representante antes de vincular'; end if;
 antes:=to_jsonb(r)-'pessoa_id'-'updated_at';
 pid:=r.pessoa_id;
 if pid is null then
  select count(*) into n from public.pessoas where profile_id=r.profile_id or
   regexp_replace(translate(lower(btrim(razao_social)),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'\s+',' ','g')='edson luiz cardoso';
  if n>1 then raise exception 'Ha mais de uma pessoa candidata. Confira os cadastros antes de vincular'; end if;
  select id into pid from public.pessoas where profile_id=r.profile_id or
   regexp_replace(translate(lower(btrim(razao_social)),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'\s+',' ','g')='edson luiz cardoso';
 end if;
 if pid is null then
  -- Primeiro cria Pessoa SEM função Representante para o gatilho não criar duplicidade.
  insert into public.pessoas(razao_social,tipo_pessoa,email,telefone,regiao,comissao_percentual,ativo,is_representante,is_usuario,profile_id)
  values(r.nome,'PF',r.email,r.telefone,r.regiao,coalesce(r.comissao_percentual,0),true,false,true,r.profile_id)
  returning id into pid;
 else
  select * into p from public.pessoas where id=pid for update;
  if p.id is null then raise exception 'Pessoa vinculada nao encontrada'; end if;
  if p.profile_id is not null and p.profile_id<>r.profile_id then raise exception 'Pessoa vinculada a outro login. Nenhuma alteracao aplicada'; end if;
  if exists(select 1 from public.representantes where pessoa_id=pid and id<>r.id) then raise exception 'Pessoa ja vinculada a outro representante. Confira antes de continuar'; end if;
 end if;
 -- Estabelece o vínculo ANTES de ativar a função na Pessoa.
 update public.representantes set pessoa_id=pid where id=r.id;
 update public.pessoas set razao_social=r.nome,email=r.email,telefone=r.telefone,regiao=r.regiao,
  comissao_percentual=coalesce(r.comissao_percentual,0),is_representante=true,is_usuario=true,ativo=true,profile_id=r.profile_id
 where id=pid;
 if (select to_jsonb(rep)-'pessoa_id'-'updated_at' from public.representantes rep where rep.id=r.id) is distinct from antes then
  raise exception 'O gatilho alterou dados do representante alem do vinculo. Operacao desfeita'; end if;
 if (select count(*) from public.representantes where profile_id=r.profile_id)<>1 then raise exception 'Login possui representante duplicado. Operacao desfeita'; end if;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe)
 values('representantes',r.id,'vincular_edson_cadastro_unificado',auth.uid(),jsonb_build_object('representante_antes',to_jsonb(r),'pessoa_antes',to_jsonb(p),'pessoa_id',pid,'profile_id',r.profile_id));
end;
$vincular$;
select r.nome,p.id as pessoa_id,p.codigo,p.razao_social,p.is_representante,p.is_usuario,p.ativo,p.profile_id,
 (select count(*) from public.clientes c where c.representante_id=r.id) as clientes
from public.representantes r join public.pessoas p on p.id=r.pessoa_id
where r.id='dfa871a6-0b2e-4624-aaa4-c2e0cc71f548';
commit;
