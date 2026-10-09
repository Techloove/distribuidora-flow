-- Fase214: entregas por item, recusas com devolução pendente e comprovantes privados.
begin;
alter table public.entrega_registros add column if not exists arquivo_path text;
create table if not exists public.entrega_itens (
 registro_id uuid not null references public.entrega_registros(id),pedido_item_id uuid not null references public.pedido_itens(id),
 entregue numeric(14,3) not null default 0 check(entregue>=0),recusado numeric(14,3) not null default 0 check(recusado>=0),
 devolucao_id uuid references public.devolucoes(id),check(entregue+recusado>0),primary key(registro_id,pedido_item_id)
);
create index if not exists entrega_item_saldo_214 on public.entrega_itens(pedido_item_id);
create index if not exists entrega_devolucao_214 on public.entrega_itens(devolucao_id) where devolucao_id is not null;
alter table public.entrega_itens enable row level security;
revoke all on public.entrega_itens from public,anon,authenticated;
grant select on public.entrega_itens to authenticated;
drop policy if exists entrega_itens_leitura_214 on public.entrega_itens;
create policy entrega_itens_leitura_214 on public.entrega_itens for select to authenticated using(exists(select 1 from public.entrega_registros where id=registro_id));
alter table public.entrega_registros add column if not exists chave_operacao uuid;
create unique index if not exists entrega_chave_214 on public.entrega_registros(chave_operacao) where chave_operacao is not null;
insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values('entrega_parcial_operar','Registrar entregas parciais e recusas por item','Entregas',123,'/expedicao') on conflict do nothing;
do $$ begin
 if not exists(select 1 from public.auditoria where tabela='fase214' and acao='instalada') then
  insert into public.role_permissoes(role,permissao) select codigo,'entrega_parcial_operar' from public.papeis where codigo='expedicao' on conflict do nothing;
  insert into public.auditoria(tabela,acao,detalhe) values('fase214','instalada','{}');
 end if;
end $$;
-- Sem emissão fiscal neste projeto: preserva faturamento comercial/conferência.
update public.parametros set valor='false' where chave in ('exigir_nf_carga','exigir_nf_boleto');

create or replace function public.registrar_parcial_214(_expedicao uuid,_itens jsonb,_recebedor text,_motivo text,_arquivo text,_chave uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare e public.expedicoes; p public.pedidos; r record; i public.pedido_itens; feito numeric; reg uuid; dev uuid; restantes numeric;
begin
 if not public.pode_rotina('entrega_parcial_operar') or not public.pode_rotina('entrega_registrar') or not public.can_ship(auth.uid()) then raise exception 'Sem acesso à entrega por item'; end if;
 select * into e from public.expedicoes where id=_expedicao for update;
 select * into p from public.pedidos where id=e.pedido_id for update;
 if e.id is null or not public.usuario_pode_acessar_centro(e.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',p.id)) then raise exception 'Expedição sem acesso'; end if;
 if p.status in ('rascunho','digitacao','aguardando_aprovacao','aprovado','cancelado','recusado') then raise exception 'Pedido não está no ciclo de entrega'; end if;
 if _chave is null or _itens is null or jsonb_typeof(_itens)<>'array' or jsonb_array_length(_itens) not between 1 and 300 or nullif(trim(_recebedor),'') is null or length(_recebedor)>120 or length(coalesce(_motivo,''))>4000 or length(coalesce(_arquivo,''))>1000 then raise exception 'Dados da entrega inválidos'; end if;
 select id into reg from public.entrega_registros where chave_operacao=_chave and expedicao_id=e.id;
 if reg is not null then
  if not exists(select 1 from public.entrega_registros where id=reg and recebedor=trim(_recebedor) and coalesce(observacao,'')=coalesce(_motivo,'') and arquivo_path=_arquivo) or
   (select jsonb_agg(jsonb_build_object('item_id',x.item_id,'entregue',x.entregue,'recusado',x.recusado) order by x.item_id) from jsonb_to_recordset(_itens) x(item_id uuid,entregue numeric,recusado numeric)) is distinct from
   (select jsonb_agg(jsonb_build_object('item_id',pedido_item_id,'entregue',entregue,'recusado',recusado) order by pedido_item_id) from public.entrega_itens where registro_id=reg)
  then raise exception 'Chave de entrega já usada com dados diferentes'; end if;
  return reg;
 end if;
 if e.status<>'em_rota' then raise exception 'Expedição deve estar em rota'; end if;
 if _arquivo is null or _arquivo not like e.id::text||'/%' or not exists(select 1 from storage.objects where bucket_id='entrega-comprovantes' and name=_arquivo) then raise exception 'Envie o comprovante privado antes de registrar'; end if;
 if exists(select 1 from jsonb_to_recordset(_itens) x(item_id uuid,entregue numeric,recusado numeric) group by item_id having count(*)>1) then raise exception 'Item duplicado'; end if;
 insert into public.entrega_registros(expedicao_id,pedido_id,centro_id,tipo,recebedor,comprovante,observacao,arquivo_path,chave_operacao)
 values(e.id,p.id,e.centro_id,'ocorrencia',trim(_recebedor),_arquivo,_motivo,_arquivo,_chave) returning id into reg;
 for r in select * from jsonb_to_recordset(_itens) x(item_id uuid,entregue numeric,recusado numeric) loop
  select * into i from public.pedido_itens where id=r.item_id and pedido_id=p.id for update;
  if i.id is null or r.entregue is null or r.recusado is null or r.entregue<0 or r.recusado<0 or r.entregue+r.recusado<=0 or r.entregue::text in ('NaN','Infinity','-Infinity') or r.recusado::text in ('NaN','Infinity','-Infinity') then raise exception 'Quantidade ou item inválido'; end if;
  select coalesce(sum(t.entregue+t.recusado),0) into feito from public.entrega_itens t where t.pedido_item_id=i.id;
  if feito+r.entregue+r.recusado>i.quantidade then raise exception 'Quantidade excede saldo do item'; end if;
  if r.recusado>0 then
   if nullif(trim(_motivo),'') is null then raise exception 'Informe motivo da recusa'; end if;
   if dev is null then
    insert into public.devolucoes(pedido_id,cliente_id,centro_id,motivo,created_by) values(p.id,p.cliente_id,p.centro_id,'Recusa na entrega: '||_motivo,auth.uid()) returning id into dev;
   end if;
   insert into public.devolucao_itens(devolucao_id,produto_id,quantidade,preco_unitario,condicao) values(dev,i.produto_id,r.recusado,i.preco_unitario,'revenda');
  end if;
  insert into public.entrega_itens(registro_id,pedido_item_id,entregue,recusado,devolucao_id) values(reg,i.id,r.entregue,r.recusado,case when r.recusado>0 then dev end);
 end loop;
 select sum(li.quantidade-coalesce(t.qtd,0)) into restantes from public.pedido_itens li left join lateral(select sum(entregue+recusado) qtd from public.entrega_itens where pedido_item_id=li.id) t on true where li.pedido_id=p.id;
 if restantes>0 or dev is not null then update public.pedidos set status='parcial' where id=p.id and status<>'parcial'; end if;
 if restantes=0 and dev is null and not exists(select 1 from public.entrega_itens t join public.entrega_registros er on er.id=t.registro_id join public.devolucoes d on d.id=t.devolucao_id where er.pedido_id=p.id and d.status is distinct from 'confirmada') then
  update public.entrega_registros set tipo='entrega' where id=reg;
  perform public.avancar_expedicao(e.id,'entregue',current_date);
 end if;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('entrega_registros',reg,'entrega_itens',auth.uid(),jsonb_build_object('itens',_itens,'devolucao_pendente',dev));
 return reg;
end $$;
-- Expedição concluída atualiza o pedido; não deixa o ciclo comercial em rota.
create or replace function public.sincronizar_entrega_214()
returns trigger language plpgsql security definer set search_path=public as $$
declare destino text;
begin
 if new.status='entregue' and old.status is distinct from new.status then
  destino:=case when exists(select 1 from public.entrega_itens t join public.entrega_registros r on r.id=t.registro_id where r.pedido_id=new.pedido_id)
   and not exists(select 1 from public.entrega_itens t join public.entrega_registros r on r.id=t.registro_id where r.pedido_id=new.pedido_id and t.entregue>0) then 'devolvido' else 'entregue' end;
  update public.pedidos set status=destino where id=new.pedido_id and status is distinct from destino;
 end if;
 return new;
end $$;
drop trigger if exists sincronizar_entrega_214 on public.expedicoes;
create trigger sincronizar_entrega_214 after update of status on public.expedicoes for each row execute function public.sincronizar_entrega_214();
revoke all on function public.sincronizar_entrega_214() from public,anon,authenticated;

-- Recusas geram rascunho: a gestão confere o retorno físico antes de repor estoque/gerar crédito.
-- Mantém os papéis financeiros existentes, sem permitir que expedição faça créditos sozinha.
create or replace function public.permitir_rascunho_recusa_214()
returns trigger language plpgsql set search_path=public as $$
begin
 if tg_op='INSERT' then
  if tg_table_name='devolucoes' then
   if new.status='rascunho' and new.created_by=auth.uid() and public.can_ship(auth.uid()) and public.pode_rotina('entrega_parcial_operar') then return new; end if;
  elsif tg_table_name='devolucao_itens' then
   if public.can_ship(auth.uid()) and public.pode_rotina('entrega_parcial_operar') and exists(select 1 from public.devolucoes d where d.id=new.devolucao_id and d.status='rascunho' and d.created_by=auth.uid() and d.motivo like 'Recusa na entrega:%') then return new; end if;
  end if;
 end if;
 -- O total do rascunho é recalculado pelo trigger dos itens inseridos pelo RPC.
 -- Isso não libera alteração de status, cliente, centro, motivo ou quantidade.
 if tg_op='UPDATE' and tg_table_name='devolucoes' then
  if pg_trigger_depth()>1 and old.status='rascunho' and new.status='rascunho' and old.created_by=auth.uid()
   and old.motivo like 'Recusa na entrega:%' and public.can_ship(auth.uid()) and public.pode_rotina('entrega_parcial_operar')
   and (to_jsonb(new)-'valor_total'-'updated_at')=(to_jsonb(old)-'valor_total'-'updated_at') then return new; end if;
 end if;
 if not public.pode_rotina('devolucao_operar') then raise exception 'Devolução não liberada para seu perfil'; end if;
 return coalesce(new,old);
end $$;
-- Retorno recusado pode ser conferido quando o pedido ainda está em rota/carga.
-- A exceção exige vínculo com a entrega; demais devoluções mantêm os estados originais.
do $$ declare d text; trecho text:='if ped.status not in (''confirmado'',''faturado'',''entregue'',''parcial'',''nao_entregue'',''devolvido'') then'; begin
 select pg_get_functiondef('public.confirmar_devolucao(uuid)'::regprocedure) into d;
 if position('recusa_rota_214' in d)=0 then
  if position(trecho in d)=0 then raise exception 'Confirmação de devolução incompatível com fase214'; end if;
  d:=replace(d,trecho,'if ped.status not in (''confirmado'',''faturado'',''entregue'',''parcial'',''nao_entregue'',''devolvido'') and not (ped.status in (''em_rota'',''em_carga'') and exists(select 1 from public.entrega_itens where devolucao_id=dev.id)) then -- recusa_rota_214');
  execute d;
 end if;
end $$;
-- O RPC SECURITY DEFINER cria rascunhos; escritas diretas continuam sob RLS existente.
drop trigger if exists operacao_acesso_211 on public.devolucoes;
create trigger operacao_acesso_211 before insert or update or delete on public.devolucoes for each row execute function public.permitir_rascunho_recusa_214();
drop trigger if exists operacao_acesso_211 on public.devolucao_itens;
create trigger operacao_acesso_211 before insert or update or delete on public.devolucao_itens for each row execute function public.permitir_rascunho_recusa_214();

create or replace function public.finalizar_recusa_214()
returns trigger language plpgsql security definer set search_path=public as $$
declare e public.expedicoes; reg uuid;
begin
 if new.status='confirmada' and old.status is distinct from new.status and exists(select 1 from public.entrega_itens where devolucao_id=new.id) then
  select * into e from public.expedicoes where pedido_id=new.pedido_id and status='em_rota' for update;
  if e.id is not null and not exists(select 1 from public.pedido_itens i where i.pedido_id=new.pedido_id and i.quantidade>coalesce((select sum(t.entregue+t.recusado) from public.entrega_itens t where t.pedido_item_id=i.id),0)) and
   not exists(select 1 from public.entrega_itens t join public.entrega_registros r on r.id=t.registro_id join public.devolucoes d on d.id=t.devolucao_id where r.pedido_id=new.pedido_id and d.status is distinct from 'confirmada') then
   select id into reg from public.entrega_registros where expedicao_id=e.id and chave_operacao is not null order by created_at desc limit 1;
   update public.entrega_registros set tipo='entrega' where id=reg;
   perform public.avancar_expedicao(e.id,'entregue',current_date);
  end if;
 end if;
 return new;
end $$;
drop trigger if exists finalizar_recusa_214 on public.devolucoes;
create trigger finalizar_recusa_214 after update of status on public.devolucoes for each row execute function public.finalizar_recusa_214();
revoke all on function public.finalizar_recusa_214() from public,anon,authenticated;

create or replace function public.proteger_saldo_entrega_214()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='entregue' and old.status is distinct from new.status and exists(select 1 from public.entrega_registros r join public.entrega_itens t on t.registro_id=r.id where r.expedicao_id=new.id) then
  if exists(select 1 from public.pedido_itens i where i.pedido_id=new.pedido_id and i.quantidade>coalesce((select sum(entregue+recusado) from public.entrega_itens where pedido_item_id=i.id),0)) or exists(select 1 from public.entrega_registros r join public.entrega_itens t on t.registro_id=r.id join public.devolucoes d on d.id=t.devolucao_id where r.expedicao_id=new.id and d.status is distinct from 'confirmada') then raise exception 'Resolva saldo e devoluções da entrega parcial antes de concluir'; end if;
 end if;
 return new;
end $$;
drop trigger if exists saldo_entrega_214 on public.expedicoes;
create trigger saldo_entrega_214 before update of status on public.expedicoes for each row execute function public.proteger_saldo_entrega_214();
revoke all on function public.proteger_saldo_entrega_214() from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('entrega-comprovantes','entrega-comprovantes',false,5242880,array['image/jpeg','image/png','application/pdf']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists comprovante_ler_214 on storage.objects;
create policy comprovante_ler_214 on storage.objects for select to authenticated using(bucket_id='entrega-comprovantes' and public.pode_rotina('entrega_registrar') and exists(select 1 from public.expedicoes e where e.id::text=split_part(name,'/',1)));
drop policy if exists comprovante_enviar_214 on storage.objects;
create policy comprovante_enviar_214 on storage.objects for insert to authenticated with check(bucket_id='entrega-comprovantes' and public.pode_rotina('entrega_parcial_operar') and public.can_ship(auth.uid()) and exists(select 1 from public.expedicoes e where e.id::text=split_part(name,'/',1) and e.status='em_rota'));
revoke all on function public.registrar_parcial_214(uuid,jsonb,text,text,text,uuid) from public,anon;
grant execute on function public.registrar_parcial_214(uuid,jsonb,text,text,text,uuid) to authenticated;
revoke all on function public.permitir_rascunho_recusa_214() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
