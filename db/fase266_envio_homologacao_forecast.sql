-- Homologação isolada da operação real. Aplicação manual após a fase265.
begin;
do $$begin
 if to_regprocedure('public.contexto_homologacao_forecast_265(uuid)') is null then raise exception 'Aplique a fase265 antes da fase266';end if;
end $$;

create table if not exists public.forecast_liberacao_hml_266(
 centro_id uuid primary key references public.centros(id),cnpj text not null,
 credencial_versao timestamptz not null,fiscal_hash text not null,
 liberado boolean not null default false,updated_at timestamptz not null default now(),updated_by uuid not null references public.profiles(id)
);
create table if not exists public.forecast_homologacoes_266(
 nota_id uuid primary key references public.notas_saida(id),pedido_id uuid not null unique references public.pedidos(id),
 centro_id uuid not null references public.centros(id),cnpj text not null check(cnpj ~ '^[0-9]{14}$'),
 ref text not null unique check(ref ~ '^CPRHML[a-f0-9]{32}$'),serie text not null,
 ambiente text not null default 'HOMOLOGACAO' check(ambiente='HOMOLOGACAO'),
 contexto_hash text not null,token_hash text not null,payload jsonb not null check(jsonb_typeof(payload)='object' and payload->>'ambiente'='HOMOLOGACAO'),
 estado text not null default 'preparada' check(estado in ('preparada','enviando','processando','incerta','autorizada','rejeitada','cancelada')),
 envio_iniciado_em timestamptz,lease uuid,lease_ate timestamptz,resultado jsonb,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.forecast_liberacao_hml_266 enable row level security;
alter table public.forecast_homologacoes_266 enable row level security;
revoke all on public.forecast_liberacao_hml_266,public.forecast_homologacoes_266 from public,anon,authenticated;
grant all on public.forecast_liberacao_hml_266,public.forecast_homologacoes_266 to service_role;

create or replace function public.estado_homologacao_forecast_266(_loja uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$declare e jsonb;l public.forecast_liberacao_hml_266;c public.forecast_credenciais_262;h text;begin
 e:=public.estado_conexao_forecast_262(_loja);
 select * into c from public.forecast_credenciais_262 where centro_id=_loja;
 select * into l from public.forecast_liberacao_hml_266 where centro_id=_loja;
 select md5(to_jsonb(f)::text) into h from public.loja_fiscal_256 f where centro_id=_loja;
 return jsonb_build_object('liberado',coalesce(l.liberado and (e->>'vinculo_atual')::boolean and c.ambiente_declarado='homologacao' and l.cnpj=c.cnpj and l.credencial_versao=c.updated_at and l.fiscal_hash=h,false),'producao_liberada',false);
end $$;
revoke all on function public.estado_homologacao_forecast_266(uuid) from public,anon;
grant execute on function public.estado_homologacao_forecast_266(uuid) to authenticated;
create or replace function public.liberar_homologacao_forecast_266(_loja uuid,_liberado boolean) returns void
language plpgsql security definer set search_path=public as $$declare e jsonb;c public.forecast_credenciais_262;h text;begin
 perform 1 from public.centros where id=_loja for update;
 e:=public.estado_conexao_forecast_262(_loja);
 if not public.has_role(auth.uid(),'admin') or _liberado is null then raise exception 'Somente administrador configura a homologação';end if;
 select * into c from public.forecast_credenciais_262 where centro_id=_loja;
 select md5(to_jsonb(f)::text) into h from public.loja_fiscal_256 f where centro_id=_loja;
 if _liberado and (not coalesce((e->>'vinculo_atual')::boolean,false) or c.ambiente_declarado is distinct from 'homologacao' or h is null) then raise exception 'Configure o token de homologação e os dados fiscais do CNPJ atual';end if;
 if not _liberado then update public.forecast_liberacao_hml_266 set liberado=false,updated_at=now(),updated_by=auth.uid() where centro_id=_loja;return;end if;
 insert into public.forecast_liberacao_hml_266 values(_loja,c.cnpj,c.updated_at,h,true,now(),auth.uid())
 on conflict(centro_id) do update set cnpj=excluded.cnpj,credencial_versao=excluded.credencial_versao,fiscal_hash=excluded.fiscal_hash,liberado=true,updated_at=now(),updated_by=auth.uid();
 insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id) values('centros',_loja,'forecast_homologacao_liberada',jsonb_build_object('cnpj',c.cnpj,'ambiente','homologacao'),auth.uid());
end $$;
revoke all on function public.liberar_homologacao_forecast_266(uuid,boolean) from public,anon;
grant execute on function public.liberar_homologacao_forecast_266(uuid,boolean) to authenticated;

create or replace function public.contexto_forecast_actor_266(_nota uuid,_actor uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare n public.notas_saida;p public.pedidos;resultado jsonb;ator uuid:=_actor;rep uuid;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 if ator is null or not public.can_bill(ator)
 or not exists(select 1 from public.profiles a where a.id=ator and a.ativo and not coalesce(a.precisa_completar_cadastro,false) and coalesce(to_jsonb(a)->>'cadastro_status','interno') in ('interno','aprovado')) or not exists(select 1 from public.user_roles u where u.user_id=ator) then
  raise exception 'Sem permissão para conferir a homologação fiscal';end if;
 if not public.can_manage(ator) and not (
  exists(select 1 from public.user_roles u join public.role_permissoes rp on rp.role=u.role::text where u.user_id=ator and rp.permissao='faturamento_emitir_nfe')
  and exists(select 1 from public.user_roles u join public.role_menus rm on rm.role::text=u.role::text where u.user_id=ator and rm.path='/notas')) then
  raise exception 'Permissão fiscal não liberada para o usuário';end if;
 select * into n from public.notas_saida where id=_nota;
 select * into p from public.pedidos where id=n.pedido_id;
 if n.id is null or p.id is null or n.centro_id is distinct from p.centro_id or n.cliente_id is distinct from p.cliente_id
 or not public.ator_financeiro_pode_acessar_centro(ator,n.centro_id) then
  raise exception 'Nota indisponível ou loja sem acesso';end if;
 if public.has_role(ator,'representante') and not public.has_role(ator,'admin') then
  select r.id into rep from public.representantes r where r.profile_id=ator and r.ativo order by r.id limit 1;
  if rep is null or p.representante_id is distinct from rep or not exists(select 1 from public.clientes c where c.id=p.cliente_id and c.representante_id=rep) then raise exception 'Pedido fora da carteira do usuário';end if;
 end if;
 if (select count(*) from public.pedido_itens where pedido_id=p.id)>500 then
  raise exception 'A prévia desta fase aceita até 500 itens por nota';end if;
 select jsonb_build_object(
  'nota',(select jsonb_object_agg(k,to_jsonb(n)->k) from unnest(array['id','pedido_id','centro_id','cliente_id','status','serie','nf_numero','chave_acesso','protocolo','valor_total']) k),
  'pedido',(select jsonb_object_agg(k,to_jsonb(p)->k) from unnest(array['id','centro_id','cliente_id','status','total_itens','total_liquido','desconto_valor','forma_desconto_valor','forma_acrescimo_valor','frete_valor','frete_volume_valor','outras_despesas']) k),
  'loja',(select jsonb_object_agg(k,to_jsonb(l)->k) from unnest(array['id','nome','cnpj','uf','ativo','inscricao_estadual']) k),
  'fiscal',(select jsonb_object_agg(k,to_jsonb(f)->k) from unnest(array['serie','regime','uf_emitente','cfop_interno','cfop_interestadual','revisado_contador']) k),
  'cliente',(select jsonb_object_agg(k,to_jsonb(coalesce(nullif(to_jsonb(pe)->>k,''),to_jsonb(c)->>k))) from unnest(array['tipo_pessoa','cnpj_cpf','razao_social','inscricao_estadual','indicador_contribuinte_icms','logradouro','numero','complemento','bairro','cidade','uf','cep']) k),
  'conexao',jsonb_build_object('token_configurado',cr.centro_id is not null,'cnpj_configurado',cr.cnpj,'ambiente_declarado',cr.ambiente_declarado,
   'vinculo_atual',coalesce(v.provedor='forecastfiscal' and v.cnpj=cr.cnpj and cr.cnpj=upper(regexp_replace(l.cnpj,'[^a-zA-Z0-9]','','g')),false)),
  'bloqueio_faturamento',public.bloqueio_faturamento(p.id),
  'itens',coalesce((select jsonb_agg(jsonb_build_object(
   'item',(select jsonb_object_agg(k,to_jsonb(i)->k) from unnest(array['id','produto_id','quantidade','preco_unitario','desconto_percentual','total']) k),
   'produto',(select jsonb_object_agg(k,to_jsonb(pr)->k) from unnest(array['id','codigo','descricao','ncm','cest','ean','unidade','origem_fiscal','cfop','cfop_interestadual']) k),
   'disponivel_loja',coalesce(lp.disponivel and public.produto_categoria_loja_246(p.centro_id,i.produto_id),false)
   ) order by i.id) from public.pedido_itens i
   left join public.produtos pr on pr.id=i.produto_id
   left join public.loja_produtos lp on lp.produto_id=i.produto_id and lp.centro_id=p.centro_id
   where i.pedido_id=p.id),'[]'::jsonb)
 ) into resultado
 from public.centros l join public.clientes c on c.id=p.cliente_id
 left join public.pessoas pe on pe.id=c.pessoa_id
 left join public.loja_fiscal_256 f on f.centro_id=l.id
 left join public.forecast_credenciais_262 cr on cr.centro_id=l.id
 left join public.loja_provedor_fiscal_261 v on v.centro_id=l.id
 where l.id=p.centro_id and l.ativo;
 if resultado is null then raise exception 'Loja ou cliente indisponível';end if;
 return resultado;
end $$;
revoke all on function public.contexto_forecast_actor_266(uuid,uuid) from public,anon,authenticated;
grant execute on function public.contexto_forecast_actor_266(uuid,uuid) to service_role;

create or replace function public.contexto_envio_forecast_266(_nota uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$declare c jsonb;begin
 c:=public.contexto_homologacao_forecast_265(_nota);
 return jsonb_build_object('contexto',c,'versao',md5(c::text));
end $$;
revoke all on function public.contexto_envio_forecast_266(uuid) from public,anon,service_role;
grant execute on function public.contexto_envio_forecast_266(uuid) to authenticated;

create or replace function public.reservar_hml_forecast_266(_actor uuid,_nota uuid,_contexto_hash text,_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$declare c jsonb;cred public.forecast_credenciais_262;l public.forecast_liberacao_hml_266;j public.forecast_homologacoes_266;h text;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 perform 1 from public.notas_saida where id=_nota for update;
 perform 1 from public.pedidos where id=(select pedido_id from public.notas_saida where id=_nota) for share;
 perform 1 from public.pedido_itens where pedido_id=(select pedido_id from public.notas_saida where id=_nota) for share;
 perform 1 from public.centros where id=(select centro_id from public.notas_saida where id=_nota) for share;
 perform 1 from public.loja_fiscal_256 where centro_id=(select centro_id from public.notas_saida where id=_nota) for share;
 perform 1 from public.notas_saida where id=_nota for update;
 perform 1 from public.pedidos where id=(select pedido_id from public.notas_saida where id=_nota) for share;
 perform 1 from public.pedido_itens where pedido_id=(select pedido_id from public.notas_saida where id=_nota) for share;
 perform 1 from public.centros where id=(select centro_id from public.notas_saida where id=_nota) for share;
 perform 1 from public.loja_fiscal_256 where centro_id=(select centro_id from public.notas_saida where id=_nota) for share;
 c:=public.contexto_forecast_actor_266(_nota,_actor);
 select * into j from public.forecast_homologacoes_266 where nota_id=_nota;
 if j.envio_iniciado_em is not null then return jsonb_build_object('existente',true);end if;
 select * into cred from public.forecast_credenciais_262 where centro_id=(c#>>'{loja,id}')::uuid for share;
 select * into l from public.forecast_liberacao_hml_266 where centro_id=cred.centro_id for share;
 select md5(to_jsonb(f)::text) into h from public.loja_fiscal_256 f where centro_id=cred.centro_id;
 if not coalesce(l.liberado,false) or cred.ambiente_declarado is distinct from 'homologacao' or l.cnpj<>cred.cnpj or l.credencial_versao<>cred.updated_at or l.fiscal_hash is distinct from h
 or not coalesce((c#>>'{conexao,vinculo_atual}')::boolean,false) then raise exception 'Homologação não liberada para a configuração atual';end if;
 if _contexto_hash is distinct from md5(c::text) then raise exception 'Dados da nota alterados. Confira novamente';end if;
 if jsonb_typeof(_payload) is distinct from 'object' or length(_payload::text)>500000
 or _payload->>'ambiente' is distinct from 'HOMOLOGACAO' or _payload->>'cnpj_emitente' is distinct from cred.cnpj
 or _payload->>'ref' is distinct from 'CPRHML'||replace(_nota::text,'-','')
 or _payload->>'serie' is distinct from c#>>'{fiscal,serie}' then raise exception 'Payload fora do vínculo de homologação';end if;
 insert into public.forecast_homologacoes_266(nota_id,pedido_id,centro_id,cnpj,ref,serie,contexto_hash,token_hash,payload,created_by)
 values(_nota,(c#>>'{pedido,id}')::uuid,cred.centro_id,cred.cnpj,_payload->>'ref',_payload->>'serie',_contexto_hash,md5(cred.token),_payload,_actor)
 on conflict(nota_id) do update set contexto_hash=excluded.contexto_hash,token_hash=excluded.token_hash,payload=excluded.payload,updated_at=now()
 where forecast_homologacoes_266.envio_iniciado_em is null;
 return jsonb_build_object('existente',false);
end $$;
revoke all on function public.reservar_hml_forecast_266(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.reservar_hml_forecast_266(uuid,uuid,text,jsonb) to service_role;

create or replace function public.assumir_hml_forecast_266(_actor uuid,_nota uuid,_acao text,_payload jsonb default null) returns jsonb
language plpgsql security definer set search_path=public as $$declare j public.forecast_homologacoes_266;c jsonb;cred public.forecast_credenciais_262;l public.forecast_liberacao_hml_266;h text;nonce uuid:=gen_random_uuid();begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 perform 1 from public.notas_saida where id=_nota for update;
 perform 1 from public.pedidos where id=(select pedido_id from public.notas_saida where id=_nota) for share;
 perform 1 from public.pedido_itens where pedido_id=(select pedido_id from public.notas_saida where id=_nota) for share;
 perform 1 from public.centros where id=(select centro_id from public.notas_saida where id=_nota) for share;
 perform 1 from public.loja_fiscal_256 where centro_id=(select centro_id from public.notas_saida where id=_nota) for share;
 c:=public.contexto_forecast_actor_266(_nota,_actor);
 select * into j from public.forecast_homologacoes_266 where nota_id=_nota for update;
 if j.nota_id is null then return null;end if;
 select * into cred from public.forecast_credenciais_262 where centro_id=j.centro_id for share;
 if cred.ambiente_declarado is distinct from 'homologacao' or cred.cnpj is distinct from j.cnpj or md5(cred.token) is distinct from j.token_hash
 or c#>>'{loja,id}' is distinct from j.centro_id::text or upper(regexp_replace(c#>>'{loja,cnpj}','[^a-zA-Z0-9]','','g')) is distinct from j.cnpj
 then raise exception 'Credencial ou CNPJ divergente do documento de homologação';end if;
 if _acao='enviar' then
  if j.envio_iniciado_em is not null then return null;end if;
  select * into l from public.forecast_liberacao_hml_266 where centro_id=j.centro_id for share;
  select md5(to_jsonb(f)::text) into h from public.loja_fiscal_256 f where centro_id=j.centro_id;
  if not coalesce(l.liberado,false) or l.credencial_versao is distinct from cred.updated_at or l.fiscal_hash is distinct from h
  or not coalesce((c#>>'{conexao,vinculo_atual}')::boolean,false) or j.contexto_hash is distinct from md5(c::text) or j.payload is distinct from _payload then raise exception 'Preparação alterada ou homologação suspensa. Confira novamente';end if;
  update public.forecast_homologacoes_266 set estado='enviando',envio_iniciado_em=clock_timestamp(),lease=nonce,lease_ate=clock_timestamp()+interval '30 seconds',updated_at=now() where nota_id=_nota;
 elsif _acao='consultar' then
  if j.envio_iniciado_em is null or j.lease_ate>clock_timestamp() then return null;end if;
  update public.forecast_homologacoes_266 set lease=nonce,lease_ate=clock_timestamp()+interval '30 seconds' where nota_id=_nota;
 else raise exception 'Ação inválida';end if;
 insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id) values('notas_saida',_nota,'forecast_hml_'||_acao,jsonb_build_object('ref',j.ref,'ambiente','homologacao'),_actor);
 return jsonb_build_object('nota_id',_nota,'centro_id',j.centro_id,'ref',j.ref,'cnpj',j.cnpj,'serie',j.serie,'payload',j.payload,'lease',nonce,'token',cred.token);
end $$;
revoke all on function public.assumir_hml_forecast_266(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.assumir_hml_forecast_266(uuid,uuid,text,jsonb) to service_role;

create or replace function public.registrar_hml_forecast_266(_nota uuid,_lease uuid,_resultado jsonb) returns void
language plpgsql security definer set search_path=public as $$declare j public.forecast_homologacoes_266;s text;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 select * into j from public.forecast_homologacoes_266 where nota_id=_nota for update;
 if j.nota_id is null or j.lease is distinct from _lease or _lease is null then raise exception 'Consulta substituída. Recarregue o acompanhamento';end if;
 s:=_resultado->>'estado';
 if s is null or s not in ('processando','autorizada','rejeitada','incerta','cancelada') or length(_resultado::text)>10000 then raise exception 'Resultado inválido';end if;
 if s in ('autorizada','cancelada') and not coalesce(
  (_resultado->>'chave') ~ '^[0-9]{44}$' and substring(_resultado->>'chave',7,14)=j.cnpj and substring(_resultado->>'chave',21,2)='55'
  and (_resultado->>'protocolo') ~ '^[0-9]{15}$' and (_resultado->>'numero') ~ '^[0-9]{1,9}$' and (_resultado->>'serie')=j.serie,false) then raise exception 'Prova fiscal de homologação incompleta';end if;
 if j.estado='cancelada' or (j.estado='autorizada' and s<>'cancelada') then s:=j.estado;_resultado:=j.resultado;end if;
 update public.forecast_homologacoes_266 set estado=s,resultado=_resultado,lease=null,lease_ate=clock_timestamp()+interval '5 seconds',updated_at=now() where nota_id=_nota;
end $$;
revoke all on function public.registrar_hml_forecast_266(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.registrar_hml_forecast_266(uuid,uuid,jsonb) to service_role;

create or replace function public.status_hml_forecast_266(_nota uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$declare j public.forecast_homologacoes_266;c jsonb;begin
 c:=public.contexto_homologacao_forecast_265(_nota);
 select * into j from public.forecast_homologacoes_266 where nota_id=_nota;
 return jsonb_build_object('existe',j.nota_id is not null,'ref',j.ref,'estado',j.estado,'envio_iniciado',j.envio_iniciado_em is not null,'resultado',j.resultado,'ambiente','homologacao','producao_liberada',false,'liberado_para_envio',exists(select 1 from public.forecast_liberacao_hml_266 l join public.forecast_credenciais_262 cr on cr.centro_id=l.centro_id join public.loja_fiscal_256 f on f.centro_id=l.centro_id where l.centro_id=(c#>>'{loja,id}')::uuid and l.liberado and cr.ambiente_declarado='homologacao' and l.cnpj=cr.cnpj and l.credencial_versao=cr.updated_at and l.fiscal_hash=md5(to_jsonb(f)::text) and coalesce((c#>>'{conexao,vinculo_atual}')::boolean,false)));
end $$;
revoke all on function public.status_hml_forecast_266(uuid) from public,anon,service_role;
grant execute on function public.status_hml_forecast_266(uuid) to authenticated;

-- Impedir uso acidental de uma chave de teste na autorização da nota real.
create or replace function public.bloquear_chave_hml_operacional_266() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if new.chave_acesso is not null and exists(select 1 from public.forecast_homologacoes_266 h where h.resultado->>'chave'=new.chave_acesso) then
  raise exception 'Chave de homologação não pode autorizar uma nota operacional';
 end if;
 return new;
end $$;
revoke all on function public.bloquear_chave_hml_operacional_266() from public,anon,authenticated;
drop trigger if exists bloquear_chave_hml_operacional_266 on public.notas_saida;
create trigger bloquear_chave_hml_operacional_266 before insert or update of chave_acesso on public.notas_saida for each row execute function public.bloquear_chave_hml_operacional_266();

-- Preservar credenciais de liberação; tentativas acompanham o ciclo das notas.
do $$declare d text;begin
 if to_regprocedure('public.admin_limpar_dados_interno_f130(text)') is not null then
  select pg_get_functiondef('public.admin_limpar_dados_interno_f130(text)'::regprocedure) into d;
  if position('forecast_liberacao_hml_266' in d)=0 then
   if position('''sicredi_config''' in d)=0 then raise exception 'Revise a preservação das configurações fiscais na limpeza';end if;
   execute replace(d,'''sicredi_config''','''sicredi_config'',''forecast_liberacao_hml_266''');
  end if;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
