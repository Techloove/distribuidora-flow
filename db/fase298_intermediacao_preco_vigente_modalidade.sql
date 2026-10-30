-- Preço vigente reutilizável e troca de modalidade com prévia/execução atômica.
begin;
-- Somente os vendedores selecionados podem operar intermediação. Gestão mantém acesso.
create table if not exists public.intermediacao_vendedores_298(
 centro_id uuid not null references public.centros(id),representante_id uuid not null references public.representantes(id),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),primary key(centro_id,representante_id)
);
alter table public.intermediacao_vendedores_298 enable row level security;
revoke all on public.intermediacao_vendedores_298 from public,anon,authenticated;
grant select on public.intermediacao_vendedores_298 to authenticated;
grant all on public.intermediacao_vendedores_298 to service_role;
drop policy if exists vendedores_gestao_298 on public.intermediacao_vendedores_298;
create policy vendedores_gestao_298 on public.intermediacao_vendedores_298 for select to authenticated using(public.usuario_ativo() and public.can_manage(auth.uid()) and public.pode_rotina('configuracao_rotinas_editar') and public.usuario_pode_acessar_centro(centro_id));
create or replace function public.vendedor_intermediacao_autorizado_298(_loja uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select public.usuario_ativo() and public.usuario_pode_acessar_centro(_loja) and (public.can_manage(auth.uid()) or exists(select 1 from public.intermediacao_vendedores_298 g join public.representantes r on r.id=g.representante_id where g.centro_id=_loja and r.profile_id=auth.uid() and r.ativo));
$$;
revoke all on function public.vendedor_intermediacao_autorizado_298(uuid) from public,anon;
grant execute on function public.vendedor_intermediacao_autorizado_298(uuid) to authenticated;
create or replace function public.intermediacao_ativa_296(_loja uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select public.vendedor_intermediacao_autorizado_298(_loja) and exists(select 1 from public.centros c join public.loja_parametros l on l.centro_id=c.id and l.chave='intermediacao_habilitada' and l.valor='true' where c.id=_loja and c.ativo);
$$;
revoke all on function public.intermediacao_ativa_296(uuid) from public,anon;
grant execute on function public.intermediacao_ativa_296(uuid) to authenticated;
create or replace function public.salvar_vendedores_intermediacao_298(_loja uuid,_representantes uuid[]) returns void
language plpgsql security definer set search_path=public as $$declare antes jsonb;begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('configuracao_rotinas_editar') or not public.usuario_pode_acessar_centro(_loja) or not exists(select 1 from public.centros where id=_loja and ativo) then raise exception 'Sem permissão para autorizar vendedores nesta loja';end if;
 if _representantes is null or cardinality(_representantes)>500 or array_position(_representantes,null) is not null or (select count(distinct x) from unnest(_representantes) x)<>cardinality(_representantes) then raise exception 'Seleção de vendedores inválida';end if;
 if exists(select 1 from unnest(_representantes) x where not exists(select 1 from public.representantes r where r.id=x and r.ativo)) then raise exception 'Selecione vendedores ativos';end if;
 perform 1 from public.centros where id=_loja for update;
 select coalesce(jsonb_agg(representante_id),'[]') into antes from public.intermediacao_vendedores_298 where centro_id=_loja;
 delete from public.intermediacao_vendedores_298 where centro_id=_loja and not (representante_id=any(_representantes));
 insert into public.intermediacao_vendedores_298(centro_id,representante_id,created_by) select _loja,x,auth.uid() from unnest(_representantes) x on conflict do nothing;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('centros',_loja,'autorizar_intermediacao_298',auth.uid(),jsonb_build_object('antes',antes,'depois',to_jsonb(_representantes)));
end $$;
revoke all on function public.salvar_vendedores_intermediacao_298(uuid,uuid[]) from public,anon;
grant execute on function public.salvar_vendedores_intermediacao_298(uuid,uuid[]) to authenticated;
drop policy if exists cotacoes_acesso_vendedor_298 on public.intermediacao_cotacoes_296;
create policy cotacoes_acesso_vendedor_298 on public.intermediacao_cotacoes_296 as restrictive for select to authenticated using(public.vendedor_intermediacao_autorizado_298(centro_id));

alter table public.pedidos add column if not exists responsavel_frete_intermediacao text check(responsavel_frete_intermediacao in('loja','cliente'));
create or replace function public.definir_responsavel_frete_298(_pedido uuid,_responsavel text) returns void
language plpgsql security definer set search_path=public as $$declare p public.pedidos;begin
 select * into p from public.pedidos where id=_pedido for update;
 if not public.usuario_ativo() or not public.can_operate(auth.uid()) or p.id is null or p.modalidade_venda<>'intermediacao' or not public.vendedor_intermediacao_autorizado_298(p.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',_pedido)) then raise exception 'Documento sem acesso à intermediação';end if;
 if p.status not in('rascunho','digitacao') or (p.tipo_documento='orcamento' and (p.orcamento_situacao<>'negociacao' or p.orcamento_validade<(now() at time zone 'America/Sao_Paulo')::date)) then raise exception 'Altere o responsável durante a edição do documento';end if;
 if _responsavel is not null and _responsavel not in('loja','cliente') then raise exception 'Responsável pelo frete inválido';end if;
 update public.pedidos set responsavel_frete_intermediacao=_responsavel where id=_pedido;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',_pedido,'informar_responsavel_frete_298',auth.uid(),jsonb_build_object('anterior',p.responsavel_frete_intermediacao,'novo',_responsavel,'somente_informativo',true));
end $$;
revoke all on function public.definir_responsavel_frete_298(uuid,text) from public,anon;
grant execute on function public.definir_responsavel_frete_298(uuid,text) to authenticated;

create index if not exists cotacoes_vigentes_298 on public.intermediacao_cotacoes_296(centro_id,produto_id,dia desc,revisao desc);
create or replace function public.listar_cotacoes_vigentes_298(_loja uuid,_ate date) returns setof public.intermediacao_cotacoes_296
language plpgsql stable security invoker set search_path=public as $$begin
 if not public.usuario_ativo() or not public.can_operate(auth.uid()) or _ate is null or not public.vendedor_intermediacao_autorizado_298(_loja) then raise exception 'Sem acesso às cotações desta loja';end if;
 return query select distinct on(c.produto_id) c.* from public.intermediacao_cotacoes_296 c where c.centro_id=_loja and c.dia<=_ate order by c.produto_id,c.dia desc,c.revisao desc;
end $$;
revoke all on function public.listar_cotacoes_vigentes_298(uuid,date) from public,anon;
grant execute on function public.listar_cotacoes_vigentes_298(uuid,date) to authenticated;
-- Não cria outra revisão/data quando o preço se mantém igual.
do $$declare d text;begin
 select pg_get_functiondef('public.salvar_cotacao_intermediacao_296(uuid,uuid,date,numeric)'::regprocedure) into d;
 if position('preco_vigente_298' in d)=0 then
  if position('dia=_dia order by revisao desc limit 1' in d)=0 then raise exception 'Motor de cotação incompatível com a fase298';end if;
  d:=replace(d,'declare anterior public.intermediacao_cotacoes_296;', 'declare rev_dia integer; anterior public.intermediacao_cotacoes_296;');
  d:=replace(d,'hashtextextended(_loja::text||_produto::text||_dia::text,296)','hashtextextended(_loja::text||_produto::text,298)');
  d:=replace(d,'dia=_dia order by revisao desc limit 1','dia<=_dia order by dia desc,revisao desc limit 1');
  d:=replace(d,'insert into public.intermediacao_cotacoes_296(centro_id', '-- preco_vigente_298'||chr(10)||' select coalesce(max(revisao),0)+1 into rev_dia from public.intermediacao_cotacoes_296 where centro_id=_loja and produto_id=_produto and dia=_dia;'||chr(10)||' insert into public.intermediacao_cotacoes_296(centro_id');
  d:=replace(d,'coalesce(anterior.revisao,0)+1','rev_dia');
  execute d;
 end if;
 select pg_get_functiondef('public.item_intermediacao_296()'::regprocedure) into d;
 if position('preco_vigente_item_298' in d)=0 then
  if position('q.dia is distinct from coalesce(p.orcamento_data,p.data_pedido)' in d)=0 then raise exception 'Validação da cotação incompatível com a fase298';end if;
  d:=replace(d,'q.dia is distinct from coalesce(p.orcamento_data,p.data_pedido)', 'q.dia > coalesce(p.orcamento_data,p.data_pedido)');
  d:=replace(d,'dia=q.dia and revisao>q.revisao', 'dia<=coalesce(p.orcamento_data,p.data_pedido) and (dia>q.dia or (dia=q.dia and revisao>q.revisao))');
  d:=replace(d,'declare p public.pedidos;', '-- preco_vigente_item_298'||chr(10)||'declare p public.pedidos;');
  d:=replace(d,'Selecione uma cotação do produto na data e loja do pedido','Cadastre ou selecione o último preço do produto vigente até a data base, na mesma loja');
  execute d;
 end if;
end $$;

-- Contexto privado e transacional: não pode ser forjado por parâmetro ou GUC do navegador.
create table if not exists public.intermediacao_trocas_contexto_298(pedido_id uuid primary key references public.pedidos(id),usuario_id uuid not null references public.profiles(id),transacao bigint not null);
alter table public.intermediacao_trocas_contexto_298 enable row level security;
revoke all on public.intermediacao_trocas_contexto_298 from public,anon,authenticated;
grant all on public.intermediacao_trocas_contexto_298 to service_role;
create or replace function public.contexto_modalidade_298(_pedido uuid) returns boolean
language sql stable security definer set search_path=public as $$select public.usuario_ativo() and exists(select 1 from public.intermediacao_trocas_contexto_298 where pedido_id=_pedido and usuario_id=auth.uid() and transacao=txid_current())$$;
revoke all on function public.contexto_modalidade_298(uuid) from public,anon,authenticated,service_role;
do $$declare d text;a text:='exists(select 1 from public.pedido_itens where pedido_id=old.id)) then raise exception ''Escolha a modalidade antes de incluir os itens''';n text:='exists(select 1 from public.pedido_itens where pedido_id=old.id) and not public.contexto_modalidade_298(old.id)) then raise exception ''Use a prévia para alterar a modalidade com itens''';begin
 select pg_get_functiondef('public.modalidade_pedido_296()'::regprocedure) into d;
 if position('contexto_modalidade_298' in d)=0 then
  if position(a in d)=0 then raise exception 'Proteção de modalidade incompatível com a fase298';end if;
  execute replace(d,a,n);
 end if;
end $$;

create or replace function public.previa_modalidade_298(_pedido uuid,_modalidade text) returns jsonb
language plpgsql stable security definer set search_path=public as $$declare p public.pedidos;linhas jsonb;versao text;begin
 select * into p from public.pedidos where id=_pedido;
 if not public.usuario_ativo() or not public.can_operate(auth.uid()) or p.id is null or not public.usuario_pode_acessar_centro(p.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',_pedido)) then raise exception 'Documento sem acesso';end if;
 if p.status not in('rascunho','digitacao') or (p.tipo_documento='orcamento' and (not public.orcamento_acessivel_236(_pedido) or p.orcamento_situacao<>'negociacao' or p.orcamento_validade<(now() at time zone 'America/Sao_Paulo')::date)) then raise exception 'Altere a modalidade somente durante a edição de um documento válido';end if;
 if _modalidade is null or _modalidade not in('estoque','intermediacao') then raise exception 'Modalidade inválida';end if;
 if (p.modalidade_venda='intermediacao' or _modalidade='intermediacao') and not public.vendedor_intermediacao_autorizado_298(p.centro_id) then raise exception 'Vendedor não autorizado para intermediação nesta loja';end if;
 if _modalidade='intermediacao' and not public.intermediacao_ativa_296(p.centro_id) then raise exception 'Intermediação não habilitada nesta loja';end if;
 if exists(select 1 from public.pedido_itens where pedido_id=_pedido) and not public.pode_alterar_preco(auth.uid()) then raise exception 'Seu perfil não permite revisar a precificação dos itens';end if;
 if exists(select 1 from public.contas_receber where pedido_id=_pedido and status<>'cancelado') or exists(select 1 from public.estoque_reservas where pedido_id=_pedido) or exists(select 1 from public.intermediacao_confirmacoes_296 where pedido_id=_pedido and ciclo=p.ciclo_reabertura_289) or exists(select 1 from public.expedicoes where pedido_id=_pedido and status<>'cancelada') or exists(select 1 from public.carga_pedidos where pedido_id=_pedido) then raise exception 'O documento já possui confirmação financeira, estoque reservado ou vínculo logístico. Retorne à digitação pela rotina administrativa';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'produto',pr.descricao,'produto_id',i.produto_id,'quantidade',i.quantidade,'preco_anterior',i.preco_unitario,'desconto_anterior',i.desconto_percentual,'total_anterior',i.total,'preco_liquido',round(i.preco_unitario*(1-coalesce(i.desconto_percentual,0)/100),4),'cotacao',q.id,'data_preco',q.dia,'fabrica',q.custo_fabrica,'custo_estoque',coalesce(nullif(pr.custo_medio,0),nullif(pr.preco_custo,0),nullif(pr.ultimo_custo,0),0),'frete',0,'margem',round(i.preco_unitario*(1-coalesce(i.desconto_percentual,0)/100),4)-q.custo_fabrica) order by i.id),'[]'::jsonb) into linhas
 from public.pedido_itens i join public.produtos pr on pr.id=i.produto_id
 left join lateral(select c.* from public.intermediacao_cotacoes_296 c where c.centro_id=p.centro_id and c.produto_id=i.produto_id and c.dia<=coalesce(p.orcamento_data,p.data_pedido) order by c.dia desc,c.revisao desc limit 1) q on _modalidade='intermediacao'
 where i.pedido_id=_pedido;
 versao:=md5(to_jsonb(p)::text||coalesce((select jsonb_agg(to_jsonb(i) order by i.id)::text from public.pedido_itens i where i.pedido_id=_pedido),'[]')||linhas::text);
 return jsonb_build_object('versao',versao,'anterior',p.modalidade_venda,'nova',_modalidade,'itens',linhas,'total_itens',p.total_itens);
end $$;
revoke all on function public.previa_modalidade_298(uuid,text) from public,anon;
grant execute on function public.previa_modalidade_298(uuid,text) to authenticated;

create or replace function public.trocar_modalidade_298(_pedido uuid,_modalidade text,_versao text,_itens jsonb) returns public.pedidos
language plpgsql security definer set search_path=public as $$declare p public.pedidos;previa jsonb;j jsonb;i public.pedido_itens;fr numeric;mg numeric;antes jsonb;begin
 select * into p from public.pedidos where id=_pedido for update;
 perform 1 from public.pedido_itens where pedido_id=_pedido order by id for update;
 previa:=public.previa_modalidade_298(_pedido,_modalidade);
 if _versao is null or _versao is distinct from previa->>'versao' then raise exception 'O documento ou os preços mudaram. Atualize a prévia antes de confirmar';end if;
 if p.modalidade_venda=_modalidade then return p;end if;
 if _modalidade='intermediacao' then
  if _itens is null or jsonb_typeof(_itens)<>'array' or jsonb_array_length(_itens)<>jsonb_array_length(previa->'itens') or length(_itens::text)>100000 then raise exception 'Confira todos os itens da prévia';end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(_itens) x)<>jsonb_array_length(_itens) then raise exception 'Não repita itens';end if;
  for j in select * from jsonb_array_elements(_itens) loop
   if jsonb_typeof(j)<>'object' or exists(select 1 from jsonb_object_keys(j) k where k not in('id','cotacao','frete','margem')) then raise exception 'Item da prévia inválido';end if;
   if not exists(select 1 from jsonb_array_elements(previa->'itens') x where x->>'id'=j->>'id' and x->>'cotacao'=j->>'cotacao') then raise exception 'Cotação ausente ou diferente da prévia';end if;
  end loop;
 end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into antes from public.pedido_itens x where x.pedido_id=_pedido;
 insert into public.intermediacao_trocas_contexto_298 values(_pedido,auth.uid(),txid_current());
 update public.pedidos set modalidade_venda=_modalidade where id=_pedido;
 for i in select * from public.pedido_itens where pedido_id=_pedido order by id loop
  if _modalidade='intermediacao' then
   select x into j from jsonb_array_elements(_itens) x where x->>'id'=i.id::text;
   fr:=(j->>'frete')::numeric;mg:=(j->>'margem')::numeric;
   perform public.salvar_item_intermediacao_296(_pedido,i.id,i.produto_id,i.quantidade,(j->>'cotacao')::uuid,fr,mg);
  else
   update public.pedido_itens set cotacao_intermediacao_id=null,custo_fabrica_saca=null,frete_saca=null,margem_saca=null,custo_unitario_base=null where id=i.id;
  end if;
 end loop;
 perform public.recalcular_pedido(_pedido);
 delete from public.intermediacao_trocas_contexto_298 where pedido_id=_pedido;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',_pedido,'trocar_modalidade_298',auth.uid(),jsonb_build_object('anterior',p.modalidade_venda,'nova',_modalidade,'itens_anteriores',antes,'itens_novos',(select jsonb_agg(to_jsonb(x) order by x.id) from public.pedido_itens x where x.pedido_id=_pedido)));
 select * into p from public.pedidos where id=_pedido;return p;
end $$;
revoke all on function public.trocar_modalidade_298(uuid,text,text,jsonb) from public,anon;
grant execute on function public.trocar_modalidade_298(uuid,text,text,jsonb) to authenticated;

create or replace function public.criar_documento_modalidade_298(_natureza text,_modalidade text,_cliente_id uuid,_centro_id uuid,_rota_id uuid,_forma_pagamento_id uuid,_data_pedido date,_validade date default null,_observacoes text default null,_representante_id uuid default null) returns public.pedidos
language plpgsql security definer set search_path=public as $$declare p public.pedidos;begin
 if not public.usuario_ativo() or not public.can_operate(auth.uid()) then raise exception 'Sem permissão para criar documentos';end if;
 if _modalidade is null or _modalidade not in('estoque','intermediacao') or _natureza is null or _natureza not in('pedido','orcamento') then raise exception 'Natureza ou modalidade inválida';end if;
 if _modalidade='intermediacao' and not public.intermediacao_ativa_296(_centro_id) then raise exception 'Intermediação não habilitada nesta loja';end if;
 if _natureza='orcamento' then
  p:=public.criar_orcamento_236(_cliente_id,_centro_id,_rota_id,_forma_pagamento_id,_validade,_data_pedido,_observacoes,_representante_id);
 else
  p:=public.criar_pedido_rascunho(_cliente_id,_centro_id,_rota_id,_forma_pagamento_id,_data_pedido,_observacoes,_representante_id);
 end if;
 if _modalidade<>'estoque' then perform public.definir_modalidade_pedido_296(p.id,_modalidade);end if;
 select d.* into p from public.pedidos d where d.id=p.id;return p;
end $$;
revoke all on function public.criar_documento_modalidade_298(text,text,uuid,uuid,uuid,uuid,date,date,text,uuid) from public,anon;
grant execute on function public.criar_documento_modalidade_298(text,text,uuid,uuid,uuid,uuid,date,date,text,uuid) to authenticated;
-- Permissões são verificadas também no servidor; não basta esconder os controles.
do $$declare d text;begin
 select pg_get_functiondef('public.item_intermediacao_296()'::regprocedure) into d;
 if position('vendedor_intermediacao_autorizado_298' in d)=0 then
  d:=replace(d,'not public.pode_alterar_preco(auth.uid())', 'not public.pode_alterar_preco(auth.uid()) or not public.vendedor_intermediacao_autorizado_298(p.centro_id)');execute d;
 end if;
 select pg_get_functiondef('public.confirmar_pedido(uuid)'::regprocedure) into d;
 if position('vendedor_intermediacao_autorizado_298' in d)=0 then
  if position('if ped.id is null then' in d)=0 then raise exception 'Confirmação incompatível com a fase298';end if;
  d:=replace(d,'if ped.id is null then', 'if ped.modalidade_venda=''intermediacao'' and not public.vendedor_intermediacao_autorizado_298(ped.centro_id) then raise exception ''Vendedor não autorizado para intermediação'';end if;'||chr(10)||' if ped.id is null then');execute d;
 end if;
 -- Apenas mínimos de margem são dispensados; crédito, desconto e custo válido continuam verificados.
 select pg_get_functiondef('public.validar_pedido(uuid)'::regprocedure) into d;
 if position('minimo_intermediacao_298' in d)=0 then
  if position('if custo > 0 and item.preco_unitario > 0 then' in d)=0 then raise exception 'Margem mínima incompatível com a fase298';end if;
  d:=replace(d,'if custo > 0 and item.preco_unitario > 0 then', '/* minimo_intermediacao_298 */ if ped.modalidade_venda<>''intermediacao'' and custo > 0 and item.preco_unitario > 0 then');
  d:=replace(d,'if public.margem_inadequada_215(_pedido_id) then', 'if ped.modalidade_venda<>''intermediacao'' and public.margem_inadequada_215(_pedido_id) then');execute d;
 end if;
end $$;
do $$declare d text;begin
 select pg_get_functiondef('public.margem_inadequada_215(uuid)'::regprocedure) into d;
 if position('minimo_intermediacao_298' in d)=0 then
  if position('where p.id=_pedido and (' in d)=0 then raise exception 'Regra de margem incompatível com a fase298';end if;
  execute replace(d,'where p.id=_pedido and (','where p.id=_pedido and p.modalidade_venda<>''intermediacao'' /* minimo_intermediacao_298 */ and (');
 end if;
end $$;
-- A troca incorpora descontos no preço líquido e mantém a gravação indivisível.
do $$declare d text;begin
 select pg_get_functiondef('public.salvar_item_intermediacao_296(uuid,uuid,uuid,numeric,uuid,numeric,numeric)'::regprocedure) into d;
 if position('desconto_percentual=0,quantidade=' in d)=0 then
  execute replace(d,'set quantidade=_quantidade','set desconto_percentual=0,quantidade=_quantidade');
 end if;
 select pg_get_functiondef('public.item_intermediacao_296()'::regprocedure) into d;
 if position('excluir_intermediacao_298' in d)=0 then
  d:=replace(d,$a$if tg_op='DELETE' then$a$, $a$if tg_op='DELETE' then /* excluir_intermediacao_298 */ if not public.vendedor_intermediacao_autorizado_298(p.centro_id) then raise exception 'Vendedor não autorizado para intermediação';end if;$a$);execute d;
 end if;
 select pg_get_functiondef('public.modalidade_pedido_296()'::regprocedure) into d;
 if position('vendedor_modalidade_298' in d)=0 then
  if position($a$if new.modalidade_venda is distinct from old.modalidade_venda and ($a$ in d)=0 then raise exception 'Proteção de vendedor incompatível';end if;
  d:=replace(d,$a$if new.modalidade_venda is distinct from old.modalidade_venda and ($a$, $a$/* vendedor_modalidade_298 */ if tg_op='UPDATE' and new.modalidade_venda is distinct from old.modalidade_venda and old.modalidade_venda='intermediacao' and not public.vendedor_intermediacao_autorizado_298(old.centro_id) then raise exception 'Vendedor não autorizado para intermediação';end if;
 if new.modalidade_venda is distinct from old.modalidade_venda and ($a$);execute d;
 end if;
end $$;
-- O campo informativo respeita a mesma janela de edição, inclusive via API direta.
create or replace function public.proteger_responsavel_frete_298() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if new.responsavel_frete_intermediacao is distinct from old.responsavel_frete_intermediacao then
  if new.modalidade_venda<>'intermediacao' or old.status not in('rascunho','digitacao') or not public.usuario_ativo() or not public.can_operate(auth.uid()) or not public.vendedor_intermediacao_autorizado_298(old.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',old.id)) then raise exception 'Altere o responsável pelo frete somente na edição autorizada da intermediação';end if;
  if old.tipo_documento='orcamento' and (old.orcamento_situacao is distinct from 'negociacao' or old.orcamento_validade<(now() at time zone 'America/Sao_Paulo')::date) then raise exception 'Orçamento fora da negociação válida';end if;
 end if;return new;
end $$;
revoke all on function public.proteger_responsavel_frete_298() from public,anon,authenticated,service_role;
drop trigger if exists aa_responsavel_frete_298 on public.pedidos;
create trigger aa_responsavel_frete_298 before update of responsavel_frete_intermediacao on public.pedidos for each row execute function public.proteger_responsavel_frete_298();
notify pgrst,'reload schema';
commit;
