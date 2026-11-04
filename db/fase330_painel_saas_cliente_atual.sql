-- Painel de cobrança da plataforma para uma única operação existente.
-- Não migra cadastros de negócio nem ativa cobrança/bloqueio automaticamente.
begin;
create table if not exists public.saas_proprietarios_330(
 usuario_id uuid primary key references public.profiles(id), criado_em timestamptz not null default now()
);
create table if not exists public.saas_contrato_330(
 unico boolean primary key default true check(unico), empresa text not null default 'Operação atual — Caparaó System',
 responsavel text not null default '', contato text not null default '', plano text not null default 'Plano atual',
 dominio text not null default 'www.caparaosystem.com.br', master_id uuid references public.profiles(id),
 inicio date, mensal_inicio date, setup_valor numeric(14,2) not null default 0 check(setup_valor>=0),
 setup_parcelas integer not null default 1 check(setup_parcelas between 1 and 36), setup_vencimento date,
 tolerancia integer not null default 5 check(tolerancia between 0 and 90), aviso_dias integer not null default 7 check(aviso_dias between 0 and 60),
 controle_ativo boolean not null default false, ativado_em timestamptz, revisao integer not null default 0,
 instrucoes text not null default '', atualizado_em timestamptz not null default now()
);
create table if not exists public.saas_termos_330(
 vigencia date primary key check(extract(day from vigencia)=1), valor numeric(14,2) not null check(valor>=0),
 dia integer not null check(dia between 1 and 31), criado_em timestamptz not null default now()
);
create table if not exists public.saas_setup_330(
 chave text primary key, parcela integer not null unique, vencimento date not null, valor numeric(14,2) not null check(valor>0)
);
create table if not exists public.saas_eventos_330(
 id bigint generated always as identity primary key, requisicao uuid not null unique, chave text,
 acao text not null check(acao in('contrato','pago','reaberto','cancelado')),
 valor numeric(14,2), vencimento date, pagamento_data date, motivo text not null,
 autor uuid not null references public.profiles(id), criado_em timestamptz not null default now(), detalhe jsonb not null default '{}'
);
create index if not exists saas_eventos_chave_330 on public.saas_eventos_330(chave,id desc);
insert into public.saas_contrato_330(unico) values(true) on conflict do nothing;
do $$ declare t text;begin
 foreach t in array array['saas_proprietarios_330','saas_contrato_330','saas_termos_330','saas_setup_330','saas_eventos_330'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;
create or replace function public.saas_proprietario_330() returns boolean
language sql stable security definer set search_path=public as $$
 select auth.uid() is not null and exists(select 1 from public.saas_proprietarios_330 o join public.profiles p on p.id=o.usuario_id where o.usuario_id=auth.uid() and p.ativo);
$$;
-- Somente cálculo: não gera títulos no financeiro do ERP nem depende de cron.
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
 )
 select b.*,case when e.acao='pago' then 'pago' when e.acao='cancelado' then 'cancelado'
  when b.vencimento<(now() at time zone 'America/Sao_Paulo')::date then 'vencido' else 'pendente' end estado,e.pagamento_data
 from base b left join lateral(select * from public.saas_eventos_330 e where e.chave=b.chave and e.acao in('pago','reaberto','cancelado') order by e.id desc limit 1)e on true;
$$;
create or replace function public.saas_bloqueado_330() returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce((select c.controle_ativo and exists(select 1 from public.saas_parcelas_330() p where p.estado='vencido'
 and p.vencimento+c.tolerancia<(now() at time zone 'America/Sao_Paulo')::date) from public.saas_contrato_330 c),false);
$$;
create or replace function public.saas_acesso_330() returns boolean
language sql stable security definer set search_path=public as $$select exists(select 1 from public.saas_contrato_330) and not public.saas_bloqueado_330()$$;
create or replace function public.saas_status_330() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare c public.saas_contrato_330; dono boolean; master boolean; vencido date; proximo date; bloqueio boolean;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and ativo) then raise exception 'Sessão ativa necessária' using errcode='42501';end if;
 select * into c from public.saas_contrato_330;
 if not found then raise exception 'Contrato da plataforma indisponível';end if;
 dono:=public.saas_proprietario_330();
 master:=case when c.master_id is not null then c.master_id=auth.uid() else exists(select 1 from public.user_roles where user_id=auth.uid() and role='admin') end;
 select min(p.vencimento) filter(where p.estado='vencido'),min(p.vencimento) filter(where p.estado='pendente') into vencido,proximo from public.saas_parcelas_330() p;
 bloqueio:=public.saas_bloqueado_330();
 return jsonb_build_object('proprietario',dono,'master',master,'bloqueado',bloqueio,'controle_ativo',c.controle_ativo,
 'estado',case when not c.controle_ativo then 'nao_configurado' when bloqueio then 'bloqueado' when vencido is not null then 'em_tolerancia'
 when proximo<=(now() at time zone 'America/Sao_Paulo')::date+c.aviso_dias then 'a_vencer' else 'em_dia' end,
 'vencimento',case when dono or master then coalesce(vencido,proximo) end,'limite_regularizacao',case when dono or master then vencido+c.tolerancia end);
end $$;
create or replace function public.saas_painel_330() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare s jsonb;
begin
 s:=public.saas_status_330();
 if not (s->>'proprietario')::boolean and not (s->>'master')::boolean then
  return jsonb_build_object('status',s,'mensagem','Procure o usuário master da empresa para regularizar a assinatura.');
 end if;
 return jsonb_build_object('status',s,'contrato',(select to_jsonb(c) from public.saas_contrato_330 c),
  'termos',(select coalesce(jsonb_agg(to_jsonb(t) order by t.vigencia),'[]') from public.saas_termos_330 t),
  'parcelas',(select coalesce(jsonb_agg(to_jsonb(p) order by p.vencimento,p.chave),'[]') from public.saas_parcelas_330() p),
  'historico',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc),'[]') from (select id,chave,acao,valor,vencimento,pagamento_data,motivo,criado_em from public.saas_eventos_330 order by id desc limit 100)e),
  'masters',case when (s->>'proprietario')::boolean then (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'nome',p.nome,'email',p.email)),'[]') from public.profiles p where p.ativo and exists(select 1 from public.user_roles u where u.user_id=p.id and u.role='admin')) else '[]'::jsonb end);
end $$;
create or replace function public.saas_salvar_contrato_330(_dados jsonb,_revisao integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.saas_contrato_330; v numeric; v_dia integer; ini date; vig date; setup numeric; n integer; i integer; inicio_setup date; total_centavos bigint; parcela_centavos bigint; master uuid; ativo boolean;
begin
 if not public.saas_proprietario_330() then raise exception 'Exclusivo do proprietário da plataforma' using errcode='42501';end if;
 select * into c from public.saas_contrato_330 for update;
 if c.revisao is distinct from _revisao then raise exception 'Contrato atualizado em outra sessão. Atualize o painel';end if;
 if jsonb_typeof(_dados)<>'object' or length(_dados::text)>15000 then raise exception 'Dados de contrato inválidos';end if;
 if length(btrim(coalesce(_dados->>'empresa','')))<2 or length(_dados->>'empresa')>160 or length(coalesce(_dados->>'instrucoes',''))>4000
 or length(coalesce(_dados->>'responsavel',''))>160 or length(coalesce(_dados->>'contato',''))>250 or length(coalesce(_dados->>'plano',''))>120 or length(coalesce(_dados->>'dominio',''))>250 then raise exception 'Confira os dados e limites do contrato';end if;
 master:=nullif(_dados->>'master_id','')::uuid;
 if master is null or not exists(select 1 from public.profiles p join public.user_roles u on u.user_id=p.id where p.id=master and p.ativo and u.role='admin') then raise exception 'Selecione um administrador ativo como usuário master';end if;
 ativo:=coalesce((_dados->>'controle_ativo')::boolean,c.controle_ativo);
 v:=round((_dados->>'mensalidade')::numeric,2);v_dia:=(_dados->>'dia_vencimento')::integer;
 if v is null or v<0 or v>99999999 or v::text in('NaN','Infinity','-Infinity') or v_dia not between 1 and 31 or v_dia is null then raise exception 'Mensalidade ou dia de vencimento inválido';end if;
 if c.ativado_em is null then
  ini:=(_dados->>'mensal_inicio')::date; inicio_setup:=(_dados->>'setup_vencimento')::date;
  setup:=round((_dados->>'setup_valor')::numeric,2);n:=(_dados->>'setup_parcelas')::integer;
  if ini is null or ini<'2020-01-01' or ini>(now() at time zone 'America/Sao_Paulo')::date+3660 or setup is null or setup<0 or setup>99999999 or setup::text in('NaN','Infinity','-Infinity') or n is null or n not between 1 and 36 or (setup>0 and (inicio_setup is null or inicio_setup<'2020-01-01' or inicio_setup>(now() at time zone 'America/Sao_Paulo')::date+3660 or setup*100<n)) then raise exception 'Confira início, implantação e parcelamento';end if;
  if exists(select 1 from public.saas_eventos_330 where chave is not null) then raise exception 'Há recebimentos registrados; preserve os termos iniciais';end if;
  delete from public.saas_termos_330;delete from public.saas_setup_330;
  insert into public.saas_termos_330 values(date_trunc('month',ini)::date,v,v_dia,now());
  if setup>0 then
   total_centavos:=(setup*100)::bigint;parcela_centavos:=total_centavos/n;
   for i in 1..n loop
    insert into public.saas_setup_330 values('setup:'||i,i,(date_trunc('month',inicio_setup)+(i-1)*interval '1 month'+
     (least(extract(day from inicio_setup)::integer,extract(day from date_trunc('month',inicio_setup)+i*interval '1 month'-interval '1 day')::integer)-1)*interval '1 day')::date,
     (case when i=n then total_centavos-parcela_centavos*(n-1) else parcela_centavos end)::numeric/100);
   end loop;
  end if;
 else
  ini:=c.mensal_inicio;inicio_setup:=c.setup_vencimento;setup:=c.setup_valor;n:=c.setup_parcelas;
  select t.vigencia into vig from public.saas_termos_330 t order by t.vigencia desc limit 1;
  if exists(select 1 from public.saas_termos_330 t where t.vigencia=vig and (t.valor<>v or t.dia<>v_dia)) then
   vig:=date_trunc('month',(left(_dados->>'vigencia_mensalidade',7)||'-01')::date)::date;
   if vig is null or vig<date_trunc('month',(now() at time zone 'America/Sao_Paulo')::date)+interval '1 month' then raise exception 'Nova mensalidade deve iniciar em mês futuro';end if;
   if exists(select 1 from public.saas_eventos_330 where chave like 'mensal:%' and substring(chave from 8)>=to_char(vig,'YYYY-MM')) then raise exception 'Competência já possui histórico financeiro';end if;
   insert into public.saas_termos_330 values(vig,v,v_dia,now()) on conflict(vigencia) do update set valor=excluded.valor,dia=excluded.dia;
  end if;
 end if;
 update public.saas_contrato_330 set empresa=btrim(_dados->>'empresa'),responsavel=coalesce(_dados->>'responsavel',''),contato=coalesce(_dados->>'contato',''),plano=coalesce(_dados->>'plano',''),dominio=coalesce(_dados->>'dominio',''),master_id=master,
 inicio=coalesce(c.inicio,(now() at time zone 'America/Sao_Paulo')::date),mensal_inicio=ini,setup_valor=setup,setup_parcelas=n,setup_vencimento=inicio_setup,
 tolerancia=(_dados->>'tolerancia')::integer,aviso_dias=(_dados->>'aviso_dias')::integer,controle_ativo=ativo,
 ativado_em=case when ativo then coalesce(c.ativado_em,now()) else c.ativado_em end,instrucoes=coalesce(_dados->>'instrucoes',''),revisao=revisao+1,atualizado_em=now();
 insert into public.saas_eventos_330(requisicao,acao,motivo,autor,detalhe) values(gen_random_uuid(),'contrato','Configuração do contrato atualizada',auth.uid(),jsonb_build_object('controle_ativo',ativo,'revisao',c.revisao+1));
 return public.saas_painel_330();
end $$;
create or replace function public.saas_registrar_pagamento_330(_chave text,_acao text,_data date,_motivo text,_requisicao uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p record;anterior record;
begin
 if not public.saas_proprietario_330() then raise exception 'Exclusivo do proprietário da plataforma' using errcode='42501';end if;
 perform 1 from public.saas_contrato_330 for update;
 if _requisicao is null or _acao not in('pago','reaberto','cancelado') or _acao is null or length(btrim(coalesce(_motivo,'')))<5 or length(_motivo)>1000 then raise exception 'Informe uma ação e motivo válido';end if;
 select * into anterior from public.saas_eventos_330 where requisicao=_requisicao;
 if found then
  if anterior.chave is distinct from _chave or anterior.acao is distinct from _acao or anterior.pagamento_data is distinct from _data or anterior.motivo is distinct from btrim(_motivo) then raise exception 'Identificador já usado para outra operação';end if;
  return public.saas_painel_330();
 end if;
 select * into p from public.saas_parcelas_330() where chave=_chave;
 if not found then raise exception 'Parcela não encontrada';end if;
 if _acao='pago' and (p.estado in('pago','cancelado') or _data is null or _data>(now() at time zone 'America/Sao_Paulo')::date or _data<'2020-01-01') then raise exception 'Confira situação e data do pagamento';end if;
 if _acao='reaberto' and p.estado not in('pago','cancelado') then raise exception 'Somente parcelas pagas ou canceladas podem ser reabertas';end if;
 if _acao='cancelado' and p.estado in('pago','cancelado') then raise exception 'Reabra o pagamento antes de cancelar a cobrança';end if;
 if _acao<>'pago' and _data is not null then raise exception 'Data de recebimento só se aplica ao pagamento';end if;
 update public.saas_contrato_330 set ativado_em=coalesce(ativado_em,now()),revisao=revisao+1;
 insert into public.saas_eventos_330(requisicao,chave,acao,valor,vencimento,pagamento_data,motivo,autor) values(_requisicao,_chave,_acao,p.valor,p.vencimento,_data,btrim(_motivo),auth.uid());
 return public.saas_painel_330();
end $$;
-- A limpeza administrativa do ERP não pode apagar o contrato da plataforma.
do $$ declare d text;novo text;begin
 if to_regprocedure('public.admin_limpar_dados_interno_f130(text)') is not null then
  select pg_get_functiondef('public.admin_limpar_dados_interno_f130(text)'::regprocedure) into d;
  if position('^saas_' in d)=0 then
   novo:=regexp_replace(d,'c\.relname[[:space:]]*<>[[:space:]]*all[[:space:]]*\([[:space:]]*manter[[:space:]]*\)',
    '(c.relname <> all(manter) and c.relname !~ ''^saas_'')','i');
   if novo=d then raise exception 'Revise o isolamento SaaS na rotina de limpeza antes de instalar';end if;
   execute novo;
  end if;
 end if;
end $$;
create or replace function public.saas_proteger_historico_330() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is not null then raise exception 'O histórico SaaS não pode ser apagado ou reescrito pelo ERP';end if;
 return null;
end $$;
do $$ declare t text;begin
 foreach t in array array['saas_proprietarios_330','saas_contrato_330','saas_termos_330','saas_setup_330','saas_eventos_330'] loop
  execute format('drop trigger if exists proteger_saas_330 on public.%I',t);
  execute format('create trigger proteger_saas_330 before truncate on public.%I for each statement execute function public.saas_proteger_historico_330()',t);
 end loop;
end $$;
drop trigger if exists saas_eventos_imutaveis_330 on public.saas_eventos_330;
create trigger saas_eventos_imutaveis_330 before update or delete on public.saas_eventos_330 for each statement execute function public.saas_proteger_historico_330();
-- O administrador da operação não desativa nem remove a conta proprietária da plataforma.
create or replace function public.saas_proteger_perfil_330() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is not null and auth.uid()<>old.id and exists(select 1 from public.saas_proprietarios_330 where usuario_id=old.id)
 and (tg_op='DELETE' or new.id is distinct from old.id or new.ativo is distinct from old.ativo or new.email is distinct from old.email) then
  raise exception 'A conta proprietária da plataforma é protegida contra alteração de acesso pelo ERP';
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
drop trigger if exists saas_proteger_perfil_330 on public.profiles;
create trigger saas_proteger_perfil_330 before update or delete on public.profiles for each row execute function public.saas_proteger_perfil_330();
-- Defesa central da API: cobre tabelas, views e RPCs, inclusive funções definer legadas.
-- O proprietário administra o SaaS durante bloqueio, mas não ganha acesso ao ERP.
create or replace function public.saas_pre_request_330() returns void
language plpgsql security definer set search_path=public as $$
declare caminho text:=coalesce(current_setting('request.path',true),'');
begin
 if auth.uid() is null then return;end if;
 if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')='service_role' then return;end if;
 if caminho=any(array['/rpc/saas_status_330','/rpc/saas_painel_330','/rpc/saas_acesso_330','/rpc/saas_salvar_contrato_330','/rpc/saas_registrar_pagamento_330']) then return;end if;
 if not public.saas_acesso_330() then raise sqlstate 'PT402' using message='Assinatura pendente. Acesse a tela de regularização.';end if;
end $$;
-- RLS adicional para Realtime/Storage e leituras de tabelas fora do hook HTTP.
do $$ declare t record;begin
 for t in select c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relrowsecurity and c.relname not like 'saas_%' and c.relname not in('profiles','user_roles') loop
  execute format('drop policy if exists assinatura_saas_330 on public.%I',t.relname);
  execute format('create policy assinatura_saas_330 on public.%I as restrictive for all to authenticated using ((select public.saas_acesso_330())) with check ((select public.saas_acesso_330()))',t.relname);
 end loop;
 if to_regclass('storage.objects') is not null then
  execute 'drop policy if exists assinatura_saas_330 on storage.objects';
  execute 'create policy assinatura_saas_330 on storage.objects as restrictive for all to authenticated using ((select public.saas_acesso_330())) with check ((select public.saas_acesso_330()))';
 end if;
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure assinatura from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'saas_%_330' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.assinatura);
 end loop;
end $$;
grant execute on function public.saas_status_330(),public.saas_painel_330(),public.saas_acesso_330(),public.saas_salvar_contrato_330(jsonb,integer),public.saas_registrar_pagamento_330(text,text,date,text,uuid) to authenticated;
grant execute on function public.saas_pre_request_330() to anon,authenticated,service_role;
-- Instalação protegida: não substitui outro hook configurado na infraestrutura.
do $$ declare existente text;begin
 select string_agg(distinct nullif(substring(v from length('pgrst.db_pre_request=')+1),''),',') into existente from (
  select unnest(rolconfig) v from pg_roles where rolname='authenticator'
  union all select unnest(setconfig) v from pg_db_role_setting where setrole=(select oid from pg_roles where rolname='authenticator')
   and (setdatabase=0 or setdatabase=(select oid from pg_database where datname=current_database()))
 ) configuracao where v like 'pgrst.db_pre_request=%';
 if existente is not null and existente<>'' and existente<>'public.saas_pre_request_330' then raise exception 'Preserve e integre o hook existente: %',existente;end if;
 alter role authenticator set pgrst.db_pre_request='public.saas_pre_request_330';
 execute format('alter role authenticator in database %I set pgrst.db_pre_request=''public.saas_pre_request_330''',current_database());
end $$;
notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;
