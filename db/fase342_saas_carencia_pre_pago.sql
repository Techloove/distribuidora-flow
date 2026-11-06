-- Carência inicial gratuita e indicação dos ciclos pré-pagos. Não altera cobranças existentes.
begin;
alter table public.saas_itens_contrato_335 add column if not exists carencia_inicial_dias integer check(carencia_inicial_dias between 0 and 365);
create or replace function public.saas_preparar_carencia_342(_servicos jsonb,_inicio date) returns jsonb
language plpgsql immutable set search_path=public as $$
declare s jsonb;dias integer;resultado jsonb:='[]'::jsonb;
begin
 if jsonb_typeof(_servicos) is distinct from 'array' then return _servicos;end if;
 for s in select * from jsonb_array_elements(_servicos) loop
  dias:=nullif(s->>'carencia_inicial_dias','')::integer;
  if dias is not null then
   if dias not between 0 and 365 or s->>'tipo' is distinct from 'mensalidade' or s->>'periodicidade' is distinct from 'mensal' then raise exception 'Carência gratuita exige assinatura mensal e de 0 a 365 dias';end if;
   s:=jsonb_set(s,'{primeiro_vencimento}',to_jsonb((_inicio+dias)::text));
  end if;
  resultado:=resultado||jsonb_build_array(s);
 end loop;
 return resultado;
end $$;
revoke all on function public.saas_preparar_carencia_342(jsonb,date) from public,anon,authenticated,service_role;
do $$declare d text;alvo text;novo text;begin
 select pg_get_functiondef('public.saas_completar_servicos_341(jsonb)'::regprocedure) into d;
 if position('carencia_inicial_dias' in d)=0 then
  alvo:='''percentual_salario'',i.percentual_salario';
  if position(alvo in d)=0 then raise exception 'Revise a preservação de serviços antes da fase342';end if;
  execute replace(d,alvo,'''carencia_inicial_dias'',i.carencia_inicial_dias,'||alvo);
 end if;
 select pg_get_functiondef('public.saas_calcular_grade_335(date,date,jsonb)'::regprocedure) into d;
 if position('carencia_342' in d)=0 then
  alvo:=' for s in select * from jsonb_array_elements(_servicos) loop';
  if position(alvo in d)=0 then raise exception 'Revise o cálculo da grade antes da fase342';end if;
  execute replace(d,alvo,' _servicos:=public.saas_preparar_carencia_342(_servicos,_inicio); -- carencia_342'||E'\n'||alvo);
 end if;
 select pg_get_functiondef('public.saas_prever_contrato_335(jsonb)'::regprocedure) into d;
 if position('carencia_342' in d)=0 then
  alvo:='servicos:=public.saas_completar_servicos_341(_dados->''servicos'');';
  if position(alvo in d)=0 then raise exception 'Revise a prévia antes da fase342';end if;
  execute replace(d,alvo,'servicos:=public.saas_preparar_carencia_342(public.saas_completar_servicos_341(_dados->''servicos''),(_dados->>''inicio'')::date); -- carencia_342');
 end if;
 select pg_get_functiondef('public.saas_salvar_grade_335(jsonb,integer)'::regprocedure) into d;
 if position('carencia_342' in d)=0 then
  alvo:='public.saas_completar_servicos_341(_dados->''servicos'')';
  if position(alvo in d)=0 then raise exception 'Revise o salvamento antes da fase342';end if;
  d:=replace(d,alvo,'public.saas_preparar_carencia_342(public.saas_completar_servicos_341(_dados->''servicos''),(_dados->>''inicio'')::date)');
  alvo:='ordem,percentual_salario,reajustes)';
  if position(alvo in d)=0 or position('coalesce(s->''reajustes'',''[]''::jsonb))' in d)=0 or position('reajustes=excluded.reajustes;' in d)=0 then raise exception 'Revise a gravação dos serviços antes da fase342';end if;
  d:=replace(d,alvo,'ordem,percentual_salario,reajustes,carencia_inicial_dias)');
  d:=replace(d,'coalesce(s->''reajustes'',''[]''::jsonb))','coalesce(s->''reajustes'',''[]''::jsonb),nullif(s->>''carencia_inicial_dias'','''')::integer)');
  d:=replace(d,'reajustes=excluded.reajustes;','reajustes=excluded.reajustes,carencia_inicial_dias=excluded.carencia_inicial_dias; -- carencia_342');
  execute d;
 end if;
 select pg_get_functiondef('public.saas_painel_330()'::regprocedure) into d;
 if position('periodo_inicio' in d)=0 then
  alvo:='to_jsonb(p)||jsonb_build_object(''descricao''';
  if position(alvo in d)=0 or position('left join public.saas_grade_335 g on g.chave=p.chave' in d)=0 then raise exception 'Revise os ciclos da assinatura no painel antes da fase342';end if;
  novo:='to_jsonb(p)||jsonb_build_object(''periodo_inicio'',case when g.tipo=''mensalidade'' and i.periodicidade=''mensal'' then p.vencimento end,''periodo_fim'',case when g.tipo=''mensalidade'' and i.periodicidade=''mensal'' then least((select fim from public.saas_contrato_330),(i.primeiro_vencimento+p.parcela*interval ''1 month'')::date-1) end,''descricao''';
  d:=replace(d,alvo,novo);
  d:=replace(d,'left join public.saas_grade_335 g on g.chave=p.chave','left join public.saas_grade_335 g on g.chave=p.chave left join public.saas_itens_contrato_335 i on i.id=g.servico_id');
  execute d;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
