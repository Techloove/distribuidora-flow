-- Reajustes explícitos por salário mínimo. Não agenda valores oficiais nem recalcula contratos na instalação.
begin;
alter table public.saas_itens_contrato_335 add column if not exists percentual_salario numeric(7,4) check(percentual_salario>0 and percentual_salario<=100);
alter table public.saas_itens_contrato_335 add column if not exists reajustes jsonb not null default '[]'::jsonb check(jsonb_typeof(reajustes)='array');

create or replace function public.saas_validar_reajustes_341(s jsonb,_inicio date,_fim date) returns void
language plpgsql immutable set search_path=public as $$
declare p numeric:=nullif(s->>'percentual_salario','')::numeric;rs jsonb:=coalesce(s->'reajustes','[]'::jsonb);r jsonb;v date;base numeric;datas date[]:='{}';indefinida date;
begin
 if jsonb_typeof(rs) is distinct from 'array' or jsonb_array_length(rs)>20 then raise exception 'Informe até 20 reajustes por assinatura';end if;
 if p is null then
  if jsonb_array_length(rs)>0 then raise exception 'Informe o percentual do salário mínimo para configurar reajustes';end if;return;
 end if;
 if p::text in('NaN','Infinity','-Infinity') or p<=0 or p>100 or round(p,4)<>p or s->>'tipo'<>'mensalidade' or s->>'periodicidade'<>'mensal' then
  raise exception 'Reajuste por salário mínimo exige assinatura mensal e percentual positivo de até 100';end if;
 for r in select * from jsonb_array_elements(rs) loop
  if jsonb_typeof(r) is distinct from 'object' then raise exception 'Reajuste inválido';end if;
  v:=(r->>'vigencia')::date;base:=nullif(r->>'salario_minimo','')::numeric;
  if v is null or v<_inicio or v>_fim or v=any(datas) then raise exception 'Informe vigências diferentes e dentro do contrato para os reajustes';end if;
  if base is not null and (base::text in('NaN','Infinity','-Infinity') or base<=0 or base>99999999 or round(base,2)<>base or round(base*p/100,2)<=0) then
   raise exception 'Informe um salário mínimo positivo com até duas casas decimais';end if;
  if base is null then
   if indefinida is not null then raise exception 'Deixe somente o último reajuste com salário mínimo a definir';end if;indefinida:=v;
  end if;
  datas:=array_append(datas,v);
 end loop;
 if indefinida is not null and exists(select 1 from unnest(datas) d where d>indefinida) then raise exception 'O reajuste a definir deve ser o último da lista';end if;
end $$;
revoke all on function public.saas_validar_reajustes_341(jsonb,date,date) from public,anon,authenticated,service_role;

-- Formulários antigos preservam reajustes já configurados; null e [] explícitos permitem desativar.
create or replace function public.saas_completar_servicos_341(_servicos jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 if jsonb_typeof(_servicos) is distinct from 'array' then return _servicos;end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('percentual_salario',i.percentual_salario,'reajustes',coalesce(i.reajustes,'[]'::jsonb))||s order by ord),'[]'::jsonb)
 from jsonb_array_elements(_servicos) with ordinality x(s,ord) left join public.saas_itens_contrato_335 i on i.id=(s->>'id')::uuid);
end $$;
revoke all on function public.saas_completar_servicos_341(jsonb) from public,anon,authenticated,service_role;

create or replace function public.saas_reajustes_pendentes_341(_servicos jsonb) returns jsonb
language sql immutable set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('servico_id',s->>'id','descricao',s->>'descricao','vigencia',r->>'vigencia','percentual',s->'percentual_salario') order by r->>'vigencia'),'[]'::jsonb)
 from jsonb_array_elements(_servicos) s cross join lateral jsonb_array_elements(coalesce(s->'reajustes','[]'::jsonb)) r
 where nullif(r->>'salario_minimo','') is null and s->>'percentual_salario' is not null
$$;
revoke all on function public.saas_reajustes_pendentes_341(jsonb) from public,anon,authenticated,service_role;

do $$declare d text;alvo text;novo text;begin
 select pg_get_functiondef('public.saas_calcular_grade_335(date,date,jsonb)'::regprocedure) into d;
 if position('reajuste_341' in d)=0 then
  if position('dividido bigint;' in d)=0 or position('vistos:=array_append(vistos,sid);' in d)=0 or position('   return next;' in d)=0 then raise exception 'Revise o cálculo da grade antes da fase341';end if;
  d:=replace(d,'dividido bigint;','dividido bigint; percentual numeric; referencia jsonb; -- reajuste_341');
  d:=replace(d,'vistos:=array_append(vistos,sid);','perform public.saas_validar_reajustes_341(s,_inicio,_fim);percentual:=nullif(s->>''percentual_salario'','''')::numeric;'||E'\n  vistos:=array_append(vistos,sid);');
  d:=replace(d,'   return next;',E'   if percentual is not null then\n    select r into referencia from jsonb_array_elements(coalesce(s->''reajustes'',''[]''::jsonb)) r where (r->>''vigencia'')::date<=venc order by (r->>''vigencia'')::date desc limit 1;\n    if found then\n     if nullif(referencia->>''salario_minimo'','''') is null then continue;end if;\n     valor:=round((referencia->>''salario_minimo'')::numeric*percentual/100,2);\n    end if;\n   end if;\n   return next;');
  execute d;
 end if;
 select pg_get_functiondef('public.saas_salvar_grade_335(jsonb,integer)'::regprocedure) into d;
 if position('reajuste_341' in d)=0 then
  alvo:='grade:=public.saas_prever_contrato_335(_dados)->''parcelas'';';
  if position(alvo in d)=0 then raise exception 'Revise o salvamento da grade antes da fase341';end if;
  d:=replace(d,alvo,'_dados:=jsonb_set(_dados,''{servicos}'',public.saas_completar_servicos_341(_dados->''servicos'')); -- reajuste_341'||E'\n '||alvo);
  alvo:='id,descricao,tipo,periodicidade,valor,primeiro_vencimento,parcelas,observacao,ordem)';
  if position(alvo in d)=0 or position('coalesce(s->>''observacao'',''''),ord)' in d)=0 or position('ordem=excluded.ordem;' in d)=0 then raise exception 'Revise a gravação dos serviços antes da fase341';end if;
  d:=replace(d,alvo,'id,descricao,tipo,periodicidade,valor,primeiro_vencimento,parcelas,observacao,ordem,percentual_salario,reajustes)');
  d:=replace(d,'coalesce(s->>''observacao'',''''),ord)','coalesce(s->>''observacao'',''''),ord,nullif(s->>''percentual_salario'','''')::numeric,coalesce(s->''reajustes'',''[]''::jsonb))');
  d:=replace(d,'ordem=excluded.ordem;','ordem=excluded.ordem,percentual_salario=excluded.percentual_salario,reajustes=excluded.reajustes;');
  execute d;
 end if;
 select pg_get_functiondef('public.saas_painel_330()'::regprocedure) into d;
 if position('reajustes_pendentes' in d)=0 then
  alvo:='''itens_contrato'',(select';
  if position(alvo in d)=0 then raise exception 'Revise o painel SaaS antes da fase341';end if;
  d:=replace(d,alvo,'''reajustes_pendentes'',public.saas_reajustes_pendentes_341((select coalesce(jsonb_agg(to_jsonb(i)),''[]''::jsonb) from public.saas_itens_contrato_335 i)),'||E'\n '||alvo);
  execute d;
 end if;
end $$;

create or replace function public.saas_prever_contrato_335(_dados jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare grade jsonb;total numeric;servicos jsonb;
begin
 if not public.saas_proprietario_330() then raise exception 'Exclusivo do proprietário da plataforma' using errcode='42501';end if;
 if _dados is null or jsonb_typeof(_dados)<>'object' or length(_dados::text)>100000 then raise exception 'Configuração inválida';end if;
 servicos:=public.saas_completar_servicos_341(_dados->'servicos');
 select jsonb_agg(to_jsonb(g) order by g.vencimento,g.descricao),sum(g.valor) into grade,total from public.saas_calcular_grade_335((_dados->>'inicio')::date,(_dados->>'fim')::date,servicos)g;
 return jsonb_build_object('parcelas',coalesce(grade,'[]'),'total',coalesce(total,0),'reajustes_pendentes',public.saas_reajustes_pendentes_341(servicos));
end $$;
revoke all on function public.saas_prever_contrato_335(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.saas_prever_contrato_335(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
