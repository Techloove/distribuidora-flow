-- Serviços avulsos da plataforma. Não cadastra cobranças reais na instalação.
begin;
create table if not exists public.saas_servicos_331(
 id uuid primary key,descricao text not null check(length(btrim(descricao)) between 2 and 160),
 valor numeric(14,2) not null check(valor>0),vencimento date not null,observacao text not null default '' check(length(observacao)<=1000),
 revisao integer not null default 1,autor uuid not null references public.profiles(id),criado_em timestamptz not null default now(),atualizado_em timestamptz not null default now()
);
alter table public.saas_servicos_331 enable row level security;
revoke all on public.saas_servicos_331 from public,anon,authenticated;
drop trigger if exists proteger_saas_330 on public.saas_servicos_331;
create trigger proteger_saas_330 before truncate on public.saas_servicos_331 for each statement execute function public.saas_proteger_historico_330();
create or replace function public.saas_parcelas_330() returns table(
 chave text,tipo text,competencia date,parcela integer,vencimento date,valor numeric,estado text,pagamento_data date
) language sql stable security definer set search_path=public as $$
 with c as (select * from public.saas_contrato_330), meses as (
  select m::date mes from c cross join lateral generate_series(date_trunc('month',c.mensal_inicio)::date,
  (date_trunc('month',(now() at time zone 'America/Sao_Paulo')::date)+interval '1 month')::date,interval '1 month') m where c.mensal_inicio is not null
 ), mensal as (
  select 'mensal:'||to_char(m.mes,'YYYY-MM') chave,'mensalidade'::text tipo,m.mes competencia,1 parcela,
   greatest((m.mes+least(t.dia,extract(day from m.mes+interval '1 month - 1 day')::integer)-1)::date,c.mensal_inicio) vencimento,t.valor
  from meses m cross join lateral(select * from public.saas_termos_330 t where t.vigencia<=m.mes order by t.vigencia desc limit 1)t
  cross join c where t.valor>0
 ), base as (
  select * from mensal union all select s.chave,'implantacao',date_trunc('month',s.vencimento)::date,s.parcela,s.vencimento,s.valor from public.saas_setup_330 s
  union all select 'servico:'||s.id::text,'servico',date_trunc('month',s.vencimento)::date,1,s.vencimento,s.valor from public.saas_servicos_331 s
 )
 select b.*,case when e.acao='pago' then 'pago' when e.acao='cancelado' then 'cancelado'
  when b.vencimento<(now() at time zone 'America/Sao_Paulo')::date then 'vencido' else 'pendente' end estado,e.pagamento_data
 from base b left join lateral(select * from public.saas_eventos_330 e where e.chave=b.chave and e.acao in('pago','reaberto','cancelado') order by e.id desc limit 1)e on true;
$$;

-- Acrescenta a lista ao painel, conservando as autorizações da fase330.
do $$ declare d text;novo text;begin
 select pg_get_functiondef('public.saas_painel_330()'::regprocedure) into d;
 if position('saas_servicos_331' in d)=0 then
  novo:=replace(d,$alvo$'historico',$alvo$, $trecho$'servicos',(select coalesce(jsonb_agg(to_jsonb(servico_lista) order by servico_lista.vencimento,servico_lista.descricao),'[]') from (
   select x.id,x.descricao,x.valor,x.vencimento,x.observacao,x.revisao,
   not exists(select 1 from public.saas_eventos_330 e where e.chave='servico:'||x.id::text) editavel
   from public.saas_servicos_331 x)servico_lista),'historico',$trecho$);
  if novo=d then raise exception 'Painel incompatível com serviços adicionais';end if;
  execute novo;
 end if;
end $$;
create or replace function public.saas_salvar_servico_331(_id uuid,_descricao text,_valor numeric,_vencimento date,_observacao text,_revisao integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare existente public.saas_servicos_331; v numeric:=round(_valor,2);
begin
 if not public.saas_proprietario_330() then raise exception 'Exclusivo do proprietário da plataforma' using errcode='42501';end if;
 perform 1 from public.saas_contrato_330 for update;
 if not exists(select 1 from public.saas_contrato_330 where mensal_inicio is not null) then raise exception 'Configure o contrato antes de adicionar serviços';end if;
 if _id is null or _revisao is null or _revisao<0 or length(btrim(coalesce(_descricao,''))) not between 2 and 160
 or v is null or v<=0 or v>99999999 or v::text in('NaN','Infinity','-Infinity') or _vencimento is null or _vencimento<'2020-01-01'
 or _vencimento>(now() at time zone 'America/Sao_Paulo')::date+3660 or length(coalesce(_observacao,''))>1000 then raise exception 'Confira descrição, valor e vencimento do serviço';end if;
 select * into existente from public.saas_servicos_331 where id=_id for update;
 if found then
  if existente.descricao=btrim(_descricao) and existente.valor=v and existente.vencimento=_vencimento and existente.observacao=coalesce(_observacao,'') then return public.saas_painel_330();end if;
  if existente.revisao<>_revisao then raise exception 'Serviço alterado em outra sessão. Atualize a lista';end if;
  if exists(select 1 from public.saas_eventos_330 where chave='servico:'||_id::text) then raise exception 'Serviço com histórico financeiro: cancele a cobrança e crie outra para preservar o histórico';end if;
  update public.saas_servicos_331 set descricao=btrim(_descricao),valor=v,vencimento=_vencimento,observacao=coalesce(_observacao,''),revisao=revisao+1,atualizado_em=now() where id=_id;
 else
  if _revisao<>0 then raise exception 'Serviço não encontrado. Atualize a lista';end if;
  insert into public.saas_servicos_331(id,descricao,valor,vencimento,observacao,autor) values(_id,btrim(_descricao),v,_vencimento,coalesce(_observacao,''),auth.uid());
 end if;
 update public.saas_contrato_330 set revisao=revisao+1,atualizado_em=now();
 insert into public.saas_eventos_330(requisicao,acao,motivo,autor,detalhe) values(gen_random_uuid(),'contrato','Serviço adicional cadastrado ou atualizado: '||btrim(_descricao),auth.uid(),jsonb_build_object('servico_id',_id,'descricao',btrim(_descricao),'valor',v,'vencimento',_vencimento));
 return public.saas_painel_330();
end $$;
revoke all on function public.saas_salvar_servico_331(uuid,text,numeric,date,text,integer) from public,anon,authenticated;
grant execute on function public.saas_salvar_servico_331(uuid,text,numeric,date,text,integer) to authenticated;
-- A cobrança continua administrável mesmo quando o acesso operacional está suspenso.
do $$ declare d text;novo text;begin
 select pg_get_functiondef('public.saas_pre_request_330()'::regprocedure) into d;
 if position('/rpc/saas_salvar_servico_331' in d)=0 then
  novo:=replace(d,$antes$'/rpc/saas_registrar_pagamento_330']$antes$,$depois$'/rpc/saas_registrar_pagamento_330','/rpc/saas_salvar_servico_331']$depois$);
  if novo=d then raise exception 'Revise a autorização HTTP de serviços adicionais';end if;
  execute novo;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
