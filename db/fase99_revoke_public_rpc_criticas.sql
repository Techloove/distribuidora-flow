-- Fase 99: fecha privilégios implícitos de execução em RPCs financeiras/operacionais críticas.
-- PostgreSQL concede EXECUTE a PUBLIC por padrão em funções novas; GRANT para authenticated não revoga esse privilégio.
begin;

revoke all on function public.transferir_estoque(uuid,uuid,jsonb,text,text) from public;
grant execute on function public.transferir_estoque(uuid,uuid,jsonb,text,text) to authenticated;

revoke all on function public.emitir_boleto(uuid) from public;
grant execute on function public.emitir_boleto(uuid) to authenticated;
revoke all on function public.liquidar_boleto(uuid,numeric,date) from public;
grant execute on function public.liquidar_boleto(uuid,numeric,date) to authenticated;

revoke all on function public.cancelar_pedido(uuid) from public;
grant execute on function public.cancelar_pedido(uuid) to authenticated;
revoke all on function public.confirmar_devolucao(uuid) from public;
grant execute on function public.confirmar_devolucao(uuid) to authenticated;
revoke all on function public.cancelar_devolucao(uuid) from public;
grant execute on function public.cancelar_devolucao(uuid) to authenticated;

revoke all on function public.pagar_comissoes(uuid,uuid[],date,uuid,uuid,uuid,text) from public;
grant execute on function public.pagar_comissoes(uuid,uuid[],date,uuid,uuid,uuid,text) to authenticated;

revoke all on function public.estornar_movimento_financeiro(uuid,text) from public;
grant execute on function public.estornar_movimento_financeiro(uuid,text) to authenticated;
revoke all on function public.estornar_transferencia_financeira(uuid,text) from public;
grant execute on function public.estornar_transferencia_financeira(uuid,text) to authenticated;

commit;