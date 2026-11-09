-- Amplia apenas a identificação de despesas confirmadas. A ativação por loja usa a configuração existente.
begin;
create or replace function public.sicredi_despesa_identificada_347(_descricao text) returns boolean
language sql immutable set search_path=public as $$
 select coalesce(upper(_descricao) ~ '\m(TARIFA|TARIFAS|TAXA|TAXAS|DESPESA|DESPESAS|CUSTA|CUSTAS|EMOLUMENTO|EMOLUMENTOS)\M'
 and upper(_descricao) !~ '\m(ESTORNO|ESTORNADO|DEVOLUÇÃO|DEVOLUCAO|DESCONTO|ABATIMENTO)\M',false)
$$;
revoke all on function public.sicredi_despesa_identificada_347(text) from public,anon,authenticated,service_role;
do $$declare d text;alvo text;novo text;sig text;begin
 foreach sig in array array['public.sicredi_contabilizar_tarifa_282(uuid,date)','public.sicredi_tarifas_finalizar_280(uuid,jsonb,text)'] loop
  select pg_get_functiondef(sig::regprocedure) into d;
  if position('sicredi_despesa_identificada_347' in d)>0 then continue;end if;
  if sig like '%contabilizar%' then
   alvo:=$s$upper(v->>'descricao') ~ '\mTARIFA\M'$s$;
   if position(alvo in d)=0 then raise exception 'Revise o processador financeiro antes da fase347';end if;
   novo:=replace(d,alvo,$s$public.sicredi_despesa_identificada_347(v->>'descricao')$s$);
  else
   alvo:=$s$upper(r3->>'descricao') ~ '\mTARIFA\M'$s$;
   if position(alvo in d)=0 then raise exception 'Revise o cache bancário antes da fase347';end if;
   novo:=replace(d,alvo,$s$public.sicredi_despesa_identificada_347(r3->>'descricao')$s$);
   novo:=replace(novo,$s$upper(r3->>'descricao') !~ '\mTARIFA\M'$s$,$s$not public.sicredi_despesa_identificada_347(r3->>'descricao')$s$);
  end if;
  execute novo;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
