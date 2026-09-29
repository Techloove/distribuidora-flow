-- Fase 99: fecha EXECUTE implícito de PUBLIC nas RPCs críticas.
-- PostgreSQL concede EXECUTE em novas funções a PUBLIC por padrão; as RPCs abaixo
-- devem ser chamáveis apenas por usuários autenticados e continuam validando papel/centro internamente.
begin;

revoke all on function public.pagar_comissoes(uuid,uuid[],date,uuid,uuid,uuid,text) from public;
grant execute on function public.pagar_comissoes(uuid,uuid[],date,uuid,uuid,uuid,text) to authenticated;

revoke all on function public.transferir_estoque(uuid,uuid,jsonb,text,text) from public;
grant execute on function public.transferir_estoque(uuid,uuid,jsonb,text,text) to authenticated;

revoke all on function public.cancelar_pedido(uuid) from public;
revoke all on function public.confirmar_devolucao(uuid) from public;
revoke all on function public.cancelar_devolucao(uuid) from public;
grant execute on function public.cancelar_pedido(uuid) to authenticated;
grant execute on function public.confirmar_devolucao(uuid) to authenticated;
grant execute on function public.cancelar_devolucao(uuid) to authenticated;

revoke all on function public.receber_compra(uuid) from public;
revoke all on function public.confirmar_pedido(uuid) from public;
revoke all on function public.receber_titulo(uuid,numeric,date,uuid,uuid,numeric,numeric,numeric,text) from public;
revoke all on function public.pagar_titulo(uuid,numeric,date,uuid,uuid,numeric,numeric,numeric,text) from public;
revoke all on function public.criar_despesa(uuid,uuid,uuid,text,text,numeric,integer,date,integer,uuid,uuid) from public;
revoke all on function public.cancelar_titulo(text,uuid,text) from public;
grant execute on function public.receber_compra(uuid) to authenticated;
grant execute on function public.confirmar_pedido(uuid) to authenticated;
grant execute on function public.receber_titulo(uuid,numeric,date,uuid,uuid,numeric,numeric,numeric,text) to authenticated;
grant execute on function public.pagar_titulo(uuid,numeric,date,uuid,uuid,numeric,numeric,numeric,text) to authenticated;
grant execute on function public.criar_despesa(uuid,uuid,uuid,text,text,numeric,integer,date,integer,uuid,uuid) to authenticated;
grant execute on function public.cancelar_titulo(text,uuid,text) to authenticated;

revoke all on function public.transferir_entre_contas(uuid,uuid,numeric,date,text) from public;
revoke all on function public.lancar_movimento(uuid,text,numeric,date,uuid,uuid,text,text) from public;
grant execute on function public.transferir_entre_contas(uuid,uuid,numeric,date,text) to authenticated;
grant execute on function public.lancar_movimento(uuid,text,numeric,date,uuid,uuid,text,text) to authenticated;

revoke all on function public.emitir_boleto(uuid) from public;
revoke all on function public.liquidar_boleto(uuid,numeric,date) from public;
grant execute on function public.emitir_boleto(uuid) to authenticated;
grant execute on function public.liquidar_boleto(uuid,numeric,date) to authenticated;

commit;