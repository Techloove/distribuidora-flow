-- Execute inteiro após a fase240. Aceite com validação no servidor, sem ampliar aprovação manual.
begin;
do $$ begin
 if to_regprocedure('public.criar_orcamento_base_240(uuid,uuid,uuid,uuid,date,text,uuid,date)') is null or to_regprocedure('public.validar_pedido(uuid)') is null or to_regprocedure('public.reservar_pedido_212()') is null then
  raise exception 'Aplique a fase240 e os motores de validação/reserva antes da fase241';end if;
end $$;
alter table public.pedidos add column if not exists aprovacao_automatica_em timestamptz;
alter table public.pedidos add column if not exists aprovacao_automatica_motivos jsonb not null default '[]'::jsonb;

-- Contexto privado e transitório, não baseado em variáveis de sessão fornecidas pelo cliente.
create table if not exists public.orcamento_contexto_aprovacao_241(
 pedido_id uuid primary key references public.pedidos(id) on delete cascade,usuario_id uuid not null,transacao bigint not null
);
alter table public.orcamento_contexto_aprovacao_241 enable row level security;
revoke all on public.orcamento_contexto_aprovacao_241 from public,anon,authenticated;
grant all on public.orcamento_contexto_aprovacao_241 to service_role;
create or replace function public.contexto_aprovacao_orcamento_241(_pedido uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select public.usuario_ativo() and public.can_operate(auth.uid()) and public.pode_rotina('pedidos_orcamentos') and exists(
  select 1 from public.orcamento_contexto_aprovacao_241 a join public.pedidos p on p.id=a.pedido_id
  where a.pedido_id=_pedido and a.usuario_id=auth.uid() and a.transacao=txid_current()
   and p.tipo_documento='pedido' and p.orcamento_situacao='aceito' and p.orcamento_aceito_em is not null
   and p.status in ('aguardando_aprovacao','aprovado') and public.usuario_pode_acessar_centro(p.centro_id)
   and (not public.escopo_representante() or public.documento_na_minha_carteira('pedidos',p.id))
 );
$$;
revoke all on function public.contexto_aprovacao_orcamento_241(uuid) from public,anon,authenticated;
-- A reserva conserva o motor instalado (incluindo estoque compartilhado), permitindo
-- apenas a exceção comprovada de aceite automático. A RPC manual avançar não muda.
do $$ declare s text;begin
 select pg_get_functiondef('public.reservar_pedido_212()'::regprocedure) into s;
 if position('contexto_aprovacao_orcamento_241' in s)=0 then
  if position('not public.can_manage(auth.uid())' in s)=0 then raise exception 'Reserva incompatível com a fase241';end if;
  s:=replace(s,'not public.can_manage(auth.uid())','(not public.can_manage(auth.uid()) and not public.contexto_aprovacao_orcamento_241(new.id))');execute s;
 end if;
end $$;

-- Preserva o fluxo de aceite/recusa original numa função inacessível como RPC.
do $$ declare s text;begin
 if to_regprocedure('public.decidir_orcamento_base_241(uuid,text,text)') is null then
  select pg_get_functiondef('public.decidir_orcamento_236(uuid,text,text)'::regprocedure) into s;
  if position('decidir_orcamento_base_241' in s)>0 or position('FUNCTION public.decidir_orcamento_236(' in s)=0 then raise exception 'Motor de aceite incompatível com a fase241';end if;
  execute replace(s,'FUNCTION public.decidir_orcamento_236(','FUNCTION public.decidir_orcamento_base_241(');
 end if;
end $$;
revoke all on function public.decidir_orcamento_base_241(uuid,text,text) from public,anon,authenticated;

create or replace function public.decidir_orcamento_236(_pedido uuid,_acao text,_motivo text default null)
returns public.pedidos language plpgsql security definer set search_path=public as $$
declare p public.pedidos;antes public.pedidos;validacoes jsonb;bloqueios jsonb;
begin
 if not public.orcamento_acessivel_236(_pedido) then raise exception 'Orçamento sem acesso';end if;
 select * into antes from public.pedidos where id=_pedido for update;
 -- Serializa decisões para o mesmo cliente e impede troca de carteira durante a análise.
 perform 1 from public.clientes where id=antes.cliente_id for update;
 p:=public.decidir_orcamento_base_241(_pedido,_acao,_motivo);
 -- Repetir aceite retorna a decisão original, sem tentar aprovar novamente nem duplicar reservas.
 if _acao<>'aceitar' or antes.tipo_documento<>'orcamento' then return p;end if;
 validacoes:=public.validar_pedido(_pedido);
 if validacoes is null or jsonb_typeof(validacoes)<>'array' then raise exception 'Não foi possível validar o pedido para aprovação automática';end if;
 select coalesce(jsonb_agg(v),'[]'::jsonb) into bloqueios from jsonb_array_elements(validacoes) v where v->>'nivel'='bloqueio';
 if jsonb_array_length(bloqueios)=0 then
  begin
   insert into public.orcamento_contexto_aprovacao_241(pedido_id,usuario_id,transacao) values(_pedido,auth.uid(),txid_current());
   update public.pedidos set status='aprovado',aprovacao_automatica_em=clock_timestamp(),aprovacao_automatica_motivos='[]'::jsonb where id=_pedido returning * into p;
   delete from public.orcamento_contexto_aprovacao_241 where pedido_id=_pedido;
   insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',_pedido,'aprovar_orcamento_automaticamente_241',auth.uid(),jsonb_build_object('origem','aceite_orcamento','validacoes',validacoes));
  exception when sqlstate 'P0001' then
   -- A insuficiência é verificada com bloqueio físico pelo motor de reserva.
   -- Somente essa condição operacional fica pendente; erros inesperados abortam.
   if sqlerrm not like 'Estoque disponível insuficiente para reservar produto%' then raise;end if;
   bloqueios:=jsonb_build_array(jsonb_build_object('nivel','bloqueio','mensagem','Estoque disponível insuficiente para reservar os itens. A gestão deve revisar a disponibilidade.'));
  end;
 end if;
 if jsonb_array_length(bloqueios)>0 then
  update public.pedidos set aprovacao_automatica_em=null,aprovacao_automatica_motivos=bloqueios where id=_pedido returning * into p;
  insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',_pedido,'orcamento_requer_aprovacao_241',auth.uid(),jsonb_build_object('bloqueios',bloqueios));
 end if;
 return p;
end $$;
revoke all on function public.decidir_orcamento_236(uuid,text,text) from public,anon;
grant execute on function public.decidir_orcamento_236(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
