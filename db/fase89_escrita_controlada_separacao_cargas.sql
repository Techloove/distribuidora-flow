-- Fase 89: escrita operacional de separação/cargas somente por funções controladas.
begin;

do $$
begin
  if to_regclass('public.pedido_separacoes') is not null then
    revoke insert, update, delete on public.pedido_separacoes from anon, authenticated;
  end if;
  if to_regclass('public.cargas') is not null then
    revoke insert, update, delete on public.cargas from anon, authenticated;
  end if;
  if to_regclass('public.carga_pedidos') is not null then
    revoke insert, update, delete on public.carga_pedidos from anon, authenticated;
  end if;
end $$;

-- A leitura permanece protegida pelo RLS da Fase 60.
-- As operações de negócio existentes (iniciar/concluir separação e fluxo de carga)
-- continuam sendo executadas por RPCs SECURITY DEFINER.

commit;
