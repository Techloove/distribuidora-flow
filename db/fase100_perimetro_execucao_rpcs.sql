-- Fase 100: perimetro explicito de EXECUTE das RPCs criticas.
-- Remove o privilegio implicito de PUBLIC/anon e preserva acesso autenticado somente nas RPCs da aplicacao.
begin;

do $$
declare
  sig text;
  r regprocedure;
  funcoes text[] := array[
    'public.lancar_movimento_estoque(uuid,uuid,text,numeric,numeric,text,uuid,text)',
    'public.transferir_estoque(uuid,uuid,jsonb,text,text)',
    'public.receber_compra(uuid)',
    'public.confirmar_pedido(uuid)',
    'public.receber_titulo(uuid,numeric,date,uuid,uuid,numeric,numeric,numeric,text)',
    'public.pagar_titulo(uuid,numeric,date,uuid,uuid,numeric,numeric,numeric,text)',
    'public.pagar_comissoes(uuid,uuid[],date,uuid,uuid,uuid,text)',
    'public.criar_despesa(uuid,uuid,uuid,text,text,numeric,integer,date,integer,uuid,uuid)',
    'public.cancelar_titulo(text,uuid,text)',
    'public.transferir_entre_contas(uuid,uuid,numeric,date,text)',
    'public.lancar_movimento(uuid,text,numeric,date,uuid,uuid,text,text)',
    'public.emitir_boleto(uuid)',
    'public.liquidar_boleto(uuid,numeric,date)',
    'public.estornar_movimento_financeiro(uuid,text)',
    'public.estornar_transferencia_financeira(uuid,text)',
    'public.atualizar_status_comissao(uuid,text)',
    'public.criar_credito_devolucao(uuid,uuid,uuid,numeric,text)',
    'public.aplicar_credito_cliente(uuid,uuid,numeric,text)',
    'public.aplicar_creditos_cliente_pedido(uuid,numeric,text)',
    'public.cancelar_aplicacao_credito(uuid)',
    'public.confirmar_devolucao(uuid)',
    'public.cancelar_devolucao(uuid)',
    'public.cancelar_pedido(uuid)',
    'public.migrar_credito_dev(uuid)',
    'public.criar_pedido_rascunho(uuid,uuid,uuid,uuid,date,text,uuid,date)',
    'public.atualizar_pedido_comercial(uuid,uuid,numeric,numeric,numeric)',
    'public.adicionar_item_pedido(uuid,uuid,numeric,numeric,numeric)',
    'public.atualizar_item_pedido(uuid,numeric,numeric,numeric)',
    'public.remover_item_pedido(uuid)',
    'public.atualizar_dados_expedicao(uuid,uuid,text,text,date,numeric,numeric,uuid,text,text)'
  ];
begin
  foreach sig in array funcoes loop
    r := to_regprocedure(sig);
    if r is not null then
      execute format('revoke execute on function %s from public', r);
      execute format('revoke execute on function %s from anon', r);
      execute format('grant execute on function %s to authenticated', r);
      execute format('grant execute on function %s to service_role', r);
    end if;
  end loop;
end $$;

-- Helpers internos nao devem ser expostos ao cliente autenticado.
do $$
declare
  r regprocedure;
begin
  r := to_regprocedure('public.restaurar_creditos_cancelamento_pedido(uuid)');
  if r is not null then
    execute format('revoke execute on function %s from public, anon, authenticated', r);
  end if;

  r := to_regprocedure('public.registrar_movimento_estoque_controlado(uuid,uuid,text,numeric,numeric,text,uuid,text)');
  if r is not null then
    execute format('revoke execute on function %s from public, anon, authenticated', r);
  end if;
end $$;

-- Garante que a assinatura legada sem chave de idempotencia nao reapareca.
drop function if exists public.transferir_estoque(uuid,uuid,jsonb,text);

commit;
