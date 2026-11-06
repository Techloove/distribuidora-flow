-- Compatibilidade com safeupdate: toda atualização identifica explicitamente o contrato único.
-- Preserva autorização, revisão concorrente, geração das parcelas e histórico; não altera dados.
begin;
do $$
declare sig text;d text;alvo text;
begin
 foreach sig in array array[
  'public.saas_salvar_contrato_330(jsonb,integer)',
  'public.saas_salvar_servico_331(uuid,text,numeric,date,text,integer)',
  'public.saas_salvar_grade_335(jsonb,integer)',
  'public.saas_registrar_pagamento_330(text,text,date,text,uuid)'
 ] loop
  select pg_get_functiondef(sig::regprocedure) into d;
  alvo:=substring(d from 'update public[.]saas_contrato_330 set [^;]+;');
  if alvo is null then raise exception 'Revise a atualização do contrato em % antes da fase340',sig;end if;
  if position(' where ' in lower(alvo))=0 then
   execute replace(d,alvo,left(alvo,length(alvo)-1)||' where unico=true;');
  end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
