-- Responsáveis múltiplos, contagem de bloqueio e resposta neutra para usuários sem acesso financeiro.
begin;
alter table public.saas_contrato_330 add column if not exists master_ids uuid[] not null default '{}';
create or replace function public.saas_master_343() returns boolean
language sql stable security definer set search_path=public as $$
 select auth.uid() is not null and exists(select 1 from public.profiles p join public.user_roles u on u.user_id=p.id join public.saas_contrato_330 c on true
 where p.id=auth.uid() and p.ativo and u.role='admin' and
 (case when cardinality(c.master_ids)>0 then p.id=any(c.master_ids) when c.master_id is not null then p.id=c.master_id else true end));
$$;
revoke all on function public.saas_master_343() from public,anon,authenticated,service_role;

create or replace function public.saas_normalizar_masters_343(_dados jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare ids uuid[];c public.saas_contrato_330;legado uuid;
begin
 select * into c from public.saas_contrato_330;
 if _dados?'master_ids' then
  if jsonb_typeof(_dados->'master_ids') is distinct from 'array' or jsonb_array_length(_dados->'master_ids') not between 1 and 20 then raise exception 'Selecione de 1 a 20 administradores responsáveis pela mensalidade';end if;
  select array_agg(v::uuid order by ord) into ids from jsonb_array_elements_text(_dados->'master_ids') with ordinality x(v,ord);
 else
  legado:=nullif(_dados->>'master_id','')::uuid;
  if cardinality(c.master_ids)>1 then
   if legado is distinct from c.master_id then raise exception 'Atualize o painel para alterar a lista de responsáveis';end if;
   ids:=c.master_ids;
  else ids:=array[legado];end if;
 end if;
 if array_position(ids,null) is not null or cardinality(ids)<>(select count(distinct v) from unnest(ids) v)
 or exists(select 1 from unnest(ids) v where not exists(select 1 from public.profiles p join public.user_roles u on u.user_id=p.id where p.id=v and p.ativo and u.role='admin')) then
  raise exception 'Selecione administradores ativos, sem repetir usuários, para receber os avisos e consultar a mensalidade';end if;
 return _dados||jsonb_build_object('master_ids',to_jsonb(ids),'master_id',ids[1]);
end $$;
revoke all on function public.saas_normalizar_masters_343(jsonb) from public,anon,authenticated,service_role;

do $$declare sig text;d text;alvo text;begin
 foreach sig in array array['public.saas_salvar_contrato_330(jsonb,integer)','public.saas_salvar_grade_335(jsonb,integer)'] loop
  select pg_get_functiondef(sig::regprocedure) into d;
  if position('masters_343' in d)=0 then
   if position('master:=' in d)=0 or position('master_id=master,' in d)=0 then raise exception 'Revise o salvamento do contrato % antes da fase343',sig;end if;
   d:=replace(d,'master:=','_dados:=public.saas_normalizar_masters_343(_dados); -- masters_343'||E'\n master:=');
   d:=replace(d,'master_id=master,','master_id=master,master_ids=ARRAY(SELECT jsonb_array_elements_text(_dados->''master_ids'')::uuid),');
   execute d;
  end if;
 end loop;
end $$;

create or replace function public.saas_status_330() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare c public.saas_contrato_330;dono boolean;master boolean;vencido date;proximo date;bloqueio boolean;hoje date:=(now() at time zone 'America/Sao_Paulo')::date;data_bloq date;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and ativo) then raise exception 'Sessão ativa necessária' using errcode='42501';end if;
 select * into c from public.saas_contrato_330;
 if not found then raise exception 'Contrato da plataforma indisponível';end if;
 dono:=public.saas_proprietario_330();master:=public.saas_master_343();
 select min(p.vencimento) filter(where p.estado='vencido'),min(p.vencimento) filter(where p.estado='pendente') into vencido,proximo from public.saas_parcelas_330() p;
 bloqueio:=public.saas_bloqueado_330();
 if c.controle_ativo and (dono or master) then data_bloq:=coalesce(vencido,proximo)+c.tolerancia+1;end if;
 return jsonb_build_object('proprietario',dono,'master',master,'bloqueado',bloqueio,'manutencao',bloqueio and not(dono or master),'controle_ativo',c.controle_ativo,
 'estado',case when not(dono or master) then case when bloqueio then 'manutencao' else 'em_dia' end
 when not c.controle_ativo then 'nao_configurado' when bloqueio then 'bloqueado' when vencido is not null then 'em_tolerancia'
 when proximo<=hoje+c.aviso_dias then 'a_vencer' else 'em_dia' end,
 'vencimento',case when dono or master then coalesce(vencido,proximo) end,
 'limite_regularizacao',case when dono or master then vencido+c.tolerancia end,
 'data_bloqueio',data_bloq,'dias_ate_bloqueio',case when data_bloq is not null then greatest(0,data_bloq-hoje) end);
end $$;
revoke all on function public.saas_status_330() from public,anon,authenticated,service_role;
grant execute on function public.saas_status_330() to authenticated;

do $$declare d text;alvo text;begin
 select pg_get_functiondef('public.saas_painel_330()'::regprocedure) into d;
 alvo:='''Procure o usuário master da empresa para regularizar a assinatura.''';
 if position(alvo in d)>0 then
  d:=replace(d,alvo,'case when (s->>''bloqueado'')::boolean then ''Sistema em Manutenção'' else ''Procure um responsável pela mensalidade da empresa.'' end');execute d;
 elsif position('Sistema em Manutenção' in d)=0 then raise exception 'Revise a resposta do painel antes da fase343';end if;
 select pg_get_functiondef('public.saas_pre_request_330()'::regprocedure) into d;
 alvo:='raise sqlstate ''PT402'' using message=''Assinatura pendente. Acesse a tela de regularização.'';';
 if position(alvo in d)>0 then
  d:=replace(d,alvo,'raise sqlstate ''PT402'' using message=case when public.saas_proprietario_330() or public.saas_master_343() then ''Mensalidade pendente. Acesse a tela de regularização.'' else ''Sistema em Manutenção'' end;');execute d;
 elsif position('Sistema em Manutenção' in d)=0 then raise exception 'Revise a proteção da API antes da fase343';end if;
end $$;
notify pgrst,'reload schema';
commit;
