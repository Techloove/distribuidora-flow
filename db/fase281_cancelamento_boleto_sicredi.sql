-- Executar inteiro antes de publicar a versão1.6.0.
-- Registra pedido de baixa aceito sem reabrir boleto já baixado/liquidado.
-- Não envia pedidos ao banco, não cancela boletos nem altera títulos na instalação.
begin;
do $$begin
 if to_regprocedure('public.sincronizar_boleto_sicredi_servidor(uuid,uuid,text,jsonb)') is null then
 raise exception 'Confira a persistência Sicredi da fase123 antes da fase281';end if;
end $$;
create or replace function public.sicredi_registrar_pedido_baixa_281(_actor uuid,_boleto uuid,_retorno jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare b public.boletos;begin
 if coalesce(auth.role(),'')<>'service_role' or not exists(select 1 from public.profiles where id=_actor and ativo) then
 raise exception 'Operação exclusiva do servidor ativo';end if;
 select * into b from public.boletos where id=_boleto for update;
 if b.id is null or not coalesce(public.ator_financeiro_pode_acessar_centro(_actor,b.centro_id),false) then raise exception 'Sem acesso ao boleto';end if;
 if b.banco is distinct from 'sicredi' or b.canal is distinct from 'api' then raise exception 'Pedido de baixa exige boleto API Sicredi';end if;
 if _retorno is null or jsonb_typeof(_retorno)<>'object' then raise exception 'Retorno inválido';end if;
 -- A consulta automática pode ter confirmado baixa/pagamento enquanto o PATCH estava em trânsito.
 -- Nunca altera o status aqui: somente a consulta bancária confirma o resultado.
 if b.status='registrado' then
  update public.boletos set retorno=jsonb_build_object('resposta_baixa',_retorno,'cancelamento_sicredi_pendente',true) where id=b.id;
 elsif b.status not in('baixado','cancelado','liquidado') then raise exception 'Estado do boleto incompatível';end if;
 insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id) values('boletos',b.id,'pedido_baixa_sicredi_281',
 jsonb_build_object('resposta_baixa',_retorno,'status_preservado',b.status),_actor);
end $$;
revoke all on function public.sicredi_registrar_pedido_baixa_281(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sicredi_registrar_pedido_baixa_281(uuid,uuid,jsonb) to service_role;
-- Uma consulta iniciada antes da confirmação automática também não pode reabrir um estado terminal.
do $$declare d text;alvo text:='if b.status=''liquidado'' then';begin
 select pg_get_functiondef('public.sincronizar_boleto_sicredi_servidor(uuid,uuid,text,jsonb)'::regprocedure) into d;
 if position('terminal_guard_281' in d)=0 then
  if position(alvo in d)=0 then raise exception 'Revise o sincronizador Sicredi antes da fase281';end if;
  execute replace(d,alvo,$patch$-- terminal_guard_281
  if b.status in ('baixado','cancelado') and _status='registrado' then
    raise exception 'Boleto com baixa/cancelamento confirmado não pode ser reaberto pela consulta';
  end if;
  if b.status='liquidado' then$patch$);
 end if;
end $$;
notify pgrst,'reload schema';
commit;
