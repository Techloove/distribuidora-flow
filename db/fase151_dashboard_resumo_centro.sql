-- Fase 151: dashboard agregado no banco e respeitando escopo de centro.
-- Evita somas no navegador sujeitas ao limite REST e usa estoque por centro.
begin;

create or replace function public.dashboard_resumo(_centro_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  resultado jsonb;
begin
  if not public.usuario_ativo() then
    raise exception 'Acesso nao autorizado' using errcode = '42501';
  end if;

  if _centro_id is not null and not public.usuario_pode_acessar_centro(_centro_id) then
    raise exception 'Centro nao autorizado' using errcode = '42501';
  end if;

  with pedidos_escopo as (
    select p.*
      from public.pedidos p
     where (_centro_id is null or p.centro_id = _centro_id)
       and public.usuario_pode_acessar_centro(p.centro_id)
  ),
  receber_escopo as (
    select greatest(
      coalesce(cr.valor,0)
      + coalesce(cr.juros,0)
      + coalesce(cr.multa,0)
      + coalesce(cr.acrescimo,0)
      - coalesce(cr.desconto,0)
      - coalesce(cr.valor_pago,0),
      0
    )::numeric as saldo,
    cr.vencimento
      from public.contas_receber cr
     where cr.status in ('aberto','parcial')
       and (_centro_id is null or cr.centro_id = _centro_id)
       and public.usuario_pode_acessar_centro(cr.centro_id)
  ),
  pagar_escopo as (
    select greatest(
      coalesce(cp.valor,0)
      + coalesce(cp.juros,0)
      + coalesce(cp.multa,0)
      + coalesce(cp.acrescimo,0)
      - coalesce(cp.desconto,0)
      - coalesce(cp.valor_pago,0),
      0
    )::numeric as saldo,
    cp.vencimento
      from public.contas_pagar cp
     where cp.status in ('aberto','parcial')
       and (_centro_id is null or cp.centro_id = _centro_id)
       and public.usuario_pode_acessar_centro(cp.centro_id)
  ),
  saldos_produto as (
    select es.produto_id, sum(es.quantidade)::numeric(14,3) as quantidade
      from public.estoque_saldos es
     where (_centro_id is null or es.centro_id = _centro_id)
       and public.usuario_pode_acessar_centro(es.centro_id)
     group by es.produto_id
  ),
  alertas as (
    select p.id, p.descricao,
           coalesce(s.quantidade,0)::numeric(14,3) as estoque_atual,
           coalesce(p.estoque_minimo,0)::numeric as estoque_minimo
      from public.produtos p
      left join saldos_produto s on s.produto_id = p.id
     where coalesce(p.ativo,true)
       and coalesce(s.quantidade,0) <= coalesce(p.estoque_minimo,0)
     order by coalesce(s.quantidade,0) - coalesce(p.estoque_minimo,0), p.id
     limit 8
  )
  select jsonb_build_object(
    'clientes', (
      select count(*)
        from public.clientes c
       where (_centro_id is null or c.centro_id = _centro_id)
         and (c.centro_id is null or public.usuario_pode_acessar_centro(c.centro_id))
    ),
    'produtos', (select count(*) from public.produtos p where coalesce(p.ativo,true)),
    'pedidosAbertos', (
      select count(*) from pedidos_escopo
       where status in ('rascunho','digitacao','aguardando_aprovacao')
    ),
    'vendasConfirmadas', (
      select coalesce(sum(total_liquido),0) from pedidos_escopo
       where status in (
         'confirmado','aprovado','separacao','separado','conferido',
         'faturado','nf_emitida','em_carga','em_rota','entregue',
         'parcial','nao_entregue'
       )
    ),
    'receber', (select coalesce(sum(saldo),0) from receber_escopo),
    'receberVencido', (
      select coalesce(sum(saldo),0) from receber_escopo where vencimento < current_date
    ),
    'pagar', (select coalesce(sum(saldo),0) from pagar_escopo),
    'pagarVencido', (
      select coalesce(sum(saldo),0) from pagar_escopo where vencimento < current_date
    ),
    'comissoes', (
      select coalesce(sum(c.valor),0)
        from public.comissoes c
        join pedidos_escopo p on p.id = c.pedido_id
       where c.status not in ('cancelada','paga')
    ),
    'alertas', (select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from alertas a)
  )
  into resultado;

  return resultado;
end;
$$;

revoke all on function public.dashboard_resumo(uuid) from public, anon;
grant execute on function public.dashboard_resumo(uuid) to authenticated;

commit;
