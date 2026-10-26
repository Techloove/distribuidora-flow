-- Regularização administrativa de pedidos antigos. Executar manualmente no Supabase.
begin;
do $$begin
 if to_regprocedure('public.acompanhar_pedido_236(uuid)') is null or to_regprocedure('public.marcar_faturamento_215()') is null or to_regprocedure('public.sync_expedicao_do_pedido()') is null or to_regprocedure('public.trg_apurar_comissao_pedido()') is null then
 raise exception 'Confira as fases215,236 e o fluxo de pedidos antes da fase269';end if;
end $$;
alter table public.pedidos add column if not exists status_regularizado_em timestamptz,
 add column if not exists status_regularizado_por uuid references public.profiles(id),
 add column if not exists status_regularizado_motivo text,
 add column if not exists status_regularizado_data date;
-- Contexto privado por transação/pedido. Não usa parâmetro de sessão manipulável.
create table if not exists public.pedido_ajuste_contexto_269(
 transacao bigint not null,pedido_id uuid not null,ator uuid not null,
 primary key(transacao,pedido_id)
);
alter table public.pedido_ajuste_contexto_269 enable row level security;
revoke all on public.pedido_ajuste_contexto_269 from public,anon,authenticated,service_role;
create or replace function public.ajuste_status_manual_ativo_269(_pedido uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.pedido_ajuste_contexto_269 where transacao=txid_current() and pedido_id=_pedido and ator=auth.uid())
$$;
revoke all on function public.ajuste_status_manual_ativo_269(uuid) from public,anon,authenticated,service_role;
-- Conserva o corpo das rotinas existentes e evita somente os efeitos desta regularização.
do $$declare assinatura text;def text;begin
 foreach assinatura in array array['public.sync_expedicao_do_pedido()','public.trg_apurar_comissao_pedido()','public.marcar_faturamento_215()'] loop
  select pg_get_functiondef(assinatura::regprocedure) into def;
  if position('ajuste_status_manual_ativo_269' in def)=0 then
   def:=regexp_replace(def,'\mBEGIN\M',E'BEGIN\n if public.ajuste_status_manual_ativo_269(new.id) then return new;end if;','i');
   if position('ajuste_status_manual_ativo_269' in def)=0 then raise exception 'Não foi possível adaptar %',assinatura;end if;
   execute def;
  end if;
 end loop;
end $$;
create or replace function public.limpar_marcador_regularizacao_269() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if new.status is distinct from old.status and not public.ajuste_status_manual_ativo_269(new.id) then
  new.status_regularizado_em:=null;new.status_regularizado_por:=null;new.status_regularizado_motivo:=null;new.status_regularizado_data:=null;
 end if;return new;
end $$;
revoke all on function public.limpar_marcador_regularizacao_269() from public,anon,authenticated,service_role;
drop trigger if exists limpar_marcador_regularizacao_269 on public.pedidos;
create trigger limpar_marcador_regularizacao_269 before update of status on public.pedidos for each row execute function public.limpar_marcador_regularizacao_269();

create or replace function public.regularizar_status_pedido_269(_pedido uuid,_status_esperado text,_novo_status text,_motivo text,_data date)
returns public.pedidos language plpgsql security definer set search_path=public as $$
declare p public.pedidos;anterior text;origem int;destino int;hoje date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if auth.uid() is null or not coalesce(public.has_role(auth.uid(),'admin'),false) or not coalesce(public.usuario_ativo(),false)
 or not exists(select 1 from public.profiles a where a.id=auth.uid() and a.ativo and not coalesce(a.precisa_completar_cadastro,false) and coalesce(to_jsonb(a)->>'cadastro_status','interno') in ('interno','aprovado')) then raise exception 'Somente administrador ativo pode regularizar pedidos';end if;
 if not coalesce(public.pode_rotina('pedidos_acompanhar'),false) then raise exception 'Acesso ao menu de pedidos não liberado';end if;
 select * into p from public.pedidos where id=_pedido for update;
 if p.id is null or p.centro_id is null or not coalesce(public.usuario_pode_acessar_centro(p.centro_id),false)
 or (public.escopo_representante() and not coalesce(public.documento_na_minha_carteira('pedidos',p.id),false)) then raise exception 'Pedido não encontrado ou sem acesso à loja/carteira';end if;
 if coalesce(to_jsonb(p)->>'tipo_documento','pedido')<>'pedido' then raise exception 'Orçamento não pode ser regularizado como pedido';end if;
 if p.status is distinct from _status_esperado then raise exception 'O status mudou. Atualize o pedido antes de regularizar';end if;
 origem:=array_position(array['separacao','separado','conferido','faturado','nf_emitida','em_carga','em_rota','entregue'],p.status);
 destino:=array_position(array['separacao','separado','conferido','faturado','nf_emitida','em_carga','em_rota','entregue'],_novo_status);
 if origem is null or destino is null or destino<=origem or _novo_status='nf_emitida' then raise exception 'Escolha uma etapa posterior à separação. Nota fiscal não pode ser marcada manualmente';end if;
 if _motivo is null or length(btrim(_motivo)) not between 10 and 1000 then raise exception 'Informe o motivo da regularização com 10 a 1000 caracteres';end if;
 if _data is null or _data>hoje or _data<p.data_pedido then raise exception 'Data da ocorrência deve estar entre a data do pedido e hoje';end if;
 -- Pendências reais de recusa/entrega parcial exigem o tratamento operacional existente.
 if exists(select 1 from public.entrega_itens it join public.pedido_itens i on i.id=it.pedido_item_id where i.pedido_id=p.id) then raise exception 'Pedido com entrega parcial ou recusa. Resolva pelo fluxo de entregas';end if;
 anterior:=p.status;
 insert into public.pedido_ajuste_contexto_269 values(txid_current(),p.id,auth.uid());
 update public.pedidos set status=_novo_status,status_regularizado_em=now(),status_regularizado_por=auth.uid(),status_regularizado_motivo=btrim(_motivo),status_regularizado_data=_data,
 data_entrega=case when _novo_status='entregue' then _data else data_entrega end where id=p.id returning * into p;
 -- O gatilho padrão mantém a linha do tempo. Acrescenta o motivo sem inventar etapas intermediárias.
 update public.pedido_status_historico set observacao='Regularização administrativa: '||btrim(_motivo)||' | Ocorrência: '||_data::text
 where pedido_id=p.id and status_anterior=anterior and status_novo=_novo_status and user_id=auth.uid() and created_at=now();
 insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id) values('pedidos',p.id,'regularizacao_status_manual',jsonb_build_object('de',anterior,'para',_novo_status,'motivo',btrim(_motivo),'data_ocorrencia',_data,'sem_efeitos_operacionais',true),auth.uid());
 delete from public.pedido_ajuste_contexto_269 where transacao=txid_current() and pedido_id=p.id;
 return p;
end $$;
revoke all on function public.regularizar_status_pedido_269(uuid,text,text,text,date) from public,anon,service_role;
grant execute on function public.regularizar_status_pedido_269(uuid,text,text,text,date) to authenticated;
-- Reaproveita integralmente a autorização do acompanhamento existente.
create or replace function public.acompanhar_pedido_269(_pedido uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$declare r jsonb;p public.pedidos;begin
 r:=public.acompanhar_pedido_236(_pedido);
 select * into p from public.pedidos where id=_pedido;
 return r||jsonb_build_object('status_regularizado_em',p.status_regularizado_em,'status_regularizado_data',p.status_regularizado_data);
end $$;
revoke all on function public.acompanhar_pedido_269(uuid) from public,anon,service_role;
grant execute on function public.acompanhar_pedido_269(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
