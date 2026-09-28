-- Fase 163: defesa em profundidade para escrita direta nas tabelas protegidas.
-- Alem dos REVOKEs de DML, cria policies RESTRICTIVE que negam INSERT/UPDATE/DELETE
-- ao navegador. As RPCs SECURITY DEFINER controladas continuam sendo o unico caminho de escrita.
begin;

do $$
declare
  t text;
  tabelas text[] := array[
    'pedidos',
    'pedido_itens',
    'compras',
    'compra_itens',
    'estoque_movimentos',
    'estoque_saldos',
    'transferencias_estoque',
    'transferencias_estoque_itens',
    'contas_receber',
    'contas_pagar',
    'comissoes',
    'movimentos_financeiros',
    'transferencias',
    'boletos',
    'creditos_clientes',
    'creditos_clientes_aplicacoes',
    'expedicoes',
    'pedido_separacoes',
    'cargas',
    'carga_pedidos',
    'estornos_financeiros',
    'auditoria',
    'pedido_operacoes',
    'devolucao_operacoes',
    'comissao_pagamentos',
    'comissao_pagamento_itens',
    'user_roles',
    'sicredi_config'
  ];
begin
  foreach t in array tabelas loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists deny_direct_insert on public.%I', t);
    execute format(
      'create policy deny_direct_insert on public.%I as restrictive for insert to anon, authenticated with check (false)',
      t
    );

    execute format('drop policy if exists deny_direct_update on public.%I', t);
    execute format(
      'create policy deny_direct_update on public.%I as restrictive for update to anon, authenticated using (false) with check (false)',
      t
    );

    execute format('drop policy if exists deny_direct_delete on public.%I', t);
    execute format(
      'create policy deny_direct_delete on public.%I as restrictive for delete to anon, authenticated using (false)',
      t
    );

    execute format(
      'revoke insert, update, delete on table public.%I from anon, authenticated',
      t
    );
  end loop;
end $$;

-- Preflight: nenhuma tabela protegida existente pode aceitar DML do cliente.
do $$
declare
  t text;
  tabelas text[] := array[
    'pedidos','pedido_itens','compras','compra_itens',
    'estoque_movimentos','estoque_saldos','transferencias_estoque','transferencias_estoque_itens',
    'contas_receber','contas_pagar','comissoes','movimentos_financeiros','transferencias','boletos',
    'creditos_clientes','creditos_clientes_aplicacoes','expedicoes','pedido_separacoes',
    'cargas','carga_pedidos','estornos_financeiros','auditoria','pedido_operacoes',
    'devolucao_operacoes','comissao_pagamentos','comissao_pagamento_itens','user_roles','sicredi_config'
  ];
begin
  foreach t in array tabelas loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    if has_table_privilege('anon','public.' || t,'INSERT')
       or has_table_privilege('anon','public.' || t,'UPDATE')
       or has_table_privilege('anon','public.' || t,'DELETE')
       or has_table_privilege('authenticated','public.' || t,'INSERT')
       or has_table_privilege('authenticated','public.' || t,'UPDATE')
       or has_table_privilege('authenticated','public.' || t,'DELETE') then
      raise exception 'Fase 163: privilegio DML direto ainda presente em public.%', t;
    end if;
  end loop;
end $$;

commit;
