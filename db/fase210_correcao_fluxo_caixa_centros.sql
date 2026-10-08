-- Correção da rotina existente: mantém as seis colunas originais e acrescenta o centro.
-- Não altera títulos, baixas, estoque, configuração ou sequências Sicredi.
begin;

create or replace view public.vw_fluxo_caixa with (security_invoker = on) as
select
  to_char(vencimento, 'YYYY-MM') as periodo,
  sum(case when status not in ('cancelado', 'pago') then valor + coalesce(juros,0) + coalesce(multa,0) + coalesce(acrescimo,0) - coalesce(desconto,0) - coalesce(valor_pago,0) else 0 end) as previsto_entrada,
  sum(valor_pago) as realizado_entrada,
  0::numeric as previsto_saida,
  0::numeric as realizado_saida,
  centro_id
from public.contas_receber
group by 1, centro_id
union all
select
  to_char(vencimento, 'YYYY-MM'),
  0::numeric,
  0::numeric,
  sum(case when status not in ('cancelado', 'pago') then valor + coalesce(juros,0) + coalesce(multa,0) + coalesce(acrescimo,0) - coalesce(desconto,0) - coalesce(valor_pago,0) else 0 end),
  sum(valor_pago),
  centro_id
from public.contas_pagar
group by 1, centro_id;

revoke all on public.vw_fluxo_caixa from public, anon;
grant select on public.vw_fluxo_caixa to authenticated;

-- As views existentes conservam campos e dependências; só muda o dia de referência.
do $$
declare nome text; definicao text;
begin
  foreach nome in array array['vw_titulos_receber','vw_titulos_pagar'] loop
    if to_regclass('public.' || nome) is not null then
      definicao := pg_get_viewdef(to_regclass('public.' || nome), true);
      definicao := regexp_replace(definicao, '\mCURRENT_DATE\M', '(now() at time zone ''America/Sao_Paulo'')::date', 'gi');
      execute format('create or replace view public.%I with(security_invoker=on) as %s', nome, definicao);
    end if;
  end loop;
end $$;
notify pgrst, 'reload schema';
commit;
