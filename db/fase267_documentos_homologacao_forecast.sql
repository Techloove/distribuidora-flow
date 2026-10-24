-- Arquivos de homologação isolados. Aplicar manualmente após a fase266.
begin;
do $$begin
 if to_regprocedure('public.status_hml_forecast_266(uuid)') is null then raise exception 'Aplique a fase266 antes da fase267';end if;
end $$;
create table if not exists public.forecast_documentos_hml_267(
 nota_id uuid not null references public.forecast_homologacoes_266(nota_id),
 tipo text not null check(tipo in ('xml','pdf')),
 conteudo bytea not null check(octet_length(conteudo) between 1 and 5242880),
 sha256 text generated always as (encode(sha256(conteudo),'hex')) stored,
 prova jsonb not null check(jsonb_typeof(prova)='object'),
 created_at timestamptz not null default now(),created_by uuid not null references public.profiles(id),
 primary key(nota_id,tipo)
);
alter table public.forecast_documentos_hml_267 enable row level security;
revoke all on public.forecast_documentos_hml_267 from public,anon,authenticated;
grant all on public.forecast_documentos_hml_267 to service_role;

create or replace function public.contexto_documento_hml_267(_actor uuid,_nota uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$declare c jsonb;j public.forecast_homologacoes_266;cr public.forecast_credenciais_262;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 c:=public.contexto_forecast_actor_266(_nota,_actor);
 select * into j from public.forecast_homologacoes_266 where nota_id=_nota;
 if j.nota_id is null or j.envio_iniciado_em is null then raise exception 'Não existe tentativa de homologação para consultar documentos';end if;
 select * into cr from public.forecast_credenciais_262 where centro_id=j.centro_id;
 if cr.cnpj is distinct from j.cnpj or cr.ambiente_declarado is distinct from 'homologacao' or md5(cr.token) is distinct from j.token_hash
 or c#>>'{loja,id}' is distinct from j.centro_id::text or upper(regexp_replace(c#>>'{loja,cnpj}','[^a-zA-Z0-9]','','g')) is distinct from j.cnpj then
  raise exception 'Credencial ou CNPJ divergente do documento de homologação';end if;
 return jsonb_build_object('nota_id',j.nota_id,'ref',j.ref,'cnpj',j.cnpj,'serie',j.serie,'payload',j.payload,'token',cr.token,'chave_confirmada',j.resultado->>'chave','protocolo_confirmado',j.resultado->>'protocolo');
end $$;
revoke all on function public.contexto_documento_hml_267(uuid,uuid) from public,anon,authenticated;
grant execute on function public.contexto_documento_hml_267(uuid,uuid) to service_role;

create or replace function public.registrar_documento_hml_267(_actor uuid,_nota uuid,_tipo text,_base64 text,_prova jsonb) returns void
language plpgsql security definer set search_path=public as $$declare c jsonb;b bytea;p jsonb;existente public.forecast_documentos_hml_267;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 if _tipo is null or _tipo not in ('xml','pdf') or _base64 is null or length(_base64)>7000000 or _prova is null or length(_prova::text)>5000 then raise exception 'Documento inválido ou muito extenso';end if;
 perform 1 from public.forecast_homologacoes_266 where nota_id=_nota for update;
 c:=public.contexto_documento_hml_267(_actor,_nota);
 b:=decode(_base64,'base64');
 if octet_length(b) not between 1 and 5242880 then raise exception 'Documento fora do limite de tamanho';end if;
 if _tipo='xml' then
  if (c->>'chave_confirmada' is not null and c->>'chave_confirmada' is distinct from _prova->>'chave') or (c->>'protocolo_confirmado' is not null and c->>'protocolo_confirmado' is distinct from _prova->>'protocolo') then raise exception 'XML diverge do retorno já confirmado';end if;
  if not coalesce(_prova->>'ambiente'='homologacao' and _prova->>'validacao'='estrutura_identidade_sem_assinatura'
   and (_prova->>'chave') ~ '^[0-9]{44}$' and substring(_prova->>'chave',7,14)=c->>'cnpj'
   and (_prova->>'protocolo') ~ '^[0-9]{15}$' and (_prova->>'numero') ~ '^[0-9]{1,9}$'
   and _prova->>'serie'=c->>'serie' and _prova->>'cnpj'=c->>'cnpj' and _prova->>'valor_total'=c#>>'{payload,valor_total}',false) then raise exception 'Identidade do XML de homologação inválida';end if;
  p:=jsonb_build_object('chave',_prova->>'chave','protocolo',_prova->>'protocolo','numero',_prova->>'numero','serie',_prova->>'serie','cnpj',_prova->>'cnpj','valor_total',_prova->>'valor_total','ambiente','homologacao','validacao','estrutura_identidade_sem_assinatura');
 else
  if substring(b,1,5) is distinct from convert_to('%PDF-','UTF8') then raise exception 'Formato PDF inválido';end if;
  select prova into p from public.forecast_documentos_hml_267 where nota_id=_nota and tipo='xml';
  if p is null then raise exception 'Obtenha e confira o XML antes do DANFE';end if;
  p:=p||jsonb_build_object('validacao_pdf','formato_e_referencia_sem_extracao_de_texto');
 end if;
 select * into existente from public.forecast_documentos_hml_267 where nota_id=_nota and tipo=_tipo;
 if existente.nota_id is not null then
  if existente.sha256 is distinct from encode(sha256(b),'hex') then raise exception 'Documento remoto mudou. O arquivo original foi preservado para revisão';end if;
  return;
 end if;
 insert into public.forecast_documentos_hml_267(nota_id,tipo,conteudo,prova,created_by) values(_nota,_tipo,b,p,_actor);
 insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id) values('notas_saida',_nota,'forecast_hml_documento_'||_tipo,jsonb_build_object('ref',c->>'ref','sha256',encode(sha256(b),'hex'),'bytes',octet_length(b),'ambiente','homologacao'),_actor);
 -- Não modifica estado da tentativa nem status/chave/XML/DANFE da nota operacional.
end $$;
revoke all on function public.registrar_documento_hml_267(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.registrar_documento_hml_267(uuid,uuid,text,text,jsonb) to service_role;

create or replace function public.documentos_hml_forecast_267(_nota uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$declare c jsonb;j public.forecast_homologacoes_266;begin
 c:=public.contexto_homologacao_forecast_265(_nota);
 select * into j from public.forecast_homologacoes_266 where nota_id=_nota;
 if j.nota_id is not null and c#>>'{loja,id}' is distinct from j.centro_id::text then raise exception 'Documento fora da loja autorizada';end if;
 return jsonb_build_object('ref',j.ref,'cnpj',j.cnpj,'envio_iniciado',j.envio_iniciado_em is not null,'documentos',coalesce((select jsonb_agg(jsonb_build_object('tipo',d.tipo,'sha256',d.sha256,'bytes',octet_length(d.conteudo),'prova',d.prova,'created_at',d.created_at) order by d.tipo) from public.forecast_documentos_hml_267 d where d.nota_id=_nota),'[]'::jsonb));
end $$;
revoke all on function public.documentos_hml_forecast_267(uuid) from public,anon,service_role;
grant execute on function public.documentos_hml_forecast_267(uuid) to authenticated;

create or replace function public.ler_documento_hml_267(_nota uuid,_tipo text) returns jsonb
language plpgsql stable security definer set search_path=public as $$declare a jsonb;d public.forecast_documentos_hml_267;begin
 a:=public.documentos_hml_forecast_267(_nota);
 if _tipo is null or _tipo not in ('xml','pdf') then raise exception 'Tipo de documento inválido';end if;
 select * into d from public.forecast_documentos_hml_267 where nota_id=_nota and tipo=_tipo;
 if d.nota_id is null then return null;end if;
 return jsonb_build_object('tipo',d.tipo,'mime',case when d.tipo='xml' then 'application/xml' else 'application/pdf' end,'nome',a->>'ref'||'-HOMOLOGACAO.'||d.tipo,'base64',replace(encode(d.conteudo,'base64'),E'\n',''),'sha256',d.sha256);
end $$;
revoke all on function public.ler_documento_hml_267(uuid,text) from public,anon,service_role;
grant execute on function public.ler_documento_hml_267(uuid,text) to authenticated;
create or replace function public.preservar_identidade_xml_hml_267() returns trigger
language plpgsql security definer set search_path=public as $$declare p jsonb;begin
 select prova into p from public.forecast_documentos_hml_267 where nota_id=new.nota_id and tipo='xml';
 if p is not null and ((new.resultado->>'chave' is not null and new.resultado->>'chave' is distinct from p->>'chave') or (new.resultado->>'protocolo' is not null and new.resultado->>'protocolo' is distinct from p->>'protocolo')) then
  raise exception 'Retorno divergente do XML armazenado. O arquivo original foi preservado';end if;
 return new;
end $$;
revoke all on function public.preservar_identidade_xml_hml_267() from public,anon,authenticated;
drop trigger if exists preservar_identidade_xml_hml_267 on public.forecast_homologacoes_266;
create trigger preservar_identidade_xml_hml_267 before update of resultado on public.forecast_homologacoes_266 for each row execute function public.preservar_identidade_xml_hml_267();
notify pgrst,'reload schema';
commit;
