-- Corrige CTEs materializadas na adaptação por modalidade e recompõe apenas o relatório.
-- Usa a definição atual do motor principal, preservando regras, assinatura e rentabilidade já corrigidas.
begin;
do $$declare d text;corpo text;novo text;item record;
 assinatura text:='public.relatorio_vendas_230(date,date,uuid,uuid,uuid,text,text,text,text,text,boolean,integer,integer)';
 alvo text:='as[[:space:]]*\(';padrao text:='as[[:space:]]*(?:(?:not[[:space:]]+)?materialized[[:space:]]*)?\(';
 mapa jsonb:='{"pedidos":"pedidos_mod_300","pedido_itens":"pedido_itens_mod_300","devolucoes":"devolucoes_mod_300","devolucao_itens":"devolucao_itens_mod_300","comissoes":"comissoes_mod_300"}';
begin
 if to_regprocedure(assinatura) is null or to_regprocedure('public.reescrever_leitura_300(text,jsonb)') is null then raise exception 'Instale as rotinas230 e300 antes da fase369';end if;
 select pg_get_functiondef('public.reescrever_leitura_300(text,jsonb)'::regprocedure) into d;
 if position(alvo in d)>0 then execute replace(d,alvo,padrao);
 elsif position(padrao in d)=0 then raise exception 'Revise o reconhecimento de CTEs antes de aplicar a fase369';end if;
 for item in select value as nome from jsonb_each_text(mapa) loop
  if to_regclass('public.'||item.nome) is null then raise exception 'Visão por modalidade ausente: %',item.nome;end if;
 end loop;
 select pg_get_functiondef(p.oid),p.prosrc into d,corpo from pg_proc p where p.oid=assinatura::regprocedure;
 novo:=public.reescrever_leitura_300(corpo,mapa);
 if position('pedidos_mod_300' in novo)=0 or position('devolucoes_mod_300' in novo)=0 then raise exception 'Recorte de modalidade não aplicado ao relatório';end if;
 d:=replace(d,corpo,novo);
 d:=regexp_replace(d,'FUNCTION public\.relatorio_vendas_230\(','FUNCTION public.relatorio_vendas_230_mod_300(');
 execute d;
 -- PUBLIC/anon não consultam o motor. Os demais acessos seguem os do relatório principal.
 revoke all on function public.relatorio_vendas_230_mod_300(date,date,uuid,uuid,uuid,text,text,text,text,text,boolean,integer,integer) from public,anon,authenticated,service_role;
 if has_function_privilege('authenticated',assinatura::regprocedure,'EXECUTE') then
  grant execute on function public.relatorio_vendas_230_mod_300(date,date,uuid,uuid,uuid,text,text,text,text,text,boolean,integer,integer) to authenticated;
 end if;
 if has_function_privilege('service_role',assinatura::regprocedure,'EXECUTE') then
  grant execute on function public.relatorio_vendas_230_mod_300(date,date,uuid,uuid,uuid,text,text,text,text,text,boolean,integer,integer) to service_role;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
