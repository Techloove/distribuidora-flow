-- Fase 113: reconciliacao das alteracoes externas existentes na main com o hardening atual.
-- Evita que migrations antigas/concorrentes restabelecam semantica superada.
begin;

-- A Fase 77 da main criou unicidade absoluta de comissao por pedido.
-- O modelo atual permite manter historico cancelado, mas somente uma comissao ativa por pedido.
drop index if exists public.comissoes_pedido_uq;

do $$
declare v_count bigint;
begin
  select count(*) into v_count from (
    select pedido_id
    from public.comissoes
    where pedido_id is not null and status <> 'cancelada'
    group by pedido_id
    having count(*) > 1
  ) d;
  if v_count > 0 then
    raise exception 'Fase 113: existem % pedidos com mais de uma comissao ativa; saneie antes de continuar', v_count;
  end if;
end $$;

create unique index if not exists comissoes_pedido_ativa_uq
  on public.comissoes(pedido_id)
  where pedido_id is not null and status <> 'cancelada';

-- A Fase 78 da main ainda usa o modelo legado de credito negativo em contas_receber.
-- A definicao final de confirmar_devolucao precisa ser a arquitetura de creditos_clientes da Fase 80.
do $$
declare
  r regprocedure;
  definicao text;
begin
  r := to_regprocedure('public.confirmar_devolucao(uuid)');
  if r is null then
    raise exception 'Fase 113: confirmar_devolucao(uuid) ausente';
  end if;

  select pg_get_functiondef(r::oid) into definicao;
  -- A Fase 80 delega o credito a criar_credito_devolucao, que grava em creditos_clientes.
  if position('criar_credito_devolucao' in definicao) = 0
     or to_regprocedure('public.criar_credito_devolucao(uuid,uuid,uuid,numeric,text)') is null then
    raise exception 'Fase 113: confirmar_devolucao ainda esta na implementacao legada de credito financeiro';
  end if;
end $$;

-- Garante tambem que o indice parcial atual realmente existe.
do $$
begin
  if to_regclass('public.comissoes_pedido_ativa_uq') is null then
    raise exception 'Fase 113: indice comissoes_pedido_ativa_uq ausente';
  end if;
end $$;

commit;