-- Fase 15: corrige ambiguidade de resolver_comissao + credito do cliente e rota automatica
-- Idempotente: pode ser executado novamente sem efeitos colaterais.

-- -------------------------------------------------------------
-- 1. ERRO "function public.resolver_comissao(uuid, uuid, date) is not unique"
--    Existiam duas versoes da funcao (3 e 5 argumentos). Remove a antiga.
-- -------------------------------------------------------------
drop function if exists public.resolver_comissao(uuid, uuid, date);
grant execute on function public.resolver_comissao(uuid, uuid, date, uuid, numeric) to authenticated;

-- -------------------------------------------------------------
-- 2. ROTA NO CLIENTE (para preencher automaticamente no pedido)
-- -------------------------------------------------------------
alter table public.clientes add column if not exists rota_id uuid references public.rotas(id);
alter table public.clientes add column if not exists sequencia_entrega integer;
create index if not exists clientes_rota_idx on public.clientes(rota_id);

-- replica a rota definida no cadastro unificado
update public.clientes c
   set rota_id = p.rota_id,
       sequencia_entrega = coalesce(c.sequencia_entrega, p.sequencia_entrega)
  from public.pessoas p
 where p.id = c.pessoa_id and p.rota_id is not null and c.rota_id is null;

-- -------------------------------------------------------------
-- 3. RESUMO DE CREDITO DO CLIENTE
-- -------------------------------------------------------------
create or replace view public.vw_cliente_credito as
select c.id                                        as cliente_id,
       c.razao_social,
       coalesce(c.limite_credito, 0)                as limite_credito,
       coalesce(t.em_aberto, 0)                     as em_aberto,
       coalesce(t.vencido, 0)                       as vencido,
       coalesce(t.parcelas_abertas, 0)              as parcelas_abertas,
       coalesce(t.parcelas_vencidas, 0)             as parcelas_vencidas,
       coalesce(c.limite_credito, 0) - coalesce(t.em_aberto, 0) as limite_disponivel
  from public.clientes c
  left join (
    select cr.cliente_id,
           sum((cr.valor - coalesce(cr.valor_pago, 0)))            as em_aberto,
           count(*)                                                                  as parcelas_abertas,
           sum(case when cr.vencimento < current_date
                    then (cr.valor - coalesce(cr.valor_pago, 0))
                    else 0 end)                                                      as vencido,
           count(*) filter (where cr.vencimento < current_date)                       as parcelas_vencidas
      from public.contas_receber cr
     where (cr.valor - coalesce(cr.valor_pago, 0)) > 0
       and coalesce(cr.status, 'aberto') <> 'cancelado'
     group by cr.cliente_id
  ) t on t.cliente_id = c.id;

grant select on public.vw_cliente_credito to authenticated;
