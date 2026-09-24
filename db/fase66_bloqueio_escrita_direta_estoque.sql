-- Fase 66: fechar escrita direta de movimentos de estoque.
-- Toda mutacao de estoque autenticada deve passar por RPC/fluxos controlados.

begin;

revoke insert, update, delete on public.estoque_movimentos from authenticated;

-- Mantem leitura para telas e relatorios; escritas continuam disponiveis
-- para funcoes SECURITY DEFINER do ERP e service_role.
grant select on public.estoque_movimentos to authenticated;

commit;
