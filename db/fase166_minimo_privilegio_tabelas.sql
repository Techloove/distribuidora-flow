-- Fase 166: minimo privilegio de tabela alem do DML.
-- As fases anteriores ja bloqueiam INSERT/UPDATE/DELETE direto nas tabelas protegidas.
-- Esta fase remove tambem TRUNCATE/REFERENCES/TRIGGER do navegador, preservando SELECT
-- quando concedido por migrations anteriores e mantendo escritas apenas por RPCs controladas.
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
    'sicredi_config',
    'notas_saida'
  ];
begin
  foreach t in array tabelas loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    execute format(
      'revoke truncate, references, trigger on table public.%I from public, anon, authenticated',
      t
    );
  end loop;
end $$;

-- Gate: nenhum papel do cliente deve conservar privilegios estruturais nas tabelas protegidas.
do $$
declare
  t text;
  tabelas text[] := array[
    'pedidos','pedido_itens','compras','compra_itens',
    'estoque_movimentos','estoque_saldos','transferencias_estoque','transferencias_estoque_itens',
    'contas_receber','contas_pagar','comissoes','movimentos_financeiros','transferencias','boletos',
    'creditos_clientes','creditos_clientes_aplicacoes','expedicoes','pedido_separacoes',
    'cargas','carga_pedidos','estornos_financeiros','auditoria','pedido_operacoes',
    'devolucao_operacoes','comissao_pagamentos','comissao_pagamento_itens','user_roles',
    'sicredi_config','notas_saida'
  ];
begin
  foreach t in array tabelas loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    if has_table_privilege('anon','public.' || t,'TRUNCATE')
       or has_table_privilege('anon','public.' || t,'REFERENCES')
       or has_table_privilege('anon','public.' || t,'TRIGGER')
       or has_table_privilege('authenticated','public.' || t,'TRUNCATE')
       or has_table_privilege('authenticated','public.' || t,'REFERENCES')
       or has_table_privilege('authenticated','public.' || t,'TRIGGER') then
      raise exception 'Fase 166: privilegio estrutural de cliente ainda presente em public.%', t;
    end if;
  end loop;
end $$;

commit;
