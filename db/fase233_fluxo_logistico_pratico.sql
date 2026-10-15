-- Fase233: pedidos em lote -> separação concluída -> carga -> entregas.
-- Aplicar após fase232. Não confirma vendas, não emite NF e não refaz estoque/financeiro.
begin;
do $$ declare x record; novo text; begin
 if to_regprocedure('public.confirmar_entrega_232(uuid,date,text,text,text,uuid)') is null then raise exception 'Aplique a fase232 antes da fase233'; end if;
 for x in select * from (values
  ('pedidos_enviar_separacao','Enviar pedidos confirmados para separação em lote','/pedidos',136),
  ('separacao_concluir','Separar pedidos e concluir com conferência integrada','/separacao',137),
  ('cargas_operar','Montar e despachar cargas com pedidos separados','/cargas',138)
 ) v(codigo,nome,modulo,ordem) loop
  novo:=null;
  insert into public.permissoes(codigo,nome,grupo,modulo,ordem) values(x.codigo,x.nome,'Logística',x.modulo,x.ordem) on conflict do nothing returning codigo into novo;
  if novo is not null then insert into public.role_permissoes(role,permissao) select distinct role::text,x.codigo from public.role_menus where path=x.modulo on conflict do nothing; end if;
 end loop;
end $$;

-- Evidência de confirmação: a saída de estoque já feita pela venda. Não cria nem repete saídas.
create or replace function public.pedido_confirmado_logistica_233(_pedido uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select public.usuario_ativo() and exists(select 1 from public.pedidos p where p.id=_pedido
  and public.usuario_pode_acessar_centro(p.centro_id)
  and (not public.escopo_representante() or public.documento_na_minha_carteira('pedidos',p.id))
  and exists(select 1 from public.estoque_movimentos m where m.documento_id=p.id and m.origem='pedido' and m.tipo='saida'));
$$;
revoke all on function public.pedido_confirmado_logistica_233(uuid) from public,anon;
grant execute on function public.pedido_confirmado_logistica_233(uuid) to authenticated;

create or replace function public.enviar_pedidos_separacao_233(_pedidos uuid[])
returns integer language plpgsql security definer set search_path=public as $$
declare pid uuid; p public.pedidos; feitos integer:=0;
begin
 if not public.usuario_ativo() or not public.pode_rotina('pedidos_enviar_separacao') or not (public.can_operate(auth.uid()) or public.can_stock(auth.uid())) then raise exception 'Sem acesso ao envio para separação'; end if;
 if _pedidos is null or cardinality(_pedidos) not between 1 and 100 or array_position(_pedidos,null) is not null or (select count(distinct x) from unnest(_pedidos) x)<>cardinality(_pedidos) then raise exception 'Selecione de 1 a 100 pedidos distintos'; end if;
 for pid in select unnest(_pedidos) order by 1 loop
  select * into p from public.pedidos where id=pid for update;
  perform 1 from public.clientes where id=p.cliente_id for share;
  if p.id is null or not public.pedido_confirmado_logistica_233(pid) then raise exception 'Pedido sem acesso ou sem confirmação operacional: %',pid; end if;
  if p.status not in ('confirmado','separacao') then raise exception 'Pedido % não está confirmado para separação (status: %)',p.numero,p.status; end if;
  if p.status='confirmado' then perform public.avancar_pedido(pid,'separacao'); feitos:=feitos+1; end if;
  insert into public.pedido_separacoes(pedido_id,status) values(pid,'em_separacao') on conflict(pedido_id) do nothing;
 end loop;
 insert into public.auditoria(tabela,acao,user_id,detalhe) values('pedidos','enviar_separacao_lote_233',auth.uid(),jsonb_build_object('pedidos',_pedidos,'enviados',feitos));
 return feitos;
end $$;
revoke all on function public.enviar_pedidos_separacao_233(uuid[]) from public,anon;
grant execute on function public.enviar_pedidos_separacao_233(uuid[]) to authenticated;

create or replace function public.concluir_separacao_pratica_233(_pedido uuid,_confirmar_completa boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare p public.pedidos;
begin
 if not public.usuario_ativo() or not public.pode_rotina('separacao_concluir') or not public.can_stock(auth.uid()) then raise exception 'Sem acesso à conclusão da separação'; end if;
 select * into p from public.pedidos where id=_pedido for update;
 perform 1 from public.clientes where id=p.cliente_id for share;
 if p.id is null or not public.pedido_confirmado_logistica_233(_pedido) then raise exception 'Pedido sem acesso ou sem confirmação operacional'; end if;
 if p.status='conferido' then return; end if;
 if p.status not in ('separacao','separado') then raise exception 'Pedido não está na etapa de separação'; end if;
 perform 1 from public.pedido_itens where pedido_id=p.id order by id for update;
 if not exists(select 1 from public.pedido_itens where pedido_id=p.id) then raise exception 'Pedido sem itens'; end if;
 if exists(select 1 from public.pedido_itens where pedido_id=p.id and quantidade_separada is not null and quantidade_separada<>quantidade) then raise exception 'Há quantidades divergentes. Revise os itens antes de concluir; nenhuma quantidade do pedido será alterada automaticamente'; end if;
 if _confirmar_completa is true then update public.pedido_itens set quantidade_separada=quantidade,divergencia_acao=null,divergencia_obs=null where pedido_id=p.id and quantidade_separada is null; end if;
 if exists(select 1 from public.pedido_itens where pedido_id=p.id and quantidade_separada is null) then raise exception 'Confira os itens ou confirme explicitamente a separação completa'; end if;
 insert into public.pedido_separacoes(pedido_id,status,separador_id) values(p.id,'em_separacao',auth.uid()) on conflict(pedido_id) do nothing;
 if p.status='separacao' then perform public.concluir_separacao(p.id); end if;
 perform public.conferir_separacao(p.id,'Conferência integrada à conclusão da separação');
end $$;
revoke all on function public.concluir_separacao_pratica_233(uuid,boolean) from public,anon;
grant execute on function public.concluir_separacao_pratica_233(uuid,boolean) to authenticated;

-- Mesma assinatura da montagem existente: agora aceita a separação concluída/conferida.
create or replace function public.adicionar_pedido_carga(_carga_id uuid,_pedido_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare c public.cargas; p public.pedidos; msg text;
begin
 if not public.usuario_ativo() or not public.pode_rotina('cargas_operar') or not public.can_ship(auth.uid()) then raise exception 'Sem acesso à montagem de cargas'; end if;
 select * into c from public.cargas where id=_carga_id for update;
 if c.id is null or (c.centro_id is not null and not public.usuario_pode_acessar_centro(c.centro_id)) then raise exception 'Carga sem acesso'; end if;
 if c.status not in ('aberta','em_preparacao') then raise exception 'Carga já fechada ou despachada'; end if;
 if public.escopo_representante() and exists(select 1 from public.carga_pedidos cp where cp.carga_id=c.id and not public.documento_na_minha_carteira('pedidos',cp.pedido_id)) then raise exception 'Carga com pedidos de outra carteira'; end if;
 select * into p from public.pedidos where id=_pedido_id for update;
 perform 1 from public.clientes where id=p.cliente_id for share;
 if p.id is null or not public.pedido_confirmado_logistica_233(p.id) then raise exception 'Pedido sem acesso ou sem confirmação operacional'; end if;
 if c.rota_id is null or p.rota_id is distinct from c.rota_id then raise exception 'Pedido % pertence a outra rota',p.numero; end if;
 if exists(select 1 from public.carga_pedidos cp join public.cargas cg on cg.id=cp.carga_id where cp.pedido_id=p.id and cg.status<>'cancelada' and cg.id<>c.id) then raise exception 'Pedido % já está em outra carga',p.numero; end if;
 if p.status='em_carga' and exists(select 1 from public.carga_pedidos where carga_id=c.id and pedido_id=p.id) then return; end if;
 if p.status not in ('conferido','faturado','nf_emitida') then raise exception 'Conclua a separação do pedido % antes de montar a carga',p.numero; end if;
 msg:=public.bloqueio_faturamento(p.id); if msg is not null then raise exception 'Pedido %: %',p.numero,msg; end if;
 if not exists(select 1 from public.pedido_itens where pedido_id=p.id) then raise exception 'Pedido % sem itens',p.numero; end if;
 if coalesce((select valor from public.parametros where chave='exigir_nf_carga'),'false')='true' and not exists(select 1 from public.notas_saida where pedido_id=p.id and status in ('autorizada','emitida')) then raise exception 'A configuração atual exige nota fiscal autorizada para o pedido %',p.numero; end if;
 if not exists(select 1 from public.expedicoes where pedido_id=p.id and status not in ('entregue','cancelada')) then raise exception 'Pedido % sem romaneio ativo',p.numero; end if;
 if p.status='conferido' then
  -- Marco comercial interno; não chama faturar_pedido, não cria nota nem novos títulos.
  update public.pedidos set status='faturado' where id=p.id;
  insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',p.id,'faturamento_comercial_logistica_233',auth.uid(),jsonb_build_object('carga_id',c.id));
 end if;
 insert into public.carga_pedidos(carga_id,pedido_id,created_by) values(c.id,p.id,auth.uid()) on conflict(carga_id,pedido_id) do nothing;
 update public.pedidos set status='em_carga' where id=p.id;
 update public.expedicoes set carga_id=c.id,rota_id=coalesce(rota_id,c.rota_id),motorista=coalesce(nullif(c.motorista,''),motorista) where pedido_id=p.id and status not in ('entregue','cancelada');
 perform public.recalcular_carga(c.id);
end $$;
revoke all on function public.adicionar_pedido_carga(uuid,uuid) from public,anon;
grant execute on function public.adicionar_pedido_carga(uuid,uuid) to authenticated;

create or replace function public.incluir_pedidos_carga_233(_carga uuid,_pedidos uuid[])
returns integer language plpgsql security definer set search_path=public as $$
declare pid uuid;
begin
 if _pedidos is null or cardinality(_pedidos) not between 1 and 100 or array_position(_pedidos,null) is not null or (select count(distinct x) from unnest(_pedidos) x)<>cardinality(_pedidos) then raise exception 'Selecione de 1 a 100 pedidos distintos'; end if;
 for pid in select unnest(_pedidos) order by 1 loop perform public.adicionar_pedido_carga(_carga,pid); end loop;
 return cardinality(_pedidos);
end $$;
revoke all on function public.incluir_pedidos_carga_233(uuid,uuid[]) from public,anon;
grant execute on function public.incluir_pedidos_carga_233(uuid,uuid[]) to authenticated;

create or replace function public.avancar_carga(_carga_id uuid,_status text,_data date default current_date)
returns void language plpgsql security definer set search_path=public as $$
declare c public.cargas; p public.pedidos; msg text;
begin
 if not public.usuario_ativo() or not public.pode_rotina('cargas_operar') or not public.can_ship(auth.uid()) then raise exception 'Sem acesso à movimentação de cargas'; end if;
 select * into c from public.cargas where id=_carga_id for update;
 if c.id is null or (c.centro_id is not null and not public.usuario_pode_acessar_centro(c.centro_id)) then raise exception 'Carga sem acesso'; end if;
 if exists(select 1 from public.carga_pedidos cp join public.pedidos pp on pp.id=cp.pedido_id where cp.carga_id=c.id and (not public.usuario_pode_acessar_centro(pp.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',pp.id)))) then raise exception 'Carga contém pedidos sem acesso'; end if;
 if c.status=_status then return; end if;
 if _status is null or not (case c.status when 'aberta' then _status in ('em_preparacao','fechada','cancelada') when 'em_preparacao' then _status in ('fechada','cancelada') when 'fechada' then _status in ('aberta','em_rota','cancelada') when 'em_rota' then _status in ('entregando','concluida') when 'entregando' then _status='concluida' else false end) then raise exception 'Transição de carga inválida: % → %',c.status,_status; end if;
 perform 1 from public.pedidos where id in(select pedido_id from public.carga_pedidos where carga_id=c.id) order by id for update;
 if _status in ('fechada','em_rota','concluida') and not exists(select 1 from public.carga_pedidos where carga_id=c.id) then raise exception 'Inclua pedidos na carga'; end if;
 if _status in ('fechada','em_rota') then
  for p in select pp.* from public.pedidos pp join public.carga_pedidos cp on cp.pedido_id=pp.id where cp.carga_id=c.id order by pp.id loop
   perform 1 from public.clientes where id=p.cliente_id for share;
   if p.status<>'em_carga' or not public.pedido_confirmado_logistica_233(p.id) then raise exception 'Pedido % não está liberado para saída',p.numero; end if;
   msg:=public.bloqueio_faturamento(p.id); if msg is not null then raise exception 'Pedido %: %',p.numero,msg; end if;
   if coalesce((select valor from public.parametros where chave='exigir_nf_carga'),'false')='true' and not exists(select 1 from public.notas_saida where pedido_id=p.id and status in ('autorizada','emitida')) then raise exception 'Pedido % sem nota fiscal exigida pela configuração atual',p.numero; end if;
   if not exists(select 1 from public.expedicoes where pedido_id=p.id and carga_id=c.id and status not in ('entregue','cancelada')) then raise exception 'Pedido % sem romaneio vinculado à carga',p.numero; end if;
  end loop;
  perform public.recalcular_carga(c.id);
 end if;
 if _status='em_rota' then
  if _data is null or _data>(now() at time zone 'America/Sao_Paulo')::date or _data<c.data then raise exception 'Data de saída inválida'; end if;
  update public.pedidos set status='em_rota' where id in(select pedido_id from public.carga_pedidos where carga_id=c.id);
  update public.expedicoes set status='em_rota',data_saida=_data,motorista=coalesce(nullif(c.motorista,''),motorista) where carga_id=c.id and status not in ('entregue','cancelada');
 elsif _status='concluida' then
  if exists(select 1 from public.carga_pedidos cp join public.pedidos pp on pp.id=cp.pedido_id where cp.carga_id=c.id and (pp.status not in ('entregue','devolvido') or not exists(select 1 from public.expedicoes e where e.pedido_id=pp.id and e.carga_id=c.id and e.status='entregue' and exists(select 1 from public.entrega_registros er where er.expedicao_id=e.id and er.tipo='entrega')))) then raise exception 'Confirme as entregas dos pedidos antes de concluir a carga'; end if;
 elsif _status='cancelada' then
  update public.pedidos pp set status=case when exists(select 1 from public.notas_saida n where n.pedido_id=pp.id and n.status in ('autorizada','emitida')) then 'nf_emitida' else 'faturado' end where pp.status='em_carga' and pp.id in(select pedido_id from public.carga_pedidos where carga_id=c.id);
  update public.expedicoes set carga_id=null where carga_id=c.id and status not in ('entregue','cancelada');
 end if;
 update public.cargas set status=_status where id=c.id;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('cargas',c.id,'carga_'||_status,auth.uid(),jsonb_build_object('de',c.status,'data',_data));
end $$;
revoke all on function public.avancar_carga(uuid,text,date) from public,anon;
grant execute on function public.avancar_carga(uuid,text,date) to authenticated;

create or replace function public.despachar_carga_233(_carga uuid,_data date default null)
returns void language plpgsql security definer set search_path=public as $$
declare st text;
begin
 if not public.usuario_ativo() or not public.can_ship(auth.uid()) or not public.pode_rotina('cargas_operar') then raise exception 'Sem acesso ao despacho'; end if;
 select status into st from public.cargas where id=_carga for update;
 if st in ('aberta','em_preparacao') then perform public.avancar_carga(_carga,'fechada',coalesce(_data,(now() at time zone 'America/Sao_Paulo')::date)); end if;
 perform public.avancar_carga(_carga,'em_rota',coalesce(_data,(now() at time zone 'America/Sao_Paulo')::date));
end $$;
revoke all on function public.despachar_carga_233(uuid,date) from public,anon;
grant execute on function public.despachar_carga_233(uuid,date) to authenticated;

create or replace function public.sincronizar_carga_entregue_233()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='entregue' and old.status is distinct from new.status and new.carga_id is not null then
  perform 1 from public.cargas where id=new.carga_id for update;
  if exists(select 1 from public.carga_pedidos where carga_id=new.carga_id) and not exists(
   select 1 from public.carga_pedidos cp join public.pedidos p on p.id=cp.pedido_id where cp.carga_id=new.carga_id
    and (p.status not in ('entregue','devolvido') or not exists(select 1 from public.expedicoes e where e.pedido_id=p.id and e.carga_id=new.carga_id and e.status='entregue' and exists(select 1 from public.entrega_registros er where er.expedicao_id=e.id and er.tipo='entrega')))
  ) then
   update public.cargas set status='concluida' where id=new.carga_id and status in ('em_rota','entregando');
   if found then insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('cargas',new.carga_id,'conclusao_por_entregas_233',auth.uid(),'{}'); end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function public.sincronizar_carga_entregue_233() from public,anon,authenticated;
drop trigger if exists zzzz_carga_entregue_233 on public.expedicoes;
create trigger zzzz_carga_entregue_233 after update of status on public.expedicoes for each row execute function public.sincronizar_carga_entregue_233();

-- Protege também as entradas legadas, mantendo seus motores e assinaturas.
do $$ declare x record; definicao text; complemento text; begin
 for x in select * from (values
  ('criar_carga(uuid,date,uuid,text,text,text,uuid,text)','cargas_operar'),
  ('remover_pedido_carga(uuid,uuid)','cargas_operar'),
  ('iniciar_separacao(uuid)','separacao_concluir'),
  ('concluir_separacao(uuid)','separacao_concluir'),
  ('conferir_separacao(uuid,text)','separacao_concluir')
 ) v(assinatura,acao) loop
  if to_regprocedure('public.'||x.assinatura) is null then raise exception 'Motor ausente: %',x.assinatura; end if;
  select pg_get_functiondef(to_regprocedure('public.'||x.assinatura)) into definicao;
  if position('logistica_guard_233' in definicao)=0 then
   if x.assinatura like 'conferir_separacao%' then definicao:=replace(replace(definicao,'Separação conferida e liberada para faturamento.','Separação concluída e liberada para montagem da carga.'),'''/faturamento''','''/cargas'''); end if;
   complemento:='';
   if x.assinatura like 'criar_carga%' then complemento:='if _centro_id is not null and not public.usuario_pode_acessar_centro(_centro_id) then raise exception ''Centro sem acesso''; end if;';
   elsif x.assinatura like 'remover_pedido%' then complemento:=$guard$
    perform 1 from public.cargas where id=_carga_id for update;
    perform 1 from public.pedidos where id=_pedido_id for update;
    if not exists(select 1 from public.cargas where id=_carga_id and status in ('aberta','em_preparacao','fechada') and (centro_id is null or public.usuario_pode_acessar_centro(centro_id)))
     or not exists(select 1 from public.carga_pedidos where carga_id=_carga_id and pedido_id=_pedido_id)
     or exists(select 1 from public.carga_pedidos cp join public.pedidos p on p.id=cp.pedido_id where cp.carga_id=_carga_id and (not public.usuario_pode_acessar_centro(p.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',p.id)))) then raise exception 'Carga ou pedido sem acesso para retirada'; end if;
   $guard$;
   else complemento:=$guard$
    perform 1 from public.pedidos where id=_pedido_id for update;
    perform 1 from public.clientes where id=(select cliente_id from public.pedidos where id=_pedido_id) for share;
    if not public.pedido_confirmado_logistica_233(_pedido_id) then raise exception 'Pedido sem acesso ou sem confirmação operacional'; end if;
    if exists(select 1 from public.pedido_itens where pedido_id=_pedido_id and quantidade_separada is not null and quantidade_separada<>quantidade) then raise exception 'Resolva as divergências antes de concluir a separação'; end if;
   $guard$; end if;
   execute regexp_replace(definicao,'\mBEGIN\M',format(E'BEGIN
 -- logistica_guard_233
 if not public.pode_rotina(%L) then raise exception ''Ação não liberada para seu perfil''; end if;
 %s
',x.acao,complemento),'i');
  end if;
  execute format('revoke all on function public.%s from public,anon',x.assinatura);
 end loop;
end $$;

create or replace view public.vw_pedidos_para_carga with(security_invoker=on) as
select p.id pedido_id,p.numero,p.status,p.rota_id,r.nome rota,p.centro_id,cli.razao_social cliente,p.total_liquido,public.peso_pedido(p.id) peso_kg,n.nf_numero,n.status nf_status
 from public.pedidos p left join public.rotas r on r.id=p.rota_id left join public.clientes cli on cli.id=p.cliente_id
 left join lateral(select nf_numero,status from public.notas_saida where pedido_id=p.id and status in ('autorizada','emitida') order by created_at desc,id limit 1) n on true
 where p.status in ('conferido','faturado','nf_emitida') and public.pedido_confirmado_logistica_233(p.id) and public.bloqueio_faturamento(p.id) is null
  and not exists(select 1 from public.carga_pedidos cp join public.cargas cg on cg.id=cp.carga_id where cp.pedido_id=p.id and cg.status<>'cancelada');
grant select on public.vw_pedidos_para_carga to authenticated;
create or replace function public.entregas_listar_232(_centro uuid default null,_status text default 'em_rota',_rota uuid default null,_busca text default '',_pagina integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare resultado jsonb;
begin
 if not public.usuario_ativo() or not public.can_ship(auth.uid()) or not public.pode_rotina('entregas_operar') then raise exception 'Rotina de entregas não liberada para seu perfil'; end if;
 if _centro is not null and not public.usuario_pode_acessar_centro(_centro) then raise exception 'Centro sem acesso'; end if;
 if _status is null or _status not in ('','em_rota','entregue','aguardando_saida') or _pagina is null or _pagina<0 or _pagina>100000 then raise exception 'Filtro ou página inválidos'; end if;
 with escopo as materialized (
  select e.id expedicao_id,e.pedido_id,e.numero romaneio,case when p.status='em_carga' and cg.carga_id is not null then 'aguardando_saida' else e.status end status,cg.carga_id,cg.carga_numero,e.centro_id,p.numero,p.data_pedido,p.status pedido_status,p.rota_id,
   e.data_saida,e.previsao_entrega,e.data_entrega,e.motorista,c.razao_social cliente,c.codigo codigo_cliente,c.telefone,c.cidade,c.uf,
   nullif(concat_ws(', ',nullif(to_jsonb(c)->>'logradouro',''),nullif(to_jsonb(c)->>'numero',''),nullif(to_jsonb(c)->>'bairro','')),'') endereco,
   coalesce(rt.nome,'Sem rota') rota,ce.nome centro,
   (select count(*) from public.pedido_itens i where i.pedido_id=p.id) itens,
   exists(select 1 from public.entrega_registros er join public.entrega_itens it on it.registro_id=er.id where er.pedido_id=p.id) parcial,
   er.recebedor,er.comprovante,er.observacao,er.created_at registrado_em,pr.nome registrado_por
  from public.expedicoes e join public.pedidos p on p.id=e.pedido_id join public.clientes c on c.id=p.cliente_id
   left join public.rotas rt on rt.id=p.rota_id left join public.centros ce on ce.id=e.centro_id
   left join lateral(select cp.carga_id,c.numero carga_numero from public.carga_pedidos cp join public.cargas c on c.id=cp.carga_id where cp.pedido_id=p.id and c.status<>'cancelada' and (c.centro_id is null or public.usuario_pode_acessar_centro(c.centro_id)) order by c.numero desc limit 1) cg on true
   left join public.entrega_registros er on er.expedicao_id=e.id and er.tipo='entrega' left join public.profiles pr on pr.id=er.created_by
  where (e.status in ('em_rota','entregue') or (p.status='em_carga' and cg.carga_id is not null and e.status<>'cancelada')) and p.status not in ('rascunho','digitacao','aguardando_aprovacao','aprovado','cancelado','recusado','devolvido')
   and public.usuario_pode_acessar_centro(e.centro_id) and public.usuario_pode_acessar_centro(p.centro_id)
   and (not public.escopo_representante() or public.documento_na_minha_carteira('pedidos',p.id))
   and (_centro is null or e.centro_id=_centro)
 ), filtrados as materialized(
  select * from escopo where (_rota is null or rota_id=_rota) and (coalesce(_busca,'')='' or position(lower(trim(_busca)) in lower(numero::text||' '||cliente||' '||coalesce(codigo_cliente::text,'')||' '||coalesce(cidade,'')))>0)
 ), escolhidos as materialized(select * from filtrados where _status='' or status=_status or (_status='em_rota' and status='aguardando_saida')),
 pagina as(select * from escolhidos order by case when status='em_rota' then 0 else 1 end,data_entrega desc nulls last,previsao_entrega nulls last,numero,expedicao_id limit 50 offset _pagina*50)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by case when p.status='em_rota' then 0 else 1 end,p.data_entrega desc nulls last,p.previsao_entrega nulls last,p.numero,p.expedicao_id) from pagina p),'[]'),
 'count',(select count(*) from escolhidos),'pendentes',(select count(*) from filtrados where status in ('em_rota','aguardando_saida')),'entregues',(select count(*) from filtrados where status='entregue'),
 'rotas',coalesce((select jsonb_agg(to_jsonb(r) order by nome) from (select distinct rota_id id,rota nome from escopo where rota_id is not null) r),'[]')) into resultado;
 return resultado;
end $$;
revoke all on function public.entregas_listar_232(uuid,text,uuid,text,integer) from public,anon;
grant execute on function public.entregas_listar_232(uuid,text,uuid,text,integer) to authenticated;

notify pgrst,'reload schema';
commit;
