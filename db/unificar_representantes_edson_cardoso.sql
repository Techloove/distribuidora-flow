-- Correção pontual, NÃO é migração de estrutura.
-- SQL Editor do Supabase correto. Mantém Édson Luiz Cardoso como principal.
-- Transação integral: conflitos abortam tudo. Não exclui usuários nem altera valores financeiros.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
create temporary table if not exists unificacao_edson_refs(tabela text,coluna text,antes jsonb,esperado jsonb) on commit drop;
truncate pg_temp.unificacao_edson_refs;
do $unificar$
declare origem public.representantes; destino public.representantes; r record; n integer;
 v_profile uuid; old_pessoas jsonb; snapshot jsonb; esperado jsonb; depois jsonb; actor uuid:=auth.uid();
begin
 if current_user not in ('postgres','supabase_admin') and not public.has_role(actor,'admin') then
  raise exception 'Execute como administrador no SQL Editor do Supabase'; end if;
 lock table public.pessoas,public.representantes in share row exclusive mode nowait;
 select count(*) into n from public.representantes where
  regexp_replace(translate(lower(btrim(nome)),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'\s+',' ','g')='edson cardoso';
 if n<>1 then raise exception 'Esperado exatamente um cadastro Edson Cardoso; encontrados %. Nenhum dado alterado',n; end if;
 select * into origem from public.representantes where
  regexp_replace(translate(lower(btrim(nome)),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'\s+',' ','g')='edson cardoso' for update;
 select count(*) into n from public.representantes where
  regexp_replace(translate(lower(btrim(nome)),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'\s+',' ','g')='edson luiz cardoso';
 if n<>1 then raise exception 'Esperado exatamente um cadastro Edson Luiz Cardoso; encontrados %. Nenhum dado alterado',n; end if;
 select * into destino from public.representantes where
  regexp_replace(translate(lower(btrim(nome)),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'\s+',' ','g')='edson luiz cardoso' for update;
 if origem.id=destino.id or (origem.pessoa_id is not null and origem.pessoa_id=destino.pessoa_id) then raise exception 'Identificadores de origem e destino inconsistentes'; end if;
 if origem.profile_id is not null and destino.profile_id is not null and origem.profile_id<>destino.profile_id then
  raise exception 'Os representantes possuem dois logins distintos. Confira os usuarios antes de unificar'; end if;
 v_profile:=coalesce(destino.profile_id,origem.profile_id);
 if exists(select 1 from public.pessoas where id=destino.pessoa_id and profile_id is not null and profile_id is distinct from v_profile)
 or exists(select 1 from public.pessoas where id=origem.pessoa_id and profile_id is not null and profile_id is distinct from v_profile) then
  raise exception 'Vinculo de login do cadastro unificado diverge do representante. Nenhum dado alterado'; end if;
 select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) into old_pessoas from public.pessoas p where id in (origem.pessoa_id,destino.pessoa_id);
 -- Não adivinha como combinar metas ou regras comerciais diferentes.
 if to_regclass('public.metas_vendas') is not null then
  execute 'select count(*) from public.metas_vendas a join public.metas_vendas b on a.ano=b.ano and a.mes=b.mes where a.representante_id=$1 and b.representante_id=$2' into n using origem.id,destino.id;
  if n>0 then raise exception 'Ha metas dos dois cadastros na mesma competencia. Revise antes de unificar'; end if;
 end if;
 -- Descobre TODOS os vínculos declarados no banco, sem limitar a clientes/pedidos.
 for r in select c.conrelid::regclass as tabela,a.attname as coluna,c.conkey,c.confkey,ns.nspname
  from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace ns on ns.oid=t.relnamespace
  join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.contype='f' and c.confrelid='public.representantes'::regclass order by c.conrelid,a.attname
 loop
  if r.nspname<>'public' or cardinality(r.conkey)<>1 or cardinality(r.confkey)<>1 then raise exception 'Vinculo composto/externo nao previsto: %. Revise antes de unificar',r.tabela; end if;
  execute format('lock table %s in share row exclusive mode nowait',r.tabela);
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from %s t where %I in ($1,$2)',r.tabela,r.coluna)
    into snapshot using origem.id,destino.id;
  select coalesce(jsonb_agg((x-r.coluna-'updated_at')||jsonb_build_object(r.coluna,destino.id) order by ((x-r.coluna-'updated_at')||jsonb_build_object(r.coluna,destino.id))::text),'[]'::jsonb)
   into esperado from jsonb_array_elements(snapshot) x;
  insert into pg_temp.unificacao_edson_refs values(r.tabela::text,r.coluna,snapshot,esperado);
 end loop;
 -- Rotas comuns já cadastradas no principal são o mesmo vínculo; arquiva antes de deduplicar.
 if to_regclass('public.representante_rotas') is not null then
  delete from public.representante_rotas a using public.representante_rotas b
   where a.representante_id=origem.id and b.representante_id=destino.id and a.rota_id=b.rota_id;
 end if;
 -- Se existe regra própria ativa nos dois cadastros, evita mudar prioridades/comissões por acidente.
 for r in select unnest(array['regras_comissao','comissao_faixas']) as tabela loop
  if to_regclass('public.'||r.tabela) is not null then
   execute format('select case when exists(select 1 from public.%I where representante_id=$1 and ativo) and exists(select 1 from public.%I where representante_id=$2 and ativo) then 1 else 0 end',r.tabela,r.tabela) into n using origem.id,destino.id;
   if n>0 then raise exception 'Existem regras ativas nos dois cadastros em %. Revise as regras antes de unificar',r.tabela; end if;
  end if;
 end loop;
 for r in select tabela,coluna from pg_temp.unificacao_edson_refs loop
  execute format('update %s set %I=$1 where %I=$2',r.tabela,r.coluna,r.coluna) using destino.id,origem.id;
 end loop;
 -- A sincronização de Pessoas não deve recriar/reativar o representante duplicado.
 if origem.pessoa_id is not null then
  update public.pessoas set is_representante=false,profile_id=null where id=origem.pessoa_id;
 end if;
 update public.representantes set ativo=false,profile_id=null where id=origem.id;
 if destino.pessoa_id is not null then
  update public.pessoas set is_representante=true,ativo=true,profile_id=v_profile where id=destino.pessoa_id;
 end if;
 update public.representantes set ativo=true,profile_id=v_profile where id=destino.id;
 -- Prova de integridade: nenhuma referência restante e nenhum valor/status alterado pelos triggers.
 for r in select * from pg_temp.unificacao_edson_refs loop
  execute format('select count(*) from %s where %I=$1',r.tabela,r.coluna) into n using origem.id;
  if n<>0 then raise exception 'Ainda existem vinculos no cadastro antigo em %',r.tabela; end if;
  if r.tabela not in ('pessoas','public.pessoas','representante_rotas','public.representante_rotas') then
   execute format('select coalesce(jsonb_agg(to_jsonb(t)-''updated_at'' order by (to_jsonb(t)-''updated_at'')::text),''[]''::jsonb) from %s t where %I=$1',r.tabela,r.coluna) into depois using destino.id;
   if depois is distinct from r.esperado then raise exception 'Um gatilho alterou dados alem do representante em %. Operacao desfeita',r.tabela; end if;
  end if;
 end loop;
 if (select count(*) from public.representantes where profile_id=v_profile and ativo)<>(case when v_profile is null then 0 else 1 end) then raise exception 'Login com vinculo de representante ambiguo'; end if;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe)
 values('representantes',destino.id,'unificar_edson_cardoso',actor,jsonb_build_object(
  'origem',to_jsonb(origem),'destino_antes',to_jsonb(destino),'pessoas_antes',old_pessoas,
  'vinculos_antes',(select jsonb_agg(to_jsonb(s)-'esperado') from pg_temp.unificacao_edson_refs s),
  'observacao','Vinculos transferidos, cadastro de origem preservado inativo; valores financeiros preservados'));
 raise notice 'Unificacao concluida: % -> %. Login preservado: %',origem.id,destino.id,v_profile;
end;
$unificar$;
select r.id,r.nome,r.ativo,r.profile_id,
 (select count(*) from public.clientes c where c.representante_id=r.id) as clientes
from public.representantes r where
 regexp_replace(translate(lower(btrim(r.nome)),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'\s+',' ','g') in ('edson cardoso','edson luiz cardoso')
order by r.ativo desc,r.nome;
commit;
