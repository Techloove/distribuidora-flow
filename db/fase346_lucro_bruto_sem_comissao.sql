-- Corrige somente a apuração de leitura. Não altera pedidos, custos históricos ou comissões.
begin;
do $$declare d text;alvo text:='vendas-custo-comissao lucro_bruto_com';begin
 select pg_get_functiondef('public.relatorio_vendas_230(date,date,uuid,uuid,uuid,text,text,text,text,text,boolean,integer,integer)'::regprocedure) into d;
 if position(alvo in d)>0 then
  -- Preserva a chave legada usada por clientes antigos e pela ordenação, com conceito bruto correto.
  execute replace(d,alvo,'vendas-custo lucro_bruto_com');
 elsif position('vendas-custo lucro_bruto_com' in d)=0 then
  raise exception 'Revise a apuração do lucro bruto do relatório antes da fase346';
 end if;
end $$;
notify pgrst,'reload schema';
commit;
