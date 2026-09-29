-- Fase 141: protege tabelas internas de auditoria/idempotencia contra escrita direta do cliente.
-- Essas tabelas sao mantidas exclusivamente pelos fluxos/RPCs controlados do ERP.
begin;

do $$
begin
  if to_regclass('public.auditoria') is not null then
    revoke insert, update, delete on public.auditoria from anon, authenticated;
  end if;

  if to_regclass('public.pedido_operacoes') is not null then
    revoke insert, update, delete on public.pedido_operacoes from anon, authenticated;
  end if;

  if to_regclass('public.devolucao_operacoes') is not null then
    revoke insert, update, delete on public.devolucao_operacoes from anon, authenticated;
  end if;

  if to_regclass('public.comissao_pagamentos') is not null then
    revoke insert, update, delete on public.comissao_pagamentos from anon, authenticated;
  end if;

  if to_regclass('public.comissao_pagamento_itens') is not null then
    revoke insert, update, delete on public.comissao_pagamento_itens from anon, authenticated;
  end if;
end $$;

-- Preflight: nenhuma tabela interna acima pode aceitar mutacao direta do navegador.
do $$
declare
  t text;
  tabelas text[] := array[
    'auditoria',
    'pedido_operacoes',
    'devolucao_operacoes',
    'comissao_pagamentos',
    'comissao_pagamento_itens'
  ];
begin
  foreach t in array tabelas loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    if has_table_privilege('anon', 'public.' || t, 'INSERT')
       or has_table_privilege('anon', 'public.' || t, 'UPDATE')
       or has_table_privilege('anon', 'public.' || t, 'DELETE')
       or has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || t, 'DELETE') then
      raise exception 'Fase 141: tabela interna % ainda permite escrita direta do cliente', t;
    end if;
  end loop;
end $$;

commit;