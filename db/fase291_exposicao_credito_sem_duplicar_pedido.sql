-- Conta o pedido uma única vez: antes das parcelas, usa o total; depois, o saldo dos títulos.
begin;
do $migration$
declare d text;
 alvo text := 'aberto + ped.total_liquido';
 novo text := '(aberto + case when exists (select 1 from public.contas_receber cr291 where cr291.pedido_id=ped.id and cr291.cliente_id=ped.cliente_id and cr291.ciclo_pedido_289=ped.ciclo_reabertura_289 and cr291.status<>''cancelado'') then 0 else ped.total_liquido end)';
begin
 select pg_get_functiondef('public.validar_pedido(uuid)'::regprocedure) into d;
 if position('cr291' in d)=0 then
  if (length(d)-length(replace(d,alvo,'')))/length(alvo)<>2 then
   raise exception 'Revise o cálculo de exposição antes de aplicar a fase291';
  end if;
  execute replace(d,alvo,novo);
 end if;
end $migration$;
notify pgrst,'reload schema';
commit;
