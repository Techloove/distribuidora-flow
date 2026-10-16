-- Fase236: orçamentos em Pedidos, sem efeitos de venda antes do aceite.
-- Aplicar após235. Conserva os motores de edição/aprovação/confirmação instalados.
begin;
do $$ begin
 if to_regprocedure('public.acompanhar_pedido_235(uuid)') is null then raise exception 'Aplique a fase235 antes da fase236'; end if;
end $$;
alter table public.pedidos
 add column if not exists tipo_documento text not null default 'pedido' check(tipo_documento in ('pedido','orcamento')),
 add column if not exists orcamento_situacao text check(orcamento_situacao in ('negociacao','aceito','recusado','expirado')),
 add column if not exists orcamento_data date,
 add column if not exists orcamento_validade date,
 add column if not exists orcamento_aceito_em timestamptz,
 add column if not exists orcamento_encerrado_em timestamptz,
 add column if not exists orcamento_motivo text;
create index if not exists pedidos_orcamentos_236 on public.pedidos(orcamento_validade,representante_id) where tipo_documento='orcamento';
do $$ declare nova text; begin
 insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values
  ('pedidos_orcamentos','Criar, revisar e registrar decisão de orçamentos','Pedidos',140,'/pedidos')
  on conflict do nothing returning codigo into nova;
 if nova is not null then insert into public.role_permissoes(role,permissao)
  select role::text,'pedidos_orcamentos' from public.role_menus where path='/pedidos' on conflict do nothing; end if;
end $$;

create or replace function public.orcamento_acessivel_236(_pedido uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select public.usuario_ativo() and public.can_operate(auth.uid()) and public.pode_rotina('pedidos_orcamentos') and exists(
  select 1 from public.pedidos q236 where q236.id=_pedido and public.usuario_pode_acessar_centro(q236.centro_id)
   and (not public.escopo_representante() or public.documento_na_minha_carteira('pedidos',q236.id))
 );
$$;
revoke all on function public.orcamento_acessivel_236(uuid) from public,anon,authenticated;

-- Bloqueia atalhos de status e edição de propostas encerradas/vencidas.
-- O status operacional permanece rascunho enquanto a natureza for orçamento,
-- portanto relatórios, reserva e faturamento existentes não o contam como venda.
create or replace function public.proteger_orcamento_236()
returns trigger language plpgsql security definer set search_path=public as $$
declare p236 public.pedidos; pid236 uuid; hoje236 date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if tg_table_name='pedido_itens' then
  pid236:=case when tg_op='DELETE' then old.pedido_id else new.pedido_id end;
  select * into p236 from public.pedidos where id=pid236 and tipo_documento='orcamento' for update;
  if tg_op='UPDATE' and old.pedido_id is distinct from new.pedido_id and exists(select 1 from public.pedidos where id=old.pedido_id and tipo_documento='orcamento') then raise exception 'Não transfira itens de orçamento para outro documento'; end if;
  if p236.tipo_documento='orcamento' then
   perform 1 from public.clientes where id=p236.cliente_id for share;
   if not public.orcamento_acessivel_236(p236.id) then raise exception 'Orçamento sem acesso'; end if;
   if p236.orcamento_situacao<>'negociacao' or p236.orcamento_validade<hoje236 then raise exception 'Revise a validade e reabra o orçamento antes de editar os itens'; end if;
  end if;
  return coalesce(new,old);
 end if;
 if new.tipo_documento<>'orcamento' and old.tipo_documento<>'orcamento' then return new; end if;
 perform 1 from public.clientes where id=old.cliente_id for share;
 if not public.orcamento_acessivel_236(old.id) then raise exception 'Orçamento sem acesso'; end if;
 if new.cliente_id is distinct from old.cliente_id or new.representante_id is distinct from old.representante_id or new.centro_id is distinct from old.centro_id then raise exception 'Não altere cliente, representante ou centro de um orçamento'; end if;
 if new.tipo_documento='orcamento' then
  if new.status<>'rascunho' then raise exception 'Registre o aceite e converta o orçamento antes de avançar o pedido'; end if;
  if new.orcamento_data is null or new.orcamento_validade is null or new.orcamento_validade<new.orcamento_data or new.orcamento_situacao is null then raise exception 'Informe data, validade e situação do orçamento'; end if;
  if old.tipo_documento='orcamento' and (old.orcamento_situacao<>'negociacao' or old.orcamento_validade<hoje236) then
   if not (new.orcamento_situacao='negociacao' and new.orcamento_validade>=hoje236
     and (to_jsonb(new)-array['updated_at','orcamento_situacao','orcamento_validade','orcamento_motivo','orcamento_encerrado_em','observacoes'])
       =(to_jsonb(old)-array['updated_at','orcamento_situacao','orcamento_validade','orcamento_motivo','orcamento_encerrado_em','observacoes'])) then
    raise exception 'Revise a validade e reabra o orçamento antes de alterar a proposta';
   end if;
  end if;
 else
  if old.orcamento_situacao<>'negociacao' or old.orcamento_validade<hoje236 or new.orcamento_situacao<>'aceito' or new.orcamento_aceito_em is null then raise exception 'Orçamento precisa estar válido e aceito pelo cliente para conversão'; end if;
 end if;
 return new;
end $$;
revoke all on function public.proteger_orcamento_236() from public,anon,authenticated;
drop trigger if exists orcamento_proteger_236 on public.pedidos;
create trigger orcamento_proteger_236 before update on public.pedidos for each row execute function public.proteger_orcamento_236();
drop trigger if exists orcamento_itens_236 on public.pedido_itens;
create trigger orcamento_itens_236 before insert or update or delete on public.pedido_itens for each row execute function public.proteger_orcamento_236();

create or replace function public.impedir_efeito_orcamento_236()
returns trigger language plpgsql security definer set search_path=public as $$
declare pid236 uuid;
begin
 if tg_table_name='estoque_movimentos' then
  if new.origem<>'pedido' then return new; end if; pid236:=new.documento_id;
 else pid236:=new.pedido_id; end if;
 perform 1 from public.pedidos where id=pid236 and tipo_documento='orcamento' for share;
 if found then raise exception 'Orçamento não gera reserva, saída de estoque, título, comissão, crédito aplicado ou entrega'; end if;
 return new;
end $$;
revoke all on function public.impedir_efeito_orcamento_236() from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['estoque_movimentos','estoque_reservas','contas_receber','comissoes','creditos_clientes_aplicacoes','expedicoes','carga_pedidos'] loop
  execute format('drop trigger if exists orcamento_sem_efeito_236 on public.%I',t);
  execute format('create trigger orcamento_sem_efeito_236 before insert or update on public.%I for each row execute function public.impedir_efeito_orcamento_236()',t);
 end loop;
end $$;
-- A comissão do cabeçalho pode continuar como estimativa; não cria conta de comissão.
do $$ declare s text; begin
 select pg_get_functiondef('public.apurar_comissao_pedido(uuid)'::regprocedure) into s;
 if position('orcamento_comissao_236' in s)=0 then
  s:=regexp_replace(s,'\mbegin\M',$patch$begin
 -- orcamento_comissao_236
 if exists(select 1 from public.pedidos q236 where q236.id=_pedido_id and q236.tipo_documento='orcamento') then return; end if;
 $patch$,'i'); execute s;
 end if;
end $$;

create or replace function public.criar_orcamento_236(_cliente_id uuid,_centro_id uuid,_rota_id uuid,_forma_pagamento_id uuid,_validade date,_data_pedido date default null,_observacoes text default null,_representante_id uuid default null)
returns public.pedidos language plpgsql security definer set search_path=public as $$
declare p236 public.pedidos; hoje236 date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if not public.usuario_ativo() or not public.can_operate(auth.uid()) or not public.pode_rotina('pedidos_orcamentos') then raise exception 'Criação de orçamentos não liberada'; end if;
 if _validade is null or _validade<hoje236 or _validade<coalesce(_data_pedido,hoje236) or length(coalesce(_observacoes,''))>4000 then raise exception 'Informe validade atual/futura e observações de até4000 caracteres'; end if;
 -- O cliente fica protegido contra troca concorrente de carteira durante a criação.
 perform 1 from public.clientes where id=_cliente_id for share;
 if public.escopo_representante() then
  if not public.cliente_na_minha_carteira(_cliente_id) then raise exception 'Cliente fora da sua carteira'; end if;
  _representante_id:=public.meu_representante_id();
 end if;
 p236:=public.criar_pedido_rascunho(_cliente_id,_centro_id,_rota_id,_forma_pagamento_id,coalesce(_data_pedido,hoje236),_observacoes,_representante_id,null);
 if not public.orcamento_acessivel_236(p236.id) then raise exception 'Orçamento sem acesso'; end if;
 if exists(select 1 from public.comissoes where pedido_id=p236.id) then raise exception 'A criação de documento gerou comissão inesperada; nenhuma proposta foi criada'; end if;
 update public.pedidos set tipo_documento='orcamento',orcamento_situacao='negociacao',orcamento_data=data_pedido,orcamento_validade=_validade where id=p236.id returning * into p236;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',p236.id,'criar_orcamento_236',auth.uid(),jsonb_build_object('validade',_validade));
 return p236;
end $$;
revoke all on function public.criar_orcamento_236(uuid,uuid,uuid,uuid,date,date,text,uuid) from public,anon;
grant execute on function public.criar_orcamento_236(uuid,uuid,uuid,uuid,date,date,text,uuid) to authenticated;

create or replace function public.revisar_orcamento_236(_pedido uuid,_validade date,_observacoes text)
returns public.pedidos language plpgsql security definer set search_path=public as $$
declare p236 public.pedidos; antes236 jsonb; begin
 if not public.orcamento_acessivel_236(_pedido) then raise exception 'Orçamento sem acesso'; end if;
 select * into p236 from public.pedidos where id=_pedido for update;
 perform 1 from public.clientes where id=p236.cliente_id for share;
 if not public.orcamento_acessivel_236(_pedido) then raise exception 'Orçamento sem acesso'; end if;
 if p236.tipo_documento<>'orcamento' or p236.status<>'rascunho' then raise exception 'Documento já convertido ou não é orçamento'; end if;
 if _validade is null or _validade<(now() at time zone 'America/Sao_Paulo')::date or _validade<p236.orcamento_data or length(coalesce(_observacoes,''))>4000 then raise exception 'Informe validade atual/futura e observações de até4000 caracteres'; end if;
 antes236:=jsonb_build_object('validade',p236.orcamento_validade,'situacao',p236.orcamento_situacao,'observacoes',p236.observacoes,'motivo',p236.orcamento_motivo);
 update public.pedidos set orcamento_validade=_validade,observacoes=nullif(trim(_observacoes),''),orcamento_situacao='negociacao',orcamento_motivo=null,orcamento_encerrado_em=null where id=_pedido returning * into p236;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',_pedido,'revisar_orcamento_236',auth.uid(),jsonb_build_object('antes',antes236,'validade',_validade));
 return p236;
end $$;
revoke all on function public.revisar_orcamento_236(uuid,date,text) from public,anon;
grant execute on function public.revisar_orcamento_236(uuid,date,text) to authenticated;

create or replace function public.decidir_orcamento_236(_pedido uuid,_acao text,_motivo text default null)
returns public.pedidos language plpgsql security definer set search_path=public as $$
declare p236 public.pedidos; hoje236 date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if not public.orcamento_acessivel_236(_pedido) then raise exception 'Orçamento sem acesso'; end if;
 select * into p236 from public.pedidos where id=_pedido for update;
 perform 1 from public.clientes where id=p236.cliente_id for share;
 if not public.orcamento_acessivel_236(_pedido) then raise exception 'Orçamento sem acesso'; end if;
 if _acao is null or _acao not in ('aceitar','recusar') or length(coalesce(_motivo,''))>1000 then raise exception 'Decisão inválida'; end if;
 if _acao='aceitar' and p236.tipo_documento='pedido' and p236.orcamento_situacao='aceito' then return p236; end if;
 if p236.tipo_documento<>'orcamento' or p236.status<>'rascunho' then raise exception 'Documento não é orçamento em negociação'; end if;
 if _acao='recusar' then
  if nullif(trim(_motivo),'') is null then raise exception 'Informe o motivo da não aprovação pelo cliente'; end if;
  if p236.orcamento_situacao='recusado' and p236.orcamento_motivo=trim(_motivo) then return p236; end if;
  if p236.orcamento_situacao<>'negociacao' or p236.orcamento_validade<hoje236 then raise exception 'Revise e reabra o orçamento antes de registrar uma nova decisão'; end if;
  update public.pedidos set orcamento_situacao='recusado',orcamento_motivo=trim(_motivo),orcamento_encerrado_em=now() where id=_pedido returning * into p236;
 else
  if p236.orcamento_situacao<>'negociacao' or p236.orcamento_validade<hoje236 then raise exception 'Orçamento vencido ou encerrado. Revise a validade antes do aceite'; end if;
  if not exists(select 1 from public.pedido_itens where pedido_id=_pedido) or coalesce(p236.total_liquido,0)<=0 then raise exception 'Inclua os itens e valores da proposta antes do aceite'; end if;
  update public.pedidos set tipo_documento='pedido',orcamento_situacao='aceito',orcamento_aceito_em=now(),orcamento_encerrado_em=now(),data_pedido=hoje236 where id=_pedido;
  -- Aceite comercial não é aprovação interna. Não chama confirmar_pedido.
  p236:=public.avancar_pedido(_pedido,'aguardando_aprovacao');
 end if;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',_pedido,'orcamento_'||_acao||'_236',auth.uid(),jsonb_build_object('motivo',_motivo,'status',p236.status,'data_pedido',p236.data_pedido));
 return p236;
end $$;
revoke all on function public.decidir_orcamento_236(uuid,text,text) from public,anon;
grant execute on function public.decidir_orcamento_236(uuid,text,text) to authenticated;

-- Guarda no começo dos motores legados, antes de qualquer efeito transacional.
do $$ declare r text; s text; begin
 foreach r in array array['confirmar_pedido(uuid)','avancar_pedido(uuid,text)','cancelar_pedido(uuid)'] loop
  select pg_get_functiondef(to_regprocedure('public.'||r)) into s;
  if s is null then raise exception 'Motor obrigatório ausente: %',r; end if;
  if position('orcamento_motor_236' in s)=0 then
   execute regexp_replace(s,'\mbegin\M',$patch$begin
 -- orcamento_motor_236
 if exists(select 1 from public.pedidos q236 where q236.id=_pedido_id and q236.tipo_documento='orcamento') then raise exception 'Use as ações de orçamento: aceite e conversão precedem a aprovação interna'; end if;
 $patch$,'i');
  end if;
 end loop;
end $$;
create or replace function public.acompanhar_pedido_236(_pedido uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare resumo236 jsonb; p236 public.pedidos;
begin
 resumo236:=public.acompanhar_pedido_235(_pedido);
 select * into p236 from public.pedidos where id=_pedido;
 return resumo236||jsonb_build_object('tipo_documento',p236.tipo_documento,'orcamento_situacao',p236.orcamento_situacao,'orcamento_validade',p236.orcamento_validade,'orcamento_data',p236.orcamento_data,'orcamento_aceito_em',p236.orcamento_aceito_em);
end $$;
revoke all on function public.acompanhar_pedido_236(uuid) from public,anon;
grant execute on function public.acompanhar_pedido_236(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
