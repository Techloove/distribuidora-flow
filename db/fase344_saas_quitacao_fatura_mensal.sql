-- Quitação mensal atômica; conserva os eventos e vencimentos de cada serviço.
begin;
create table if not exists public.saas_pagamentos_fatura_344(
 requisicao uuid primary key,competencia date not null check(extract(day from competencia)=1),
 chaves text[] not null,valor numeric(14,2) not null check(valor>0),pagamento_data date not null,
 motivo text not null,autor uuid not null references public.profiles(id),criado_em timestamptz not null default now()
);
alter table public.saas_pagamentos_fatura_344 enable row level security;
revoke all on public.saas_pagamentos_fatura_344 from public,anon,authenticated,service_role;
drop trigger if exists saas_fatura_imutavel_344 on public.saas_pagamentos_fatura_344;
create trigger saas_fatura_imutavel_344 before update or delete or truncate on public.saas_pagamentos_fatura_344 for each statement execute function public.saas_proteger_historico_330();
create or replace function public.saas_quitar_fatura_344(_competencia date,_chaves text[],_valor numeric,_data date,_motivo text,_requisicao uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare anterior public.saas_pagamentos_fatura_344;esperadas text[];pendentes text[];total numeric;
begin
 if not public.saas_proprietario_330() then raise exception 'Exclusivo do proprietário da plataforma' using errcode='42501';end if;
 perform 1 from public.saas_contrato_330 where unico=true for update;
 if _requisicao is null or _competencia is null or _competencia<>date_trunc('month',_competencia)::date
 or _chaves is null or cardinality(_chaves) not between 1 and 2000 or array_position(_chaves,null) is not null
 or _valor is null or _valor::text in('NaN','Infinity','-Infinity') or _valor<=0 or round(_valor,2)<>_valor
 or _data is null or _data>(now() at time zone 'America/Sao_Paulo')::date or _data<'2020-01-01'
 or length(btrim(coalesce(_motivo,''))) not between 5 and 1000 then raise exception 'Confira competência, itens, valor, data e referência do pagamento da fatura';end if;
 select array_agg(k order by k) into esperadas from unnest(_chaves) k;
 if cardinality(esperadas)<>(select count(distinct k) from unnest(esperadas) k) then raise exception 'A fatura não pode conter itens repetidos';end if;
 select * into anterior from public.saas_pagamentos_fatura_344 where requisicao=_requisicao;
 if found then
  if anterior.competencia is distinct from _competencia or anterior.chaves is distinct from esperadas or anterior.valor is distinct from _valor or anterior.pagamento_data is distinct from _data or anterior.motivo is distinct from btrim(_motivo) then
   raise exception 'Identificador de pagamento já usado para outra operação';end if;
  return public.saas_painel_330();
 end if;
 select array_agg(p.chave order by p.chave),sum(p.valor) into pendentes,total from public.saas_parcelas_330() p
 where p.competencia=_competencia and p.estado not in('pago','cancelado');
 if pendentes is null then raise exception 'Fatura já quitada ou sem saldo pendente. Atualize a lista';end if;
 if pendentes is distinct from esperadas or total is distinct from _valor then raise exception 'Fatura alterada. Atualize a lista e confira novamente todos os itens e o saldo da competência';end if;
 insert into public.saas_pagamentos_fatura_344(requisicao,competencia,chaves,valor,pagamento_data,motivo,autor)
 values(_requisicao,_competencia,pendentes,total,_data,btrim(_motivo),auth.uid());
 insert into public.saas_eventos_330(requisicao,chave,acao,valor,vencimento,pagamento_data,motivo,autor,detalhe)
 select md5(_requisicao::text||':'||p.chave)::uuid,p.chave,'pago',p.valor,p.vencimento,_data,btrim(_motivo),auth.uid(),jsonb_build_object('fatura_requisicao',_requisicao,'competencia',_competencia)
 from public.saas_parcelas_330() p where p.chave=any(pendentes);
 update public.saas_contrato_330 set ativado_em=coalesce(ativado_em,now()),revisao=revisao+1 where unico=true;
 return public.saas_painel_330();
end $$;
revoke all on function public.saas_quitar_fatura_344(date,text[],numeric,date,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.saas_quitar_fatura_344(date,text[],numeric,date,text,uuid) to authenticated;
do $$declare d text;alvo text;begin
 select pg_get_functiondef('public.saas_pre_request_330()'::regprocedure) into d;
 if position('/rpc/saas_quitar_fatura_344' in d)=0 then
  alvo:='''/rpc/saas_salvar_grade_335'']';
  if position(alvo in d)=0 then raise exception 'Revise o acesso de regularização antes da fase344';end if;
  execute replace(d,alvo,'''/rpc/saas_salvar_grade_335'',''/rpc/saas_quitar_fatura_344'']');
 end if;
end $$;
notify pgrst,'reload schema';
commit;
