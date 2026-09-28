-- Executar apos fase79. Agregacao no banco: totais nao dependem do limite REST de linhas.
begin;
create or replace function public.dashboard_resumo(_centro_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare resultado jsonb;
begin
  if not public.usuario_ativo() then raise exception 'Acesso nao autorizado' using errcode = '42501'; end if;
  if _centro_id is not null and not public.usuario_pode_acessar_centro(_centro_id) then
    raise exception 'Centro nao autorizado' using errcode = '42501';
  end if;
  with p as (
    select * from public.pedidos where (_centro_id is null or centro_id = _centro_id)
      and public.usuario_pode_acessar_centro(centro_id)
  ), r as (
    select greatest(valor + juros + multa + acrescimo - desconto - coalesce(valor_pago,0),0) saldo, vencimento
    from public.contas_receber where status in ('aberto','parcial')
      and (_centro_id is null or centro_id = _centro_id) and public.usuario_pode_acessar_centro(centro_id)
  ), a as (
    select greatest(valor + juros + multa + acrescimo - desconto - coalesce(valor_pago,0),0) saldo, vencimento
    from public.contas_pagar where status in ('aberto','parcial')
      and (_centro_id is null or centro_id = _centro_id) and public.usuario_pode_acessar_centro(centro_id)
  )
  select jsonb_build_object(
    'clientes', (select count(*) from public.clientes),
    'produtos', (select count(*) from public.produtos),
    'pedidosAbertos', (select count(*) from p where status in ('rascunho','digitacao')),
    'vendasConfirmadas', (select coalesce(sum(total_liquido),0) from p where status in ('confirmado','aprovado','separacao','separado','conferido','faturado','nf_emitida','em_carga','em_rota','entregue','parcial','nao_entregue')),
    'receber', (select coalesce(sum(saldo),0) from r),
    'receberVencido', (select coalesce(sum(saldo),0) from r where vencimento < (now() at time zone 'America/Sao_Paulo')::date),
    'pagar', (select coalesce(sum(saldo),0) from a),
    'pagarVencido', (select coalesce(sum(saldo),0) from a where vencimento < (now() at time zone 'America/Sao_Paulo')::date),
    'comissoes', (select coalesce(sum(c.valor),0) from public.comissoes c join p on p.id = c.pedido_id where c.status not in ('cancelada','paga')),
    'alertas', (select coalesce(jsonb_agg(x),'[]'::jsonb) from (
      select id, descricao, estoque_atual, estoque_minimo from public.produtos
      where estoque_atual <= estoque_minimo order by estoque_atual - estoque_minimo, id limit 8
    ) x)
  ) into resultado;
  return resultado;
end;
$$;
revoke all on function public.dashboard_resumo(uuid) from public, anon;
grant execute on function public.dashboard_resumo(uuid) to authenticated;
commit;
