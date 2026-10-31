-- A coluna bancária "conta" e a variável homônima não podem disputar a referência.
-- Preserva valores, permissões e regras de baixa; apenas qualifica a conta selecionada.
begin;
do $$declare d text;antigo text:='select centro_id into conta_centro from public.contas_financeiras where id=conta and ativo;';begin
 select pg_get_functiondef('public.pagar_titulo(uuid,numeric,date,uuid,uuid,numeric,numeric,numeric,text)'::regprocedure) into d;
 d:=replace(d,E'\r\n',E'\n');
 if position('<<pagamento_301>>' in d)=0 then
  if position(antigo in d)=0 or position(E'AS $function$\ndeclare' in d)=0 then raise exception 'Motor de pagamento incompatível com a fase301';end if;
  d:=replace(d,E'AS $function$\ndeclare',E'AS $function$\n<<pagamento_301>>\ndeclare');
  d:=replace(d,antigo,'select cf.centro_id into conta_centro from public.contas_financeiras cf where cf.id=pagamento_301.conta and cf.ativo;');
  execute d;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
