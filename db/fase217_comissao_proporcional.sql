-- Fase217: agendamento proporcional ao recebimento, com títulos a pagar rastreáveis.
begin;
create table if not exists public.comissao_parcelas (
 id uuid primary key default gen_random_uuid(),comissao_id uuid not null references public.comissoes(id),
 conta_pagar_id uuid not null references public.contas_pagar(id),valor numeric(14,2) not null check(valor>0),
 chave uuid not null unique,created_by uuid not null default auth.uid(),created_at timestamptz not null default now()
);
create index if not exists comissao_parcela_comissao_217 on public.comissao_parcelas(comissao_id);
alter table public.comissao_parcelas enable row level security;
revoke all on public.comissao_parcelas from public,anon,authenticated;
grant select on public.comissao_parcelas to authenticated;
drop policy if exists comissao_parcela_leitura_217 on public.comissao_parcelas;
create policy comissao_parcela_leitura_217 on public.comissao_parcelas for select to authenticated using(exists(select 1 from public.comissoes c where c.id=comissao_id));
insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values('comissao_proporcional_operar','Agendar e estornar comissão proporcional ao recebimento','Comissões',126,'/comissoes') on conflict do nothing;
do $$ begin
 if not exists(select 1 from public.auditoria where tabela='fase217' and acao='instalada') then
  insert into public.role_permissoes(role,permissao) select codigo,'comissao_proporcional_operar' from public.papeis where codigo='financeiro' on conflict do nothing;
  insert into public.auditoria(tabela,acao,detalhe) values('fase217','instalada','{}');
 end if;
end $$;
create or replace function public.comissao_disponivel_217(_comissao uuid)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare c public.comissoes; p public.pedidos; recebido numeric; comprometido numeric;
begin
 select * into c from public.comissoes where id=_comissao;
 select * into p from public.pedidos where id=c.pedido_id;
 if not public.pode_rotina('comissao_ajustes_ver') or not public.usuario_pode_acessar_centro(p.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',p.id)) then return 0; end if;
 if c.status in ('paga','cancelada') or p.status not in ('faturado','em_carga','em_rota','entregue','parcial','nao_entregue','devolvido') or p.total_liquido<=0 then return 0; end if;
 select coalesce(sum(least(t.valor,coalesce(t.valor_pago,0))),0) into recebido from public.contas_receber t where t.pedido_id=p.id and (t.status<>'cancelado' or exists(select 1 from public.renegociacao_origens where titulo_id=t.id));
 recebido:=recebido+coalesce((select sum(valor) from public.creditos_clientes_aplicacoes where pedido_id=p.id and status='aplicado'),0);
 select coalesce(sum(cp.valor),0) into comprometido from public.comissao_parcelas cp join public.contas_pagar t on t.id=cp.conta_pagar_id where cp.comissao_id=c.id and t.status<>'cancelado';
 return greatest(round(c.valor*least(recebido/p.total_liquido,1),2)-comprometido,0);
end $$;
create or replace view public.vw_comissao_proporcional_217 with(security_invoker=on) as
select c.id,c.pedido_id,c.representante_id,c.centro_id,c.valor,c.status,p.numero pedido_numero,
 public.comissao_disponivel_217(c.id) disponivel,
 coalesce((select sum(cp.valor) from public.comissao_parcelas cp join public.contas_pagar t on t.id=cp.conta_pagar_id where cp.comissao_id=c.id and t.status<>'cancelado'),0) agendado
from public.comissoes c join public.pedidos p on p.id=c.pedido_id
where public.pode_rotina('comissao_ajustes_ver');
grant select on public.vw_comissao_proporcional_217 to authenticated;
create or replace function public.agendar_comissao_217(_comissao uuid,_valor numeric,_vencimento date,_chave uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare c public.comissoes; conta uuid; parcela uuid; limite numeric;
begin
 if not public.pode_rotina('comissao_proporcional_operar') or not public.can_finance(auth.uid()) then raise exception 'Sem acesso à comissão proporcional'; end if;
 select * into c from public.comissoes where id=_comissao for update;
 if c.id is null or not public.usuario_pode_acessar_centro(c.centro_id) or (public.escopo_representante() and c.representante_id is distinct from public.meu_representante_id()) then raise exception 'Comissão sem acesso'; end if;
 if _valor is null or _valor<=0 or _valor::text in ('NaN','Infinity','-Infinity') or _vencimento is null or _chave is null then raise exception 'Valor, vencimento e chave obrigatórios'; end if;
 select cp.id into parcela from public.comissao_parcelas cp join public.contas_pagar t on t.id=cp.conta_pagar_id where cp.chave=_chave and cp.comissao_id=c.id and cp.valor=round(_valor,2) and t.vencimento=_vencimento;
 if parcela is not null then return parcela; end if;
 if exists(select 1 from public.comissao_parcelas where chave=_chave) then raise exception 'Chave já usada com dados diferentes'; end if;
 limite:=public.comissao_disponivel_217(c.id);
 if round(_valor,2)>limite then raise exception 'Valor excede comissão disponível após recebimentos (%).',limite; end if;
 insert into public.contas_pagar(centro_id,documento,parcela,valor,vencimento,data_emissao,status,descricao)
 values(c.centro_id,'CP-'||left(_chave::text,8),1,round(_valor,2),_vencimento,current_date,'aberto','Comissão proporcional do pedido '||c.pedido_id) returning id into conta;
 insert into public.comissao_parcelas(comissao_id,conta_pagar_id,valor,chave) values(c.id,conta,round(_valor,2),_chave) returning id into parcela;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('comissoes',c.id,'agendar_proporcional',auth.uid(),jsonb_build_object('conta_pagar',conta,'valor',_valor));
 return parcela;
end $$;
create or replace function public.estornar_comissao_217(_parcela uuid,_motivo text)
returns void language plpgsql security definer set search_path=public as $$
declare cp public.comissao_parcelas; c public.comissoes; t public.contas_pagar;
begin
 select * into cp from public.comissao_parcelas where id=_parcela;
 select * into c from public.comissoes where id=cp.comissao_id for update;
 if not public.pode_rotina('comissao_proporcional_operar') or not public.can_finance(auth.uid()) or not public.usuario_pode_acessar_centro(c.centro_id) or (public.escopo_representante() and c.representante_id is distinct from public.meu_representante_id()) then raise exception 'Sem acesso ao estorno'; end if;
 select * into t from public.contas_pagar where id=cp.conta_pagar_id for update;
 if t.id is null or nullif(trim(_motivo),'') is null or length(_motivo)>2000 then raise exception 'Parcela ou motivo inválido'; end if;
 if coalesce(t.valor_pago,0)>0 then raise exception 'Estorne a baixa financeira antes de cancelar o agendamento'; end if;
 update public.contas_pagar set status='cancelado' where id=t.id;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('comissao_parcelas',cp.id,'estornar',auth.uid(),jsonb_build_object('motivo',_motivo));
end $$;
-- Quem já iniciou pagamento proporcional não pode pagar novamente o valor integral.
do $$ declare d text; begin
 select pg_get_functiondef('public.pagar_comissoes(uuid,uuid[],date,uuid,uuid,uuid,text)'::regprocedure) into d;
 if position('proporcional_217' in d)=0 then
  d:=regexp_replace(d,'\mBEGIN\M',E'BEGIN\n -- proporcional_217\n if not public.usuario_ativo() or not public.can_finance(auth.uid()) then raise exception ''Sem acesso a comissões''; end if;\n perform 1 from public.comissoes where id=any(_comissao_ids) order by id for update;\n if exists(select 1 from public.comissao_parcelas cp join public.contas_pagar t on t.id=cp.conta_pagar_id where cp.comissao_id=any(_comissao_ids) and t.status<>''cancelado'') then raise exception ''Use pagamento proporcional para comissões com parcelas já agendadas''; end if;','i');execute d;
 end if;
end $$;
create or replace function public.ajuste_parcial_devolucao_217()
returns trigger language plpgsql security definer set search_path=public as $$
declare c public.comissoes; pago numeric;
begin
 if new.status in ('confirmada','cancelada') and old.status is distinct from new.status then
  select * into c from public.comissoes where pedido_id=new.pedido_id;
  select coalesce(sum(cp.valor),0) into pago from public.comissao_parcelas cp join public.contas_pagar t on t.id=cp.conta_pagar_id where cp.comissao_id=c.id and t.status<>'cancelado';
  if pago>c.valor then
   insert into public.comissao_ajustes(comissao_id,pedido_id,representante_id,centro_id,valor) values(c.id,c.pedido_id,c.representante_id,c.centro_id,pago-c.valor)
   on conflict(comissao_id) do update set valor=excluded.valor,status='pendente',resolucao=null;
  end if;
 end if;
 return new;
end $$;
drop trigger if exists z_ajuste_parcial_217 on public.devolucoes;
create trigger z_ajuste_parcial_217 after update of status on public.devolucoes for each row execute function public.ajuste_parcial_devolucao_217();
revoke all on function public.ajuste_parcial_devolucao_217() from public,anon,authenticated;
revoke all on function public.comissao_disponivel_217(uuid),public.agendar_comissao_217(uuid,numeric,date,uuid),public.estornar_comissao_217(uuid,text) from public,anon;
grant execute on function public.comissao_disponivel_217(uuid),public.agendar_comissao_217(uuid,numeric,date,uuid),public.estornar_comissao_217(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
