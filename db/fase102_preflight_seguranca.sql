-- Fase 102: preflight de seguranca antes da homologacao/producao.
-- Nao altera dados; aborta a migration se uma protecao critica estiver ausente.
begin;

do $$
declare
  t text;
  r record;
  tabelas text[] := array[
    'pedidos','pedido_itens','estoque_movimentos','estoque_saldos',
    'transferencias_estoque','transferencias_estoque_itens',
    'contas_receber','contas_pagar','comissoes','movimentos_financeiros',
    'transferencias','boletos','creditos_clientes','creditos_clientes_aplicacoes',
    'expedicoes','pedido_separacoes','cargas','carga_pedidos','estornos_financeiros'
  ];
begin
  -- Tabelas transacionais existentes devem ter RLS habilitado e escrita direta negada.
  foreach t in array tabelas loop
    if to_regclass('public.' || t) is not null then
      select c.relrowsecurity into r
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=t;

      if not coalesce(r.relrowsecurity,false) then
        raise exception 'Preflight: RLS nao habilitado em public.%', t;
      end if;

      if has_table_privilege('authenticated', format('public.%I',t), 'INSERT')
         or has_table_privilege('authenticated', format('public.%I',t), 'UPDATE')
         or has_table_privilege('authenticated', format('public.%I',t), 'DELETE')
         or has_table_privilege('anon', format('public.%I',t), 'INSERT')
         or has_table_privilege('anon', format('public.%I',t), 'UPDATE')
         or has_table_privilege('anon', format('public.%I',t), 'DELETE') then
        raise exception 'Preflight: escrita direta ainda permitida em public.%', t;
      end if;
    end if;
  end loop;
end $$;

-- Assinaturas RPC obrigatorias.
do $$
declare
  sig text;
  funcoes text[] := array[
    'public.lancar_movimento_estoque(uuid,uuid,text,numeric,numeric,text,uuid,text)',
    'public.transferir_estoque(uuid,uuid,jsonb,text,text)',
    'public.confirmar_pedido(uuid)',
    'public.cancelar_pedido(uuid)',
    'public.receber_titulo(uuid,numeric,date,uuid,uuid,numeric,numeric,numeric,text)',
    'public.pagar_titulo(uuid,numeric,date,uuid,uuid,numeric,numeric,numeric,text)',
    'public.pagar_comissoes(uuid,uuid[],date,uuid,uuid,uuid,text)',
    'public.criar_despesa(uuid,uuid,uuid,text,text,numeric,integer,date,integer,uuid,uuid)',
    'public.cancelar_titulo(text,uuid,text)',
    'public.transferir_entre_contas(uuid,uuid,numeric,date,text)',
    'public.lancar_movimento(uuid,text,numeric,date,uuid,uuid,text,text)',
    'public.estornar_movimento_financeiro(uuid,text)',
    'public.estornar_transferencia_financeira(uuid,text)',
    'public.atualizar_status_comissao(uuid,text)',
    'public.emitir_boleto(uuid)',
    'public.liquidar_boleto(uuid,numeric,date)',
    'public.aplicar_creditos_cliente_pedido(uuid,numeric,text)',
    'public.confirmar_devolucao(uuid)',
    'public.cancelar_devolucao(uuid)',
    'public.atualizar_dados_expedicao(uuid,uuid,text,text,date,numeric,numeric,uuid,text,text)'
  ];
begin
  foreach sig in array funcoes loop
    if to_regprocedure(sig) is null then
      raise exception 'Preflight: RPC obrigatoria ausente: %', sig;
    end if;
  end loop;

  if to_regprocedure('public.transferir_estoque(uuid,uuid,jsonb,text)') is not null then
    raise exception 'Preflight: assinatura legada transferir_estoque(uuid,uuid,jsonb,text) ainda existe';
  end if;
end $$;

-- SECURITY DEFINER critico deve ter search_path fixado.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as assinatura, p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prosecdef
      and p.proname in (
        'lancar_movimento_estoque','transferir_estoque','confirmar_pedido','cancelar_pedido',
        'receber_titulo','pagar_titulo','pagar_comissoes','criar_despesa','cancelar_titulo',
        'transferir_entre_contas','lancar_movimento','emitir_boleto','liquidar_boleto',
        'estornar_movimento_financeiro','estornar_transferencia_financeira','atualizar_status_comissao',
        'criar_credito_devolucao','aplicar_credito_cliente','aplicar_creditos_cliente_pedido',
        'cancelar_aplicacao_credito','confirmar_devolucao','cancelar_devolucao','migrar_credito_dev',
        'criar_pedido_rascunho','atualizar_pedido_comercial','adicionar_item_pedido',
        'atualizar_item_pedido','remover_item_pedido','atualizar_dados_expedicao'
      )
  loop
    if not exists (
      select 1 from unnest(coalesce(f.proconfig,array[]::text[])) cfg
      where cfg like 'search_path=%'
    ) then
      raise exception 'Preflight: SECURITY DEFINER sem search_path controlado: %', f.assinatura;
    end if;
  end loop;
end $$;

commit;