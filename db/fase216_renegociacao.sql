-- Fase216: acordo gera novas parcelas, preservando baixas e origem.
begin;
create table if not exists public.renegociacoes (
 id uuid primary key default gen_random_uuid(),cliente_id uuid not null references public.clientes(id),centro_id uuid not null references public.centros(id),
 motivo text not null,valor_original numeric(14,2) not null,valor_acordo numeric(14,2) not null,
 dados jsonb not null, chave uuid not null unique,created_by uuid not null default auth.uid(),created_at timestamptz not null default now()
);
create table if not exists public.renegociacao_origens (
 acordo_id uuid not null references public.renegociacoes(id),titulo_id uuid not null references public.contas_receber(id),
 saldo_original numeric(14,2) not null,primary key(acordo_id,titulo_id),unique(titulo_id)
);
alter table public.contas_receber add column if not exists acordo_id uuid references public.renegociacoes(id);
create index if not exists titulo_acordo_216 on public.contas_receber(acordo_id) where acordo_id is not null;
insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values('receber_renegociar','Renegociar títulos e gerar parcelas de acordo','Cobrança',125,'/receber') on conflict do nothing;
do $$ begin
 if not exists(select 1 from public.auditoria where tabela='fase216' and acao='instalada') then
  insert into public.role_permissoes(role,permissao) select codigo,'receber_renegociar' from public.papeis where codigo='financeiro' on conflict do nothing;
  insert into public.auditoria(tabela,acao,detalhe) values('fase216','instalada','{}');
 end if;
end $$;
alter table public.renegociacoes enable row level security;
alter table public.renegociacao_origens enable row level security;
revoke all on public.renegociacoes,public.renegociacao_origens from public,anon,authenticated;
grant select on public.renegociacoes,public.renegociacao_origens to authenticated;
drop policy if exists acordo_leitura_216 on public.renegociacoes;
create policy acordo_leitura_216 on public.renegociacoes for select to authenticated using(public.usuario_ativo() and public.usuario_pode_acessar_centro(centro_id) and (not public.escopo_representante() or public.cliente_na_minha_carteira(cliente_id)));
drop policy if exists acordo_origem_leitura_216 on public.renegociacao_origens;
create policy acordo_origem_leitura_216 on public.renegociacao_origens for select to authenticated using(exists(select 1 from public.renegociacoes where id=acordo_id));
create or replace function public.renegociar_titulo_216(_titulo uuid,_parcelas int,_primeiro date,_intervalo int,_acrescimo numeric,_desconto numeric,_motivo text,_chave uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare t public.contas_receber; saldo numeric; total numeric; valor numeric; restante numeric; acordo uuid; n int; payload jsonb;
begin
 if not public.pode_rotina('receber_renegociar') or not public.can_finance(auth.uid()) then raise exception 'Sem permissão para renegociar'; end if;
 select * into t from public.contas_receber where id=_titulo for update;
 if t.id is null or not public.usuario_pode_acessar_centro(t.centro_id) or (public.escopo_representante() and not public.cliente_na_minha_carteira(t.cliente_id)) then raise exception 'Título sem acesso'; end if;
 if _chave is null or _parcelas is null or _parcelas not between 1 and 24 or _primeiro is null or _primeiro<current_date or _intervalo is null or _intervalo not between 1 and 90 or _acrescimo is null or _desconto is null or _acrescimo<0 or _desconto<0 or _acrescimo::text in ('NaN','Infinity','-Infinity') or _desconto::text in ('NaN','Infinity','-Infinity') or nullif(trim(_motivo),'') is null or length(_motivo)>2000 then raise exception 'Dados do acordo inválidos'; end if;
 payload:=jsonb_build_object('titulo',_titulo,'parcelas',_parcelas,'primeiro',_primeiro,'intervalo',_intervalo,'acrescimo',_acrescimo,'desconto',_desconto,'motivo',trim(_motivo));
 select id into acordo from public.renegociacoes where chave=_chave;
 if acordo is not null then
  if not exists(select 1 from public.renegociacoes where id=acordo and dados=payload) then raise exception 'Chave já usada com condições diferentes'; end if;
  if not exists(select 1 from public.renegociacao_origens where acordo_id=acordo and titulo_id=t.id) then raise exception 'Chave pertence a outro acordo'; end if;
  return acordo;
 end if;
 if t.status in ('pago','cancelado') or exists(select 1 from public.renegociacao_origens where titulo_id=t.id) then raise exception 'Título já encerrado ou renegociado'; end if;
 if exists(select 1 from public.boletos where conta_receber_id=t.id and coalesce(status,'') not in ('cancelado','baixado','liquidado','pago')) then raise exception 'Confirme a baixa/cancelamento do boleto no banco antes de renegociar'; end if;
 saldo:=round(t.valor+coalesce(t.juros,0)+coalesce(t.multa,0)+coalesce(t.acrescimo,0)-coalesce(t.desconto,0)-coalesce(t.valor_pago,0),2);
 total:=saldo+_acrescimo-_desconto;
 if saldo<=0 or total<=0 or total<_parcelas*0.01 then raise exception 'Saldo ou valor de acordo inválido'; end if;
 insert into public.renegociacoes(cliente_id,centro_id,motivo,valor_original,valor_acordo,dados,chave) values(t.cliente_id,t.centro_id,trim(_motivo),saldo,total,payload,_chave) returning id into acordo;
 insert into public.renegociacao_origens(acordo_id,titulo_id,saldo_original) values(acordo,t.id,saldo);
 update public.contas_receber set status='cancelado' where id=t.id;
 restante:=total;
 for n in 1.._parcelas loop
  valor:=case when n=_parcelas then restante else round(total/_parcelas,2) end;
  insert into public.contas_receber(cliente_id,pedido_id,centro_id,documento,parcela,data_emissao,vencimento,valor,status,acordo_id,descricao)
  values(t.cliente_id,t.pedido_id,t.centro_id,'AC-'||left(acordo::text,8),n,current_date,_primeiro+(n-1)*_intervalo,valor,'aberto',acordo,'Acordo: '||trim(_motivo));
  restante:=restante-valor;
 end loop;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('contas_receber',t.id,'renegociar',auth.uid(),jsonb_build_object('acordo',acordo,'saldo',saldo,'valor_pago_preservado',t.valor_pago,'novo_total',total,'parcelas',_parcelas));
 return acordo;
end $$;
-- Baixas anteriores de títulos renegociados contam na quitação do pedido.
do $$ declare d text; begin
 select pg_get_functiondef('public.apurar_comissao_pedido(uuid)'::regprocedure) into d;
 if position('renegociacao_origens' in d)=0 then
  d:=replace(d,'t.status<>''cancelado''','(t.status<>''cancelado'' or exists(select 1 from public.renegociacao_origens ro where ro.titulo_id=t.id))');execute d;
 end if;
 select pg_get_functiondef('public.regra_comissao_209()'::regprocedure) into d;
 if position('renegociacao_origens' in d)=0 then
  d:=replace(d,'t.status<>''cancelado''','(t.status<>''cancelado'' or exists(select 1 from public.renegociacao_origens ro where ro.titulo_id=t.id))');execute d;
 end if;
end $$;
revoke all on function public.renegociar_titulo_216(uuid,int,date,int,numeric,numeric,text,uuid) from public,anon;
grant execute on function public.renegociar_titulo_216(uuid,int,date,int,numeric,numeric,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
