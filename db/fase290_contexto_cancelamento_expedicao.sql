-- Autoriza o cancelamento validado antes de a expedição sincronizar o status do pedido.
-- Não executa cancelamentos nem reabre pedidos na instalação.
begin;
do $migration$
declare assinatura text; d text;
 marcador text:='perform set_config(''app.cancelamento_pedido_285'',_pedido::text,true);';
 alvo text:='update public.expedicoes set status=''cancelada'' where pedido_id=_pedido and status<>''cancelada'';';
begin
 foreach assinatura in array array['public.cancelar_pedido_admin_285(uuid,text)','public.cancelar_pedido_representante_286(uuid,text)'] loop
  select pg_get_functiondef(assinatura::regprocedure) into d;
  if position('contexto_expedicao_290' in d)=0 then
   if position(marcador in d)=0 or position(alvo in d)=0 or position(marcador in d)<position(alvo in d) then raise exception 'Revise a ordem do cancelamento antes de aplicar a fase290: %',assinatura;end if;
   d:=replace(d,marcador,'');
   d:=replace(d,alvo,'-- contexto_expedicao_290: validações e bloqueios já concluídos.'||E'\n '||marcador||E'\n '||alvo);
   execute d;
  end if;
 end loop;
end $migration$;
notify pgrst,'reload schema';
commit;
