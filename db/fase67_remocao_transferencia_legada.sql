-- Fase 67: impedir bypass da idempotencia de transferencias.
-- A Fase 55 criou a assinatura legada de 4 argumentos. Ela e removida
-- para que toda chamada use a assinatura com chave de idempotencia.

begin;

drop function if exists public.transferir_estoque(uuid, uuid, jsonb, text);

grant execute on function public.transferir_estoque(uuid, uuid, jsonb, text, text) to authenticated;

commit;
