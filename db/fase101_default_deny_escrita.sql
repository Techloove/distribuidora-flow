-- Fase 101: escrita direta negada por padrao nas tabelas transacionais protegidas.
-- Fluxos de negocio devem passar pelas RPCs controladas.
begin;

do $$
declare
  t text;
  tabelas text[] := array[
    'pedidos',
    'pedido_itens',
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
    'estornos_financeiros'
  ];
begin
  foreach t in array tabelas loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke insert, update, delete on table public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- Novas funcoes criadas pelo mesmo owner passam a nascer sem EXECUTE para PUBLIC.
-- RPCs publicas precisam de GRANT explicito na propria migration.
alter default privileges in schema public revoke execute on functions from public;

commit;
