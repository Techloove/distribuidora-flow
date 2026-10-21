-- Emissão NF-e55 FAZNOTAS: reserva durável, snapshots, recibos e confirmação no servidor.
begin;
do $$begin
 if to_regprocedure('public.listar_tributacao_produto_258(uuid,uuid)') is null then raise exception 'Aplique as fases256,257 e258 antes da fase259';end if;
end $$;
do $$declare nova259 text;begin
 insert into public.permissoes(codigo,nome,grupo,ordem,modulo)
 values('faturamento_emitir_nfe','Emitir e acompanhar NF-e via FAZNOTAS','Faturamento',160,'/notas') on conflict do nothing returning codigo into nova259;
 if nova259 is not null then
  insert into public.role_permissoes(role,permissao) select 'financeiro','faturamento_emitir_nfe'
  where exists(select 1 from public.role_menus where role::text='financeiro' and path='/notas') on conflict do nothing;
 end if;
end $$;
-- Declaração do ambiente habilitado na conta do provedor. Não altera o ambiente remoto.
create table if not exists public.faznotas_liberacao_259(
 centro_id uuid primary key references public.centros(id),ambiente text not null check(ambiente in ('homologacao','producao')),
 liberado boolean not null default false,cnpj text not null,loja_snapshot jsonb not null,updated_at timestamptz not null default now(),updated_by uuid not null references public.profiles(id)
);
alter table public.faznotas_liberacao_259 enable row level security;
revoke all on public.faznotas_liberacao_259 from public,anon,authenticated;
grant select on public.faznotas_liberacao_259 to authenticated;
grant all on public.faznotas_liberacao_259 to service_role;
drop policy if exists faznotas_liberacao_leitura_259 on public.faznotas_liberacao_259;
create policy faznotas_liberacao_leitura_259 on public.faznotas_liberacao_259 for select to authenticated using(public.usuario_ativo() and public.can_manage(auth.uid()) and public.pode_rotina('configuracao_rotinas_editar') and public.usuario_pode_acessar_centro(centro_id));
create or replace function public.snapshot_liberacao_nfe_259(_loja uuid) returns jsonb
language sql stable set search_path=public as $$
 select public.snapshot_loja_fiscal_258(_loja)||jsonb_build_object('serie',f.serie,'cnpj',upper(regexp_replace(c.cnpj,'[^a-zA-Z0-9]','','g')),'ativo',c.ativo)
 from public.loja_fiscal_256 f join public.centros c on c.id=f.centro_id where f.centro_id=_loja;
$$;
revoke all on function public.snapshot_liberacao_nfe_259(uuid) from public,anon,authenticated;
create or replace function public.estado_liberacao_nfe_259(_loja uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$declare estado259 jsonb;begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('configuracao_rotinas_editar') or not public.usuario_pode_acessar_centro(_loja) then raise exception 'Sem acesso à liberação fiscal da loja';end if;
 select (to_jsonb(l)-'loja_snapshot')||jsonb_build_object('atual',l.loja_snapshot=public.snapshot_liberacao_nfe_259(_loja)) into estado259 from public.faznotas_liberacao_259 l where l.centro_id=_loja;
 return estado259;
end $$;
revoke all on function public.estado_liberacao_nfe_259(uuid) from public,anon;
grant execute on function public.estado_liberacao_nfe_259(uuid) to authenticated;
create or replace function public.liberar_faznotas_259(_loja uuid,_ambiente text,_liberado boolean) returns void
language plpgsql security definer set search_path=public as $$declare c jsonb;begin
 c:=public.estado_conexao_faznotas_257(_loja);
 if not public.has_role(auth.uid(),'admin') or not public.usuario_ativo() then raise exception 'Somente administrador libera a emissão fiscal';end if;
 if _ambiente not in ('homologacao','producao') or _ambiente is null or _liberado is null then raise exception 'Informe o ambiente confirmado no provedor';end if;
 if public.snapshot_loja_fiscal_258(_loja) is null then raise exception 'Salve primeiro a preparação fiscal da loja';end if;
 if _liberado and (c->>'cnpj_confere' is distinct from 'true' or (public.snapshot_loja_fiscal_258(_loja))->>'revisado' is distinct from 'true') then raise exception 'Confira credencial, CNPJ e revisão fiscal da loja antes de liberar';end if;
 insert into public.faznotas_liberacao_259(centro_id,ambiente,liberado,cnpj,loja_snapshot,updated_by)
 values(_loja,_ambiente,_liberado,c->>'cnpj_loja',public.snapshot_liberacao_nfe_259(_loja),auth.uid())
 on conflict(centro_id) do update set ambiente=excluded.ambiente,liberado=excluded.liberado,cnpj=excluded.cnpj,loja_snapshot=excluded.loja_snapshot,updated_at=clock_timestamp(),updated_by=auth.uid();
end $$;
revoke all on function public.liberar_faznotas_259(uuid,text,boolean) from public,anon;
grant execute on function public.liberar_faznotas_259(uuid,text,boolean) to authenticated;
alter table public.notas_saida add column if not exists faznotas_estado text;
alter table public.notas_saida add column if not exists faznotas_recibo text;
alter table public.notas_saida add column if not exists faznotas_request_id text;
create table if not exists public.faznotas_emissoes_259(
 nota_id uuid primary key references public.notas_saida(id),pedido_id uuid not null unique references public.pedidos(id),centro_id uuid not null references public.centros(id),
 numero_origem text not null unique,cnpj text not null,serie text not null,
 snapshot jsonb not null,contexto_hash text not null,
 estado text not null check(estado in ('preparando','enviando','processando','autorizada','rejeitada','incerta','cancelada')),
 recibo text,produtos_prontos text[] not null default '{}',
 lease uuid,lease_ate timestamptz,proxima_consulta timestamptz not null default now(),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.faznotas_eventos_259(
 id uuid primary key default gen_random_uuid(),nota_id uuid not null references public.faznotas_emissoes_259(nota_id),acao text not null,retorno jsonb not null,created_at timestamptz not null default now()
);
alter table public.faznotas_emissoes_259 enable row level security;
alter table public.faznotas_eventos_259 enable row level security;
revoke all on public.faznotas_emissoes_259,public.faznotas_eventos_259 from public,anon,authenticated;
grant all on public.faznotas_emissoes_259,public.faznotas_eventos_259 to service_role;
-- Verifica ator explicitamente também nos caminhos service_role, sem confiar em IDs do navegador.
create or replace function public.validar_ator_nfe_259(_actor uuid,_nota uuid) returns void
language plpgsql stable security definer set search_path=public as $$
declare n public.notas_saida;p public.pedidos;rep uuid;
begin
 if not exists(select 1 from public.profiles a where a.id=_actor and a.ativo and not coalesce(a.precisa_completar_cadastro,false)) or not public.can_bill(_actor) then raise exception 'Sem permissão para operar NF-e';end if;
 if not public.can_manage(_actor) and not (
 exists(select 1 from public.user_roles u join public.role_permissoes rp on rp.role=u.role::text where u.user_id=_actor and rp.permissao='faturamento_emitir_nfe')
 and exists(select 1 from public.user_roles u join public.role_menus rm on rm.role::text=u.role::text where u.user_id=_actor and rm.path='/notas')) then raise exception 'Permissão de emissão fiscal não liberada para o usuário';end if;
 select * into n from public.notas_saida where id=_nota;
 select * into p from public.pedidos where id=n.pedido_id;
 if coalesce(auth.role(),'')<>'service_role' and (_actor is distinct from auth.uid() or not public.usuario_pode_acessar_centro(n.centro_id)) then raise exception 'Loja fora do acesso do usuário';end if;
 if n.id is null or n.centro_id is distinct from p.centro_id or not public.ator_financeiro_pode_acessar_centro(_actor,n.centro_id) then raise exception 'Nota indisponível ou loja sem acesso';end if;
 if public.has_role(_actor,'representante') and not public.has_role(_actor,'admin') then
  select r.id into rep from public.representantes r where r.profile_id=_actor and r.ativo order by r.id limit 1;
  if rep is null or p.representante_id is distinct from rep or not exists(select 1 from public.clientes c where c.id=p.cliente_id and c.representante_id=rep) then raise exception 'Pedido fora da carteira do usuário';end if;
 end if;
end $$;
revoke all on function public.validar_ator_nfe_259(uuid,uuid) from public,anon,authenticated;
create or replace function public.dados_nfe_259(_nota uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare n public.notas_saida;p public.pedidos;contexto jsonb;
begin
 select * into n from public.notas_saida where id=_nota;select * into p from public.pedidos where id=n.pedido_id;
 select jsonb_build_object('nota',(select jsonb_object_agg(k,to_jsonb(n)->k) from unnest(array['id','numero','pedido_id','cliente_id','centro_id','status','serie','nf_numero','chave_acesso','valor_total']) k),
 'pedido',(select jsonb_object_agg(k,to_jsonb(p)->k) from unnest(array['id','numero','cliente_id','centro_id','representante_id','status','total_itens','total_liquido','desconto_valor','forma_desconto_valor','forma_acrescimo_valor','frete_valor','frete_volume_valor','outras_despesas','observacoes']) k),'cliente',(select jsonb_object_agg(k,to_jsonb(c)->k) from unnest(array['tipo_pessoa','cnpj_cpf','razao_social','inscricao_estadual','indicador_contribuinte_icms','logradouro','numero','complemento','bairro','cidade','uf','cep']) k),'pessoa',case when pe.id is null then null else (select jsonb_object_agg(k,to_jsonb(pe)->k) from unnest(array['tipo_pessoa','cnpj_cpf','razao_social','inscricao_estadual','indicador_contribuinte_icms','logradouro','numero','complemento','bairro','cidade','uf','cep']) k) end,'loja',(select jsonb_object_agg(k,to_jsonb(l)->k) from unnest(array['id','nome','cnpj','inscricao_estadual','logradouro','numero','complemento','bairro','cidade','uf','cep']) k),'fiscal',to_jsonb(f),
 'liberacao',(select to_jsonb(lf)||jsonb_build_object('atual',lf.loja_snapshot=public.snapshot_liberacao_nfe_259(p.centro_id)) from public.faznotas_liberacao_259 lf where lf.centro_id=p.centro_id),
 'itens',coalesce((select jsonb_agg(jsonb_build_object('item',(select jsonb_object_agg(k,to_jsonb(i)->k) from unnest(array['id','produto_id','quantidade','preco_unitario','desconto_percentual','total']) k),'produto',(select jsonb_object_agg(k,to_jsonb(pr)->k) from unnest(array['id','codigo','descricao','ncm','cest','ean','unidade','origem_fiscal','cfop','cfop_interestadual']) k),'regras',coalesce((select jsonb_agg(jsonb_build_object('cfop',r.cfop,'configuracoes',r.configuracoes,'revisao_valida',r.revisado_contador and r.produto_snapshot=public.snapshot_produto_fiscal_258(pr.id) and r.loja_snapshot=public.snapshot_loja_fiscal_258(p.centro_id),'aceita_padrao_ibs_cbs',r.aceita_padrao_ibs_cbs) order by r.cfop) from public.loja_produto_fiscal_258 r where r.centro_id=p.centro_id and r.produto_id=pr.id),'[]'::jsonb)) order by i.id) from public.pedido_itens i join public.produtos pr on pr.id=i.produto_id where i.pedido_id=p.id),'[]'::jsonb),
 'faturas',coalesce((select jsonb_agg(jsonb_build_object('valor',cr.valor,'data',cr.vencimento) order by cr.parcela,cr.id) from public.contas_receber cr where cr.pedido_id=p.id and cr.status<>'cancelado'),'[]'::jsonb)) into contexto
 from public.clientes c left join public.pessoas pe on pe.id=c.pessoa_id join public.centros l on l.id=p.centro_id left join public.loja_fiscal_256 f on f.centro_id=l.id where c.id=p.cliente_id;
 return contexto;
end $$;
revoke all on function public.dados_nfe_259(uuid) from public,anon,authenticated;
create or replace function public.contexto_nfe_259(_nota uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$declare c jsonb;begin
 if not public.usuario_ativo() then raise exception 'Usuário inativo';end if;
 perform public.validar_ator_nfe_259(auth.uid(),_nota);c:=public.dados_nfe_259(_nota);
 return jsonb_build_object('dados',c,'versao',md5(c::text),'vinculada',exists(select 1 from public.faznotas_emissoes_259 e where e.nota_id=_nota));
end $$;
revoke all on function public.contexto_nfe_259(uuid) from public,anon;
grant execute on function public.contexto_nfe_259(uuid) to authenticated;
-- Apenas código do servidor reserva e persiste as respostas externas.
create or replace function public.reservar_nfe_259(_actor uuid,_nota uuid,_versao text,_snapshot jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare n public.notas_saida;c jsonb;cred public.faznotas_credenciais_257;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 perform public.validar_ator_nfe_259(_actor,_nota);
 select * into n from public.notas_saida where id=_nota for update;
 perform 1 from public.pedidos p where p.id=n.pedido_id for update;
 perform 1 from public.pedido_itens i where i.pedido_id=n.pedido_id for share;
 if exists(select 1 from public.faznotas_emissoes_259 e where e.nota_id=_nota) then raise exception 'Nota já reservada. Acompanhe o envio existente';end if;
 if exists(select 1 from public.notas_saida outra where outra.pedido_id=n.pedido_id and outra.id<>n.id and outra.status in ('pendente','emitida','autorizada')) then raise exception 'Pedido já possui outra nota em processo ou autorizada. Confira o faturamento antes de emitir';end if;
 if n.status<>'pendente' or nullif(n.nf_numero,'') is not null or n.chave_acesso is not null then raise exception 'Somente nota pendente, ainda não emitida, pode ser enviada';end if;
 if (select p.status from public.pedidos p where p.id=n.pedido_id) not in ('faturado','conferido','em_carga','em_rota','entregue','parcial') then raise exception 'Pedido não está liberado para emissão';end if;
 if public.bloqueio_faturamento(n.pedido_id) is not null then raise exception 'Confira a separação do pedido antes de emitir';end if;
 c:=public.dados_nfe_259(_nota);
 if _versao is distinct from md5(c::text) then raise exception 'Os dados do documento mudaram. Refaça a conferência antes de emitir';end if;
 select * into cred from public.faznotas_credenciais_257 where centro_id=n.centro_id for share;
 if cred.cnpj is null or cred.cnpj is distinct from upper(regexp_replace(c#>>'{loja,cnpj}','[^a-zA-Z0-9]','','g')) then raise exception 'Configure o token FAZNOTAS para o CNPJ atual da loja';end if;
 if not exists(select 1 from public.faznotas_liberacao_259 l where l.centro_id=n.centro_id and l.liberado and l.cnpj=cred.cnpj and l.loja_snapshot=public.snapshot_liberacao_nfe_259(n.centro_id)) then raise exception 'Administrador deve liberar a emissão para a configuração fiscal atual desta loja';end if;
 if jsonb_typeof(_snapshot) is distinct from 'object' or length(_snapshot::text)>2000000 or _snapshot#>>'{emissao,numero-origem}' is distinct from 'CPR-NFE-'||_nota::text or _snapshot->>'cnpj' is distinct from cred.cnpj or _snapshot#>>'{emissao,serie}' is distinct from c#>>'{fiscal,serie}' then raise exception 'Snapshot fiscal inválido';end if;
 insert into public.faznotas_emissoes_259(nota_id,pedido_id,centro_id,numero_origem,cnpj,serie,snapshot,contexto_hash,estado,created_by)
 values(n.id,n.pedido_id,n.centro_id,'CPR-NFE-'||n.id::text,cred.cnpj,_snapshot#>>'{emissao,serie}',_snapshot,_versao,'preparando',_actor);
 update public.notas_saida set faznotas_estado='preparando',mensagem_retorno='Preparando cadastros na FAZNOTAS' where id=n.id;
 insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id) values('notas_saida',n.id,'faznotas_reservada',jsonb_build_object('origem','CPR-NFE-'||n.id::text),_actor);
end $$;
revoke all on function public.reservar_nfe_259(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.reservar_nfe_259(uuid,uuid,text,jsonb) to service_role;
create or replace function public.assumir_nfe_259(_actor uuid,_nota uuid,_recuperar boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$declare e public.faznotas_emissoes_259;nonce uuid;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 perform public.validar_ator_nfe_259(_actor,_nota);
 select * into e from public.faznotas_emissoes_259 where nota_id=_nota for update;
 if e.nota_id is null then raise exception 'Nota ainda não reservada para envio';end if;
 if e.estado='cancelada' or (e.estado='rejeitada' and (not _recuperar or e.recibo is null)) or (e.estado='autorizada' and (not _recuperar or e.recibo is null)) or (e.estado='incerta' and not _recuperar) or e.lease_ate>clock_timestamp() or (e.recibo is not null and e.proxima_consulta>clock_timestamp()) then return null;end if;
 if not exists(select 1 from public.faznotas_credenciais_257 cr join public.centros c on c.id=cr.centro_id where cr.centro_id=e.centro_id and cr.cnpj=e.cnpj and upper(regexp_replace(c.cnpj,'[^a-zA-Z0-9]','','g'))=e.cnpj) then raise exception 'CNPJ da conexão mudou; não é possível retomar este documento com outra empresa';end if;
 nonce:=gen_random_uuid();
 update public.faznotas_emissoes_259 set lease=nonce,lease_ate=clock_timestamp()+interval '90 seconds',proxima_consulta=clock_timestamp()+interval '5 seconds' where nota_id=_nota;
 return jsonb_build_object('lease',nonce,'centro_id',e.centro_id,'snapshot',e.snapshot,'recibo',e.recibo,'produtos_prontos',e.produtos_prontos);
end $$;
revoke all on function public.assumir_nfe_259(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.assumir_nfe_259(uuid,uuid,boolean) to service_role;
create or replace function public.registrar_etapa_nfe_259(_actor uuid,_nota uuid,_lease uuid,_acao text,_retorno jsonb,_pronto text default null)
returns void language plpgsql security definer set search_path=public as $$
declare e public.faznotas_emissoes_259;s text;codigo text;chave text;protocolo259 text;estado259 text;recibo259 text;danfe text;xml text;prova259 boolean:=false;data259 date;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 perform public.validar_ator_nfe_259(_actor,_nota);
 select * into e from public.faznotas_emissoes_259 where nota_id=_nota for update;
 if e.nota_id is null or e.lease is distinct from _lease or e.lease_ate<clock_timestamp() then raise exception 'Reserva de processamento expirou. Consulte novamente';end if;
 if length(_retorno::text)>2000000 or jsonb_typeof(_retorno) is distinct from 'object' then raise exception 'Retorno fiscal inválido';end if;
 insert into public.faznotas_eventos_259(nota_id,acao,retorno) values(_nota,_acao,_retorno);
 if _acao='produto' then
  if _pronto is null or not exists(select 1 from jsonb_array_elements(e.snapshot->'produtos') p where p->>'referencia'=_pronto) then raise exception 'Produto não pertence ao snapshot fiscal';end if;
  update public.faznotas_emissoes_259 set produtos_prontos=array(select distinct x from unnest(produtos_prontos||array[_pronto]) x),updated_at=clock_timestamp() where nota_id=_nota;return;
 end if;
 if _acao='iniciar_envio' then
  if e.recibo is not null then raise exception 'Já existe protocolo; consulte a emissão';end if;
  if exists(select 1 from jsonb_array_elements(e.snapshot->'produtos') p where not (p->>'referencia'=any(e.produtos_prontos))) then raise exception 'Aguarde a sincronização de todos os produtos';end if;
  if not exists(select 1 from public.faznotas_liberacao_259 l where l.centro_id=e.centro_id and l.liberado and l.cnpj=e.cnpj and l.ambiente=e.snapshot->>'ambiente' and l.loja_snapshot=public.snapshot_liberacao_nfe_259(e.centro_id) and l.loja_snapshot->>'serie'=e.serie) then raise exception 'Envio não liberado para a configuração atual da loja';end if;
  update public.faznotas_emissoes_259 set estado='enviando' where nota_id=_nota;
  update public.notas_saida set faznotas_estado='enviando' where id=_nota;return;
 end if;
 if _acao='liberar' then update public.faznotas_emissoes_259 set estado='preparando',lease=null,lease_ate=null where nota_id=_nota;update public.notas_saida set faznotas_estado='preparando',mensagem_retorno='Sincronizando cadastros fiscais na FAZNOTAS' where id=_nota;return;end if;
 s:=_retorno->>'status';codigo:=_retorno#>>'{data,sefaz,codigo}';recibo259:=nullif(_retorno#>>'{data,recibo}','');
 estado259:=case
 when _acao='falha' and e.recibo is null then 'incerta'
 when _acao='falha' then 'processando'
 when s='004' and codigo in ('100','120','150') then 'autorizada'
 when s='010' and e.recibo is not null then 'cancelada'
 when s='900' and codigo is not null and codigo not in ('105','217') then 'rejeitada'
 when s='400' and _acao='envio' then 'rejeitada'
 when s in ('001','002','003','050') and coalesce(recibo259,e.recibo) is not null then 'processando'
 when s='900' and codigo in ('105','217') and e.recibo is not null then 'processando'
 else 'incerta' end;
 if estado259='autorizada' then
  chave:=_retorno#>>'{data,sefaz,chave}';protocolo259:=_retorno#>>'{data,sefaz,protocolo}';
  if coalesce(chave,'') !~ '^[0-9]{44}$' or substring(chave from 7 for 14) is distinct from e.cnpj or substring(chave from 21 for 2)<>'55' or substring(chave from 23 for 3)::integer is distinct from e.serie::integer or coalesce(protocolo259,'') !~ '^[0-9]{10,20}$' then
   estado259:='incerta';
  else prova259:=true;end if;
 end if;
 if prova259 and _retorno#>>'{data,sefaz,data-emissao}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then
  begin data259:=left(_retorno#>>'{data,sefaz,data-emissao}',10)::date;exception when invalid_datetime_format or datetime_field_overflow then data259:=null;end;
 end if;
 if e.estado='autorizada' and estado259<>'cancelada' then estado259:='autorizada';end if;
 danfe:=case when _retorno#>>'{data,sefaz,url-danfe}' ~ '^https://' then _retorno#>>'{data,sefaz,url-danfe}' end;
 xml:=case when _retorno#>>'{data,sefaz,url-xml}' ~ '^https://' then _retorno#>>'{data,sefaz,url-xml}' end;
 update public.faznotas_emissoes_259 set estado=estado259,recibo=coalesce(recibo259,recibo),lease=null,lease_ate=null,proxima_consulta=clock_timestamp()+interval '5 seconds',updated_at=clock_timestamp() where nota_id=_nota;
 update public.notas_saida set faznotas_estado=estado259,faznotas_recibo=coalesce(recibo259,e.recibo),faznotas_request_id=coalesce(_retorno#>>'{meta,request_id}',faznotas_request_id),retorno=case when e.estado='autorizada' and not prova259 and estado259<>'cancelada' then retorno else _retorno end,
 mensagem_retorno=left(case when estado259='incerta' and s='004' then 'A API informou autorização, mas chave/protocolo precisam ser conferidos. Não reemita.' else coalesce(_retorno->>'descricao','Acompanhe o retorno da FAZNOTAS') end,1000),
 status=case when estado259='autorizada' then 'autorizada' when estado259='rejeitada' then 'rejeitada' when estado259='cancelada' then 'cancelada' else status end,
 serie=case when prova259 then e.serie else serie end,
 nf_numero=case when prova259 then substring(chave from 26 for 9)::bigint::text else nf_numero end,
 chave_acesso=case when prova259 then chave else chave_acesso end,protocolo=case when prova259 then protocolo259 else notas_saida.protocolo end,
 data_emissao=coalesce(data259,data_emissao),
 autorizada_em=case when estado259='autorizada' then coalesce(autorizada_em,clock_timestamp()) else autorizada_em end,
 danfe_url=case when estado259='autorizada' then coalesce(danfe,danfe_url) else danfe_url end,xml_url=case when estado259='autorizada' then coalesce(xml,xml_url) else xml_url end where id=_nota;
 if estado259='autorizada' then
  update public.pedidos set status='nf_emitida' where id=e.pedido_id and status='faturado';
  if e.estado<>'autorizada' then insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id) values('notas_saida',_nota,'faznotas_autorizada',jsonb_build_object('chave',chave,'protocolo',protocolo259),_actor);end if;
 end if;
end $$;
revoke all on function public.registrar_etapa_nfe_259(uuid,uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.registrar_etapa_nfe_259(uuid,uuid,uuid,text,jsonb,text) to service_role;
create or replace function public.status_nfe_259(_nota uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$declare e public.faznotas_emissoes_259;n public.notas_saida;begin
 if not public.usuario_ativo() then raise exception 'Usuário inativo';end if;
 perform public.validar_ator_nfe_259(auth.uid(),_nota);
 select * into e from public.faznotas_emissoes_259 where nota_id=_nota;
 select * into n from public.notas_saida where id=_nota;
 return jsonb_build_object('vinculada',e.nota_id is not null,'estado',e.estado,'recibo',e.recibo,'numero_origem',e.numero_origem,'produtos_prontos',cardinality(e.produtos_prontos),'total_produtos',coalesce(jsonb_array_length(e.snapshot->'produtos'),0),'ambiente',e.snapshot->>'ambiente','mensagem',n.mensagem_retorno,'request_id',n.faznotas_request_id,'chave',n.chave_acesso,'protocolo',n.protocolo,'nf_numero',n.nf_numero,'serie',n.serie,'danfe_url',n.danfe_url,'xml_url',n.xml_url);
end $$;
revoke all on function public.status_nfe_259(uuid) from public,anon;
grant execute on function public.status_nfe_259(uuid) to authenticated;
create or replace function public.abortar_preparacao_nfe_259(_nota uuid) returns void
language plpgsql security definer set search_path=public as $$declare e public.faznotas_emissoes_259;begin
 if not public.usuario_ativo() then raise exception 'Usuário inativo';end if;
 perform public.validar_ator_nfe_259(auth.uid(),_nota);
 select * into e from public.faznotas_emissoes_259 where nota_id=_nota for update;
 if e.nota_id is null then return;end if;
 if e.recibo is not null or e.lease_ate>clock_timestamp() or (
 exists(select 1 from public.faznotas_eventos_259 v where v.nota_id=_nota and v.acao='iniciar_envio') and not (
 e.estado='rejeitada' and (select count(*) from public.faznotas_eventos_259 v where v.nota_id=_nota and v.acao='iniciar_envio')=1
 and exists(select 1 from public.faznotas_eventos_259 v where v.nota_id=_nota and v.acao='envio' and v.retorno->>'status'='400')
 and not exists(select 1 from public.faznotas_eventos_259 v where v.nota_id=_nota and v.acao='falha')
 )) then raise exception 'Já houve tentativa de envio ou há processamento em andamento. Consulte a API; não descarte este documento';end if;
 insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id) values('notas_saida',_nota,'faznotas_preparacao_descartada',jsonb_build_object('origem',e.numero_origem),auth.uid());
 delete from public.faznotas_eventos_259 where nota_id=_nota;
 delete from public.faznotas_emissoes_259 where nota_id=_nota;
 update public.notas_saida set status='pendente',faznotas_estado=null,mensagem_retorno='Preparação descartada sem enfileiramento confirmado de nota' where id=_nota;
end $$;
revoke all on function public.abortar_preparacao_nfe_259(uuid) from public,anon;
grant execute on function public.abortar_preparacao_nfe_259(uuid) to authenticated;
-- Notas da API não podem ser autorizadas/rejeitadas/canceladas por RPCs manuais.
create or replace function public.proteger_nota_faznotas_259() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if coalesce(auth.role(),'')<>'service_role' and exists(select 1 from public.faznotas_emissoes_259 e where (tg_op='INSERT' and e.pedido_id=new.pedido_id) or (tg_op<>'INSERT' and e.nota_id=old.id)) then raise exception 'Documento vinculado à FAZNOTAS. Utilize o acompanhamento da API; alteração manual não é permitida';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function public.proteger_nota_faznotas_259() from public,anon,authenticated;
drop trigger if exists proteger_nota_faznotas_259 on public.notas_saida;
create trigger proteger_nota_faznotas_259 before insert or update or delete on public.notas_saida for each row execute function public.proteger_nota_faznotas_259();
create or replace function public.proteger_pedido_nfe_259() returns trigger
language plpgsql security definer set search_path=public as $$declare pid uuid;begin
 if tg_table_name='pedidos' then
  pid:=old.id;
  if exists(select 1 from public.faznotas_emissoes_259 e where e.pedido_id=pid) and (new.status='cancelado' or (select jsonb_object_agg(k,to_jsonb(new)->k) from unnest(array['cliente_id','centro_id','representante_id','forma_pagamento_id','data_pedido','desconto_valor','frete_valor','frete_volume_ativo','frete_volume_valor','frete_volume_detalhes','outras_despesas','forma_acrescimo_valor','forma_desconto_valor','total_itens','total_liquido']) k) is distinct from (select jsonb_object_agg(k,to_jsonb(old)->k) from unnest(array['cliente_id','centro_id','representante_id','forma_pagamento_id','data_pedido','desconto_valor','frete_valor','frete_volume_ativo','frete_volume_valor','frete_volume_detalhes','outras_despesas','forma_acrescimo_valor','forma_desconto_valor','total_itens','total_liquido']) k)) then raise exception 'Pedido possui snapshot fiscal na FAZNOTAS; dados comerciais estão preservados';end if;
  return new;
 else
  pid:=case when tg_op='INSERT' then new.pedido_id else old.pedido_id end;
  if exists(select 1 from public.faznotas_emissoes_259 e where e.pedido_id=pid or (tg_op='UPDATE' and e.pedido_id=new.pedido_id)) and (tg_op<>'UPDATE' or row(new.pedido_id,new.produto_id,new.quantidade,new.preco_unitario,new.desconto_percentual,new.total) is distinct from row(old.pedido_id,old.produto_id,old.quantidade,old.preco_unitario,old.desconto_percentual,old.total)) then raise exception 'Itens preservados pelo snapshot fiscal da FAZNOTAS';end if;
  if tg_op='DELETE' then return old;end if;return new;
 end if;
end $$;
revoke all on function public.proteger_pedido_nfe_259() from public,anon,authenticated;
drop trigger if exists proteger_pedido_nfe_259 on public.pedidos;
create trigger proteger_pedido_nfe_259 before update on public.pedidos for each row execute function public.proteger_pedido_nfe_259();
drop trigger if exists proteger_item_nfe_259 on public.pedido_itens;
create trigger proteger_item_nfe_259 before insert or update or delete on public.pedido_itens for each row execute function public.proteger_pedido_nfe_259();
notify pgrst,'reload schema';
commit;
