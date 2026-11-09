-- Transporte privado da automação para o servidor atual. Não altera segredo ou financeiro.
begin;
-- Autenticação privada própria, sem confundir a credencial do job com JWT de login no proxy.
do $$declare d text;sig text;alvo text:='''Authorization'',''Bearer ''||c.segredo';begin
 foreach sig in array array['public.sicredi_auto_disparar_247()','public.sicredi_tarifas_disparar_280()'] loop
  select pg_get_functiondef(sig::regprocedure) into d;
  if position('X-Sicredi-Automacao' in d)>0 then continue;end if;
  if position(alvo in d)=0 then raise exception 'Revise a autenticação do disparador %',sig;end if;
  execute replace(d,alvo,'''X-Sicredi-Automacao'',c.segredo');
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
