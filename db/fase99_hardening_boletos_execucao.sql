-- Fase 99: fecha concorrencia de boletos e endurece EXECUTE de RPCs criticas.
begin;

-- Um titulo nao pode ter dois boletos ativos, mesmo sob chamadas concorrentes.
do $$
declare v_count bigint;
begin
  select count(*) into v_count from (
    select conta_receber_id
    from public.boletos
    where conta_receber_id is not null
      and status in ('pendente','em_processamento','registrado','liquidado')
    group by conta_receber_id
    having count(*) > 1
  ) d;
  if v_count > 0 then
    raise exception 'Existem % titulos com mais de um boleto ativo. Corrija-os antes de aplicar a Fase 99.', v_count;
  end if;
end $$;

create unique index if not exists boletos_conta_ativa_uq
  on public.boletos(conta_receber_id)
  where conta_receber_id is not null
    and status in ('pendente','em_processamento','registrado','liquidado');

-- PostgreSQL concede EXECUTE a PUBLIC por padrao em novas funcoes.
-- Mantemos as RPCs sensiveis disponiveis apenas para usuarios autenticados;
-- as funcoes continuam fazendo autorizacao interna por papel/centro.
revoke all on function public.receber_compra(uuid) from public;
revoke all on function public.confirmar_pedido(uuid) from public;
revoke all on function public.receber_titulo(uuid,numeric,date,uuid,uuid,numeric,numeric,numeric,text) from public;
revoke all on function public.pagar_titulo(uuid,numeric,date,uuid,uuid,numeric,numeric,numeric,text) from public;
revoke all on function public.criar_despesa(uuid,uuid,uuid,text,text,numeric,integer,date,integer,uuid,uuid) from public;
revoke all on function public.cancelar_titulo(text,uuid,text) from public;
revoke all on function public.criar_credito_devolucao(uuid,uuid,uuid,numeric,text) from public;
revoke all on function public.aplicar_credito_cliente(uuid,uuid,numeric,text) from public;
revoke all on function public.aplicar_creditos_cliente_pedido(uuid,numeric,text) from public;
revoke all on function public.cancelar_aplicacao_credito(uuid) from public;
revoke all on function public.migrar_credito_dev(uuid) from public;
revoke all on function public.emitir_boleto(uuid) from public;
revoke all on function public.liquidar_boleto(uuid,numeric,date) from public;
revoke all on function public.cancelar_pedido(uuid) from public;
revoke all on function public.confirmar_devolucao(uuid) from public;
revoke all on function public.cancelar_devolucao(uuid) from public;
revoke all on function public.transferir_estoque(uuid,uuid,jsonb,text,text) from public;

grant execute on function public.emitir_boleto(uuid) to authenticated;
grant execute on function public.liquidar_boleto(uuid,numeric,date) to authenticated;
grant execute on function public.cancelar_pedido(uuid) to authenticated;
grant execute on function public.confirmar_devolucao(uuid) to authenticated;
grant execute on function public.cancelar_devolucao(uuid) to authenticated;
grant execute on function public.transferir_estoque(uuid,uuid,jsonb,text,text) to authenticated;

commit;