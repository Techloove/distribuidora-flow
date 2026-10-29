-- Reabre somente por ação administrativa; não reabre cobranças nem envia comandos bancários.
begin;
alter table public.pedidos add column if not exists ciclo_reabertura_289 integer not null default 0 check(ciclo_reabertura_289>=0);
alter table public.pedidos add column if not exists reaberto_por_289 uuid references public.profiles(id);
alter table public.pedidos add column if not exists reaberto_em_289 timestamptz;
alter table public.contas_receber add column if not exists ciclo_pedido_289 integer not null default 0 check(ciclo_pedido_289>=0);
alter table public.pedido_operacoes add column if not exists ciclo_pedido_289 integer not null default 0 check(ciclo_pedido_289>=0);
create table if not exists public.pedido_reaberturas_289 (
 id uuid primary key default gen_random_uuid(), pedido_id uuid not null references public.pedidos(id),
 ciclo integer not null check(ciclo>0), chave uuid not null unique, usuario_id uuid not null references public.profiles(id),
 motivo text not null check(length(trim(motivo)) between 10 and 2000), created_at timestamptz not null default now(),
 anterior jsonb not null, unique(pedido_id,ciclo)
);
alter table public.pedido_reaberturas_289 enable row level security;
revoke all on public.pedido_reaberturas_289 from public,anon,authenticated;
grant select on public.pedido_reaberturas_289 to authenticated;
grant all on public.pedido_reaberturas_289 to service_role;
drop policy if exists reabertura_admin_289 on public.pedido_reaberturas_289;
create policy reabertura_admin_289 on public.pedido_reaberturas_289 for select to authenticated using(public.usuario_ativo() and public.has_role(auth.uid(),'admin') and exists(select 1 from public.pedidos p where p.id=pedido_id and public.usuario_pode_acessar_centro(p.centro_id)));

-- A mesma parcela pode existir em ciclos distintos, sem perder a trava de duplicidade em cada ciclo.
drop index if exists public.contas_receber_pedido_parcela_uq;
create unique index contas_receber_pedido_parcela_uq on public.contas_receber(pedido_id,ciclo_pedido_289,parcela) where pedido_id is not null and documento like 'PED-%';
alter table public.pedido_operacoes drop constraint if exists pedido_operacoes_pedido_id_tipo_key;
do $$begin
 if not exists(select 1 from pg_constraint where conrelid='public.pedido_operacoes'::regclass and conname='pedido_operacoes_ciclo_289') then
  alter table public.pedido_operacoes add constraint pedido_operacoes_ciclo_289 unique(pedido_id,tipo,ciclo_pedido_289);
 end if;
end $$;
create or replace function public.vincular_ciclo_pedido_289() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if tg_op='INSERT' then
  new.ciclo_pedido_289:=coalesce((select p.ciclo_reabertura_289 from public.pedidos p where p.id=new.pedido_id),0);
 elsif new.ciclo_pedido_289 is distinct from old.ciclo_pedido_289 then raise exception 'O ciclo financeiro é imutável';end if;
 return new;
end $$;
revoke all on function public.vincular_ciclo_pedido_289() from public,anon,authenticated,service_role;
drop trigger if exists ciclo_pedido_289 on public.contas_receber;
create trigger ciclo_pedido_289 before insert or update of ciclo_pedido_289 on public.contas_receber for each row execute function public.vincular_ciclo_pedido_289();
drop trigger if exists ciclo_pedido_289 on public.pedido_operacoes;
create trigger ciclo_pedido_289 before insert or update of ciclo_pedido_289 on public.pedido_operacoes for each row execute function public.vincular_ciclo_pedido_289();
do $$declare assinatura text;d text;begin
 foreach assinatura in array array['public.cancelar_pedido_admin_285(uuid,text)','public.cancelar_pedido_representante_286(uuid,text)'] loop
  select pg_get_functiondef(assinatura::regprocedure) into d;
  if position('on conflict(pedido_id,tipo,ciclo_pedido_289)' in d)=0 then
   if position('on conflict(pedido_id,tipo)' in d)=0 then raise exception 'Revise o controle de cancelamento antes da fase289';end if;
   execute replace(d,'on conflict(pedido_id,tipo)','on conflict(pedido_id,tipo,ciclo_pedido_289)');
  end if;
 end loop;
end $$;

create or replace function public.contexto_reabertura_289(_pedido uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce(public.usuario_ativo() and public.has_role(auth.uid(),'admin') and current_setting('app.reabertura_pedido_289',true)=_pedido::text,false)
$$;
revoke all on function public.contexto_reabertura_289(uuid) from public,anon,authenticated,service_role;
-- Preserva a proteção de pedidos encerrados: a única exceção é esta operação atômica.
do $$declare d text;alvo text:='old.status in(''cancelado'',''devolvido'') and new.status is distinct from old.status';begin
 select pg_get_functiondef('public.proteger_ajustes_pedido_285()'::regprocedure) into d;
 if position('contexto_reabertura_289' in d)=0 then
  if position(alvo in d)=0 then raise exception 'Proteção de pedidos encerrados incompatível com a fase289';end if;
  execute replace(d,alvo,alvo||' and not (old.status=''cancelado'' and new.status=''rascunho'' and public.contexto_reabertura_289(old.id))');
 end if;
end $$;
create or replace function public.proteger_reabertura_289() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if (new.ciclo_reabertura_289 is distinct from old.ciclo_reabertura_289 or new.reaberto_por_289 is distinct from old.reaberto_por_289 or new.reaberto_em_289 is distinct from old.reaberto_em_289) and not public.contexto_reabertura_289(old.id) then raise exception 'Use Voltar para digitação como administrador';end if;
 if new.ciclo_reabertura_289>0 and new.forma_pagamento_id is distinct from old.forma_pagamento_id and (not public.usuario_ativo() or not public.has_role(auth.uid(),'admin')) then raise exception 'Somente administrador altera a forma de pagamento de um pedido reaberto';end if;
 return new;
end $$;
revoke all on function public.proteger_reabertura_289() from public,anon,authenticated,service_role;
drop trigger if exists zz_reabertura_289 on public.pedidos;
create trigger zz_reabertura_289 before update on public.pedidos for each row execute function public.proteger_reabertura_289();

create or replace function public.validar_reabertura_289(_pedido uuid) returns void
language plpgsql security definer set search_path=public as $$declare p public.pedidos; snapshot_fiscal boolean:=false;begin
 perform public.exigir_admin_pedido_285(_pedido,'Consulta administrativa de reabertura');
 select * into p from public.pedidos where id=_pedido;
 if p.status not in('aguardando_aprovacao','aprovado','recusado','confirmado','separacao','separado','conferido','faturado','nf_emitida','em_carga','cancelado') then raise exception 'Pedido não está disponível para voltar à digitação';end if;
 if exists(select 1 from public.boletos b where (b.pedido_id=_pedido or b.conta_receber_id in(select id from public.contas_receber where pedido_id=_pedido)) and coalesce(b.status,'') not in('baixado','cancelado')) then raise exception 'Cancele os boletos emitidos e aguarde a confirmação da baixa bancária antes de voltar à digitação. Boletos liquidados não permitem reabertura';end if;
 if exists(select 1 from public.contas_receber where pedido_id=_pedido and (coalesce(valor_pago,0)>0 or status='pago')) then raise exception 'Pedido com recebimentos não pode voltar à digitação';end if;
 if exists(select 1 from public.movimentos_financeiros m join public.contas_receber c on c.id=m.conta_receber_id where c.pedido_id=_pedido and m.status<>'estornado') or exists(select 1 from public.renegociacao_origens r join public.contas_receber c on c.id=r.titulo_id where c.pedido_id=_pedido) or exists(select 1 from public.contas_receber where pedido_id=_pedido and acordo_id is not null) then raise exception 'Resolva a movimentação ou renegociação financeira antes de reabrir';end if;
 if exists(select 1 from public.expedicoes where pedido_id=_pedido and (data_saida is not null or status in('em_rota','entregue'))) or exists(select 1 from public.cargas c join public.carga_pedidos cp on cp.carga_id=c.id where cp.pedido_id=_pedido and c.status not in('aberta','em_preparacao')) then raise exception 'Pedido que saiu para entrega exige devolução e não pode voltar à digitação';end if;
 if exists(select 1 from public.devolucoes where pedido_id=_pedido and status='confirmada') then raise exception 'Pedido com devolução confirmada exige acerto específico';end if;
 if to_regclass('public.faznotas_emissoes_259') is not null then execute 'select exists(select 1 from public.faznotas_emissoes_259 where pedido_id=$1)' into snapshot_fiscal using _pedido;end if;
 if exists(select 1 from public.notas_saida where pedido_id=_pedido and status in('autorizada','emitida')) or snapshot_fiscal then raise exception 'Pedido com documento fiscal exige tratamento fiscal antes da reabertura';end if;
 if exists(select 1 from public.comissoes where pedido_id=_pedido and status='paga') or exists(select 1 from public.comissao_parcelas cp join public.comissoes c on c.id=cp.comissao_id join public.contas_pagar t on t.id=cp.conta_pagar_id where c.pedido_id=_pedido and t.status<>'cancelado') then raise exception 'Pedido com comissão paga ou agendada exige acerto específico';end if;
end $$;
revoke all on function public.validar_reabertura_289(uuid) from public,anon,authenticated,service_role;
create or replace function public.previa_reabertura_pedido_289(_pedido uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$begin
 perform public.validar_reabertura_289(_pedido);
 return jsonb_build_object('status',(select status from public.pedidos where id=_pedido),'titulos_anteriores',(select count(*) from public.contas_receber where pedido_id=_pedido),'boletos_encerrados',(select count(*) from public.boletos where pedido_id=_pedido));
end $$;
revoke all on function public.previa_reabertura_pedido_289(uuid) from public,anon,service_role;
grant execute on function public.previa_reabertura_pedido_289(uuid) to authenticated;

create or replace function public.reabrir_pedido_digitacao_289(_pedido uuid,_motivo text,_chave uuid,_status_esperado text) returns void
language plpgsql security definer set search_path=public as $$
declare p public.pedidos; historico public.pedido_reaberturas_289; anterior jsonb;begin
 perform public.exigir_admin_pedido_285(_pedido,_motivo);
 if _chave is null then raise exception 'Identificador da operação obrigatório';end if;
 select * into p from public.pedidos where id=_pedido for update;
 select * into historico from public.pedido_reaberturas_289 where chave=_chave;
 if found then
  if historico.pedido_id<>_pedido or historico.usuario_id<>auth.uid() then raise exception 'Identificador já utilizado';end if;
  return;
 end if;
 if p.status is distinct from _status_esperado then raise exception 'O pedido mudou de situação. Atualize antes de continuar';end if;
 perform 1 from public.expedicoes where pedido_id=_pedido order by id for update;
 perform 1 from public.cargas where id in(select carga_id from public.carga_pedidos where pedido_id=_pedido) order by id for update;
 perform 1 from public.contas_receber where pedido_id=_pedido order by id for update;
 perform 1 from public.boletos where pedido_id=_pedido or conta_receber_id in(select id from public.contas_receber where pedido_id=_pedido) order by id for update;
 perform public.validar_reabertura_289(_pedido);
 anterior:=jsonb_build_object('pedido',to_jsonb(p),'separacao',(select jsonb_agg(to_jsonb(s)) from public.pedido_separacoes s where pedido_id=_pedido),'itens',(select jsonb_agg(to_jsonb(i)) from public.pedido_itens i where pedido_id=_pedido));
 -- Conserva os títulos antigos como cancelados, inclusive os que não têm boleto.
 perform public.ajustar_titulos_pedido_285(_pedido,null,null,_motivo,false);
 if p.status<>'cancelado' then perform public.cancelar_pedido_admin_285(_pedido,_motivo);end if;
 if exists(select 1 from public.estoque_movimentos where documento_id=_pedido group by produto_id,centro_id having abs(sum(case when tipo='saida' and origem='pedido' then quantidade when tipo='entrada' and origem='pedido_cancelado' then -quantidade else 0 end))>0.0001) then raise exception 'O estoque do cancelamento anterior precisa ser regularizado antes de reabrir';end if;
 if exists(select 1 from public.expedicoes where pedido_id=_pedido and status<>'cancelada') or exists(select 1 from public.carga_pedidos where pedido_id=_pedido) or exists(select 1 from public.estoque_reservas where pedido_id=_pedido) then raise exception 'Há vínculo logístico ou reserva pendente do cancelamento anterior';end if;
 insert into public.pedido_reaberturas_289(pedido_id,ciclo,chave,usuario_id,motivo,anterior) values(_pedido,p.ciclo_reabertura_289+1,_chave,auth.uid(),trim(_motivo),anterior);
 perform set_config('app.reabertura_pedido_289',_pedido::text,true);
 update public.pedidos set status='rascunho',ciclo_reabertura_289=p.ciclo_reabertura_289+1,reaberto_por_289=auth.uid(),reaberto_em_289=now(),cancelamento_motivo_285=null,cancelamento_por_285=null,cancelamento_em_285=null,faturado_em=null where id=_pedido;
 update public.pedido_itens set quantidade_separada=null,conferido=false,divergencia_acao=null,divergencia_obs=null where pedido_id=_pedido;
 update public.pedido_separacoes set status='cancelada' where pedido_id=_pedido;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',_pedido,'reabrir_digitacao_289',auth.uid(),jsonb_build_object('motivo',trim(_motivo),'status_anterior',p.status,'ciclo',p.ciclo_reabertura_289+1,'titulos_anteriores_preservados',true));
 perform set_config('app.reabertura_pedido_289','',true);
end $$;
revoke all on function public.reabrir_pedido_digitacao_289(uuid,text,uuid,text) from public,anon,service_role;
grant execute on function public.reabrir_pedido_digitacao_289(uuid,text,uuid,text) to authenticated;

create or replace function public.reiniciar_separacao_ciclo_289() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if new.ciclo_reabertura_289>0 and new.status='confirmado' and old.status in('rascunho','digitacao','aprovado') then
  update public.pedido_separacoes set status='em_separacao',separador_id=null,conferente_id=null,iniciada_em=now(),separada_em=null,conferida_em=null where pedido_id=new.id;
 end if;
 return new;
end $$;
revoke all on function public.reiniciar_separacao_ciclo_289() from public,anon,authenticated,service_role;
drop trigger if exists zz_reiniciar_separacao_289 on public.pedidos;
create trigger zz_reiniciar_separacao_289 after update of status on public.pedidos for each row execute function public.reiniciar_separacao_ciclo_289();
notify pgrst,'reload schema';
commit;
