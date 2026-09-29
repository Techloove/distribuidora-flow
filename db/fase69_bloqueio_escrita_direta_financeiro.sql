-- Fase 69: fechar escrita direta no financeiro.
-- Titulos e comissoes devem ser alterados por RPCs controladas.

begin;

revoke insert, update, delete on public.contas_receber from authenticated;
revoke insert, update, delete on public.contas_pagar from authenticated;
revoke insert, update, delete on public.comissoes from authenticated;

grant select on public.contas_receber to authenticated;
grant select on public.contas_pagar to authenticated;
grant select on public.comissoes to authenticated;

commit;
