-- Contrato da operação atual com vigência e lista de serviços. Instalação não gera cobranças.
begin;
alter table public.saas_contrato_330 add column if not exists fim date;
alter table public.saas_contrato_330 add column if not exists modelo_335 boolean not null default false;
create table if not exists public.saas_itens_contrato_335(
 id uuid primary key,descricao text not null,tipo text not null,periodicidade text not null,
 valor numeric(14,2) not null check(valor>0),primeiro_vencimento date not null,parcelas integer not null,
 observacao text not null default '',ordem integer not null
);
create table if not exists public.saas_grade_335(
 chave text primary key,servico_id uuid not null references public.saas_itens_contrato_335(id),
 descricao text not null,tipo text not null,competencia date not null,parcela integer not null,
 vencimento date not null,valor numeric(14,2) not null check(valor>0)
);
create table if not exists public.saas_legado_335(
 chave text primary key,tipo text not null,competencia date not null,parcela integer not null,vencimento date not null,valor numeric(14,2) not null
);
do $$declare t text;d text;begin
 foreach t in array array['saas_itens_contrato_335','saas_grade_335','saas_legado_335'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('drop trigger if exists proteger_saas_330 on public.%I',t);
  execute format('create trigger proteger_saas_330 before truncate on public.%I for each statement execute function public.saas_proteger_historico_330()',t);
 end loop;
 if to_regprocedure('public.saas_parcelas_legadas_335()') is null then
  select pg_get_functiondef('public.saas_parcelas_330()'::regprocedure) into d;
  execute replace(d,'public.saas_parcelas_330()','public.saas_parcelas_legadas_335()');
 end if;
end $$;
revoke all on function public.saas_parcelas_legadas_335() from public,anon,authenticated,service_role;
create or replace function public.saas_calcular_grade_335(_inicio date,_fim date,_servicos jsonb)
returns table(chave text,servico_id uuid,descricao text,tipo text,competencia date,parcela integer,vencimento date,valor numeric)
language plpgsql immutable set search_path=public as $$
declare s jsonb;sid uuid;vistos uuid[]:='{}';desc_s text;tipo_s text;freq text;v numeric;n integer;i integer;passo integer;primeiro date;venc date;centavos bigint;dividido bigint;
begin
 if _inicio is null or _fim is null or _inicio<'2020-01-01' or _fim<_inicio or _fim>_inicio+interval '10 years'
 or jsonb_typeof(_servicos) is distinct from 'array' or jsonb_array_length(_servicos) not between 1 and 50 then
  raise exception 'Informe a vigência do contrato (até 10 anos) e de 1 a 50 serviços';end if;
 for s in select * from jsonb_array_elements(_servicos) loop
  if jsonb_typeof(s) is distinct from 'object' then raise exception 'Serviço inválido';end if;
  sid:=(s->>'id')::uuid;desc_s:=btrim(s->>'descricao');tipo_s:=s->>'tipo';freq:=s->>'periodicidade';
  v:=(s->>'valor')::numeric;n:=(s->>'parcelas')::integer;primeiro:=(s->>'primeiro_vencimento')::date;
  if sid is null or sid=any(vistos) or desc_s is null or length(desc_s) not between 2 and 160
  or tipo_s is null or tipo_s not in('mensalidade','implantacao','hospedagem','dominio','servico')
  or freq is null or freq not in('mensal','anual','unica','parcelado')
  or v is null or v::text in('NaN','Infinity','-Infinity') or v<=0 or v>99999999 or round(v,2)<>v
  or n is null or n not between 1 and 120 or (freq<>'parcelado' and n<>1)
  or primeiro is null or primeiro<_inicio or primeiro>_fim or length(coalesce(s->>'observacao',''))>1000 then
   raise exception 'Confira descrição, valor, periodicidade, parcelas e primeiro vencimento de cada serviço';end if;
  vistos:=array_append(vistos,sid);centavos:=(v*100)::bigint;
  if freq='parcelado' and centavos<n then raise exception 'Cada parcela precisa valer pelo menos um centavo';end if;
  if freq='parcelado' and (primeiro+(n-1)*interval '1 month')::date>_fim then raise exception 'Todas as parcelas devem vencer dentro da vigência do contrato';end if;
  passo:=case when freq='anual' then 12 else 1 end;
  if freq='mensal' then n:=121;elsif freq='anual' then n:=11;elsif freq='unica' then n:=1;end if;
  dividido:=centavos/n;
  for i in 1..n loop
   venc:=(primeiro+(i-1)*passo*interval '1 month')::date;
   exit when venc>_fim;
   chave:='contrato:'||sid::text||':'||i;servico_id:=sid;descricao:=desc_s;tipo:=tipo_s;
   competencia:=date_trunc('month',venc)::date;parcela:=i;vencimento:=venc;
   valor:=case when freq='parcelado' then (case when i=n then centavos-dividido*(n-1) else dividido end)::numeric/100 else v end;
   return next;
  end loop;
 end loop;
end $$;
revoke all on function public.saas_calcular_grade_335(date,date,jsonb) from public,anon,authenticated,service_role;
create or replace function public.saas_parcelas_330() returns table(
 chave text,tipo text,competencia date,parcela integer,vencimento date,valor numeric,estado text,pagamento_data date
) language sql stable security definer set search_path=public as $$
 with base as (
  select g.chave,g.tipo,g.competencia,g.parcela,g.vencimento,g.valor from public.saas_grade_335 g where (select modelo_335 from public.saas_contrato_330)
  union all select l.* from public.saas_legado_335 l where (select modelo_335 from public.saas_contrato_330)
 ), novas as (
 select b.*,case when e.acao='pago' then 'pago' when e.acao='cancelado' then 'cancelado'
 when b.vencimento<(now() at time zone 'America/Sao_Paulo')::date then 'vencido' else 'pendente' end estado,e.pagamento_data
 from base b left join lateral(select * from public.saas_eventos_330 e where e.chave=b.chave and e.acao in('pago','reaberto','cancelado') order by e.id desc limit 1)e on true
 ) select * from novas union all select * from public.saas_parcelas_legadas_335() where not (select modelo_335 from public.saas_contrato_330);
$$;
revoke all on function public.saas_parcelas_330() from public,anon,authenticated,service_role;
create or replace function public.saas_painel_330() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare s jsonb;
begin
 s:=public.saas_status_330();
 if not (s->>'proprietario')::boolean and not (s->>'master')::boolean then
  return jsonb_build_object('status',s,'mensagem','Procure o usuário master da empresa para regularizar a assinatura.');end if;
 return jsonb_build_object('status',s,'contrato',(select to_jsonb(c) from public.saas_contrato_330 c),
 'termos',(select coalesce(jsonb_agg(to_jsonb(t) order by t.vigencia),'[]') from public.saas_termos_330 t),
 'itens_contrato',(select coalesce(jsonb_agg(to_jsonb(i) order by i.ordem),'[]') from public.saas_itens_contrato_335 i),
 'parcelas',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('descricao',coalesce(g.descricao,sv.descricao,case when p.tipo='implantacao' then 'Implantação' else 'Mensalidade' end)) order by p.vencimento,p.chave),'[]')
  from public.saas_parcelas_330() p left join public.saas_grade_335 g on g.chave=p.chave left join public.saas_servicos_331 sv on p.chave='servico:'||sv.id::text),
 'servicos',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select x.id,x.descricao,x.valor,x.vencimento,x.observacao,x.revisao,not exists(select 1 from public.saas_eventos_330 e where e.chave='servico:'||x.id::text) editavel from public.saas_servicos_331 x)x),
 'historico',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc),'[]') from(select id,chave,acao,valor,vencimento,pagamento_data,motivo,criado_em from public.saas_eventos_330 order by id desc limit 100)e),
 'masters',case when (s->>'proprietario')::boolean then (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'nome',p.nome,'email',p.email)),'[]') from public.profiles p where p.ativo and exists(select 1 from public.user_roles u where u.user_id=p.id and u.role='admin')) else '[]'::jsonb end);
end $$;
revoke all on function public.saas_painel_330() from public,anon,authenticated,service_role;
grant execute on function public.saas_painel_330() to authenticated;
create or replace function public.saas_prever_contrato_335(_dados jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare grade jsonb;total numeric;
begin
 if not public.saas_proprietario_330() then raise exception 'Exclusivo do proprietário da plataforma' using errcode='42501';end if;
 if _dados is null or length(_dados::text)>100000 then raise exception 'Configuração inválida';end if;
 select jsonb_agg(to_jsonb(g) order by g.vencimento,g.descricao),sum(g.valor) into grade,total from public.saas_calcular_grade_335((_dados->>'inicio')::date,(_dados->>'fim')::date,_dados->'servicos')g;
 return jsonb_build_object('parcelas',coalesce(grade,'[]'),'total',coalesce(total,0));
end $$;
revoke all on function public.saas_prever_contrato_335(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.saas_prever_contrato_335(jsonb) to authenticated;
create or replace function public.saas_salvar_grade_335(_dados jsonb,_revisao integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.saas_contrato_330;grade jsonb;ini date;fim_c date;master uuid;ativo boolean;tol integer;aviso integer;s jsonb;ord integer:=0;limite_legado date;
begin
 if not public.saas_proprietario_330() then raise exception 'Exclusivo do proprietário da plataforma' using errcode='42501';end if;
 select * into c from public.saas_contrato_330 for update;
 if c.revisao is distinct from _revisao then raise exception 'Contrato atualizado em outra sessão. Atualize o painel';end if;
 if _dados is null or jsonb_typeof(_dados)<>'object' or length(_dados::text)>100000 then raise exception 'Configuração inválida';end if;
 if length(btrim(coalesce(_dados->>'empresa',''))) not between 2 and 160 or length(coalesce(_dados->>'responsavel',''))>160
 or length(coalesce(_dados->>'contato',''))>250 or length(coalesce(_dados->>'plano',''))>120 or length(coalesce(_dados->>'dominio',''))>250
 or length(coalesce(_dados->>'instrucoes',''))>4000 then raise exception 'Confira os dados do contrato';end if;
 ini:=(_dados->>'inicio')::date;fim_c:=(_dados->>'fim')::date;master:=(_dados->>'master_id')::uuid;
 ativo:=coalesce((_dados->>'controle_ativo')::boolean,false);tol:=(_dados->>'tolerancia')::integer;aviso:=(_dados->>'aviso_dias')::integer;
 if tol is null or tol not between 0 and 90 or aviso is null or aviso not between 0 and 60 then raise exception 'Confira tolerância e antecedência dos avisos';end if;
 if master is null or not exists(select 1 from public.profiles p join public.user_roles u on u.user_id=p.id where p.id=master and p.ativo and u.role='admin') then raise exception 'Selecione um administrador ativo como usuário master';end if;
 grade:=public.saas_prever_contrato_335(_dados)->'parcelas';
 if not c.modelo_335 then
  insert into public.saas_legado_335 select chave,tipo,competencia,parcela,vencimento,valor from public.saas_parcelas_legadas_335() on conflict do nothing;
 end if;
 select max(vencimento) into limite_legado from public.saas_legado_335;
 if exists(select 1 from public.saas_legado_335 where vencimento<ini or vencimento>fim_c) then raise exception 'A vigência deve preservar os vencimentos das cobranças anteriores';end if;
 if exists(select 1 from jsonb_to_recordset(grade) as g(vencimento date) where g.vencimento<=limite_legado) then raise exception 'Para evitar duplicidade, os novos serviços devem iniciar após o último vencimento anterior';end if;
 -- Preserva descrições, valores e datas de tudo que já venceu ou tem eventos, inclusive cancelamento.
 if exists(select 1 from public.saas_grade_335 antigo where (antigo.vencimento<=(now() at time zone 'America/Sao_Paulo')::date or exists(select 1 from public.saas_eventos_330 e where e.chave=antigo.chave)) and
 not exists(select 1 from jsonb_to_recordset(grade) as novo(chave text,servico_id uuid,descricao text,tipo text,competencia date,parcela integer,vencimento date,valor numeric)
  where to_jsonb(novo)=to_jsonb(antigo))) then raise exception 'Cobranças vencidas ou com histórico financeiro devem ser preservadas. Altere somente parcelas futuras sem histórico';end if;
 delete from public.saas_grade_335 antigo where not exists(select 1 from jsonb_array_elements(grade) g where g->>'chave'=antigo.chave);
 for s in select * from jsonb_array_elements(_dados->'servicos') loop
  ord:=ord+1;
  insert into public.saas_itens_contrato_335(id,descricao,tipo,periodicidade,valor,primeiro_vencimento,parcelas,observacao,ordem)
  values((s->>'id')::uuid,btrim(s->>'descricao'),s->>'tipo',s->>'periodicidade',(s->>'valor')::numeric,(s->>'primeiro_vencimento')::date,(s->>'parcelas')::integer,coalesce(s->>'observacao',''),ord)
  on conflict(id) do update set descricao=excluded.descricao,tipo=excluded.tipo,periodicidade=excluded.periodicidade,valor=excluded.valor,primeiro_vencimento=excluded.primeiro_vencimento,parcelas=excluded.parcelas,observacao=excluded.observacao,ordem=excluded.ordem;
 end loop;
 delete from public.saas_itens_contrato_335 antigo where not exists(select 1 from jsonb_array_elements(_dados->'servicos') item_json where (item_json->>'id')::uuid=antigo.id);
 insert into public.saas_grade_335 select * from jsonb_to_recordset(grade) as g(chave text,servico_id uuid,descricao text,tipo text,competencia date,parcela integer,vencimento date,valor numeric)
 on conflict(chave) do update set descricao=excluded.descricao,tipo=excluded.tipo,competencia=excluded.competencia,parcela=excluded.parcela,vencimento=excluded.vencimento,valor=excluded.valor;
 update public.saas_contrato_330 set empresa=btrim(_dados->>'empresa'),responsavel=coalesce(_dados->>'responsavel',''),contato=coalesce(_dados->>'contato',''),plano=coalesce(_dados->>'plano',''),dominio=coalesce(_dados->>'dominio',''),master_id=master,
 inicio=ini,fim=fim_c,modelo_335=true,tolerancia=tol,aviso_dias=aviso,controle_ativo=ativo,instrucoes=coalesce(_dados->>'instrucoes',''),
 ativado_em=case when ativo then coalesce(ativado_em,now()) else ativado_em end,revisao=revisao+1,atualizado_em=now();
 insert into public.saas_eventos_330(requisicao,acao,motivo,autor,detalhe) values(gen_random_uuid(),'contrato','Vigência e lista de serviços do contrato atualizadas',auth.uid(),jsonb_build_object('inicio',ini,'fim',fim_c,'controle_ativo',ativo,'total',public.saas_prever_contrato_335(_dados)->'total','servicos',jsonb_array_length(_dados->'servicos')));
 return public.saas_painel_330();
end $$;
revoke all on function public.saas_salvar_grade_335(jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.saas_salvar_grade_335(jsonb,integer) to authenticated;
-- Rotinas antigas não podem gerar cobranças paralelas depois de adotar a lista.
do $$declare sig text;d text;alvo text:='if not public.saas_proprietario_330() then raise exception ''Exclusivo do proprietário da plataforma'' using errcode=''42501'';end if;';begin
 foreach sig in array array['public.saas_salvar_contrato_330(jsonb,integer)','public.saas_salvar_servico_331(uuid,text,numeric,date,text,integer)'] loop
  select pg_get_functiondef(sig::regprocedure) into d;
  if position('modelo_335' in d)=0 then
   if position(alvo in d)=0 then raise exception 'Revise a autorização da rotina %',sig;end if;
   execute replace(d,alvo,alvo||E'\n if (select modelo_335 from public.saas_contrato_330) then raise exception ''Use a lista de serviços na configuração do contrato'';end if;');
  end if;
 end loop;
 select pg_get_functiondef('public.saas_pre_request_330()'::regprocedure) into d;
 if position('/rpc/saas_salvar_grade_335' in d)=0 then
  if position('''/rpc/saas_salvar_servico_331'']' in d)=0 then raise exception 'Revise o hook de cobrança antes da fase335';end if;
  execute replace(d,'''/rpc/saas_salvar_servico_331'']','''/rpc/saas_salvar_servico_331'',''/rpc/saas_prever_contrato_335'',''/rpc/saas_salvar_grade_335'']');
 end if;
end $$;
notify pgrst,'reload schema';
commit;
