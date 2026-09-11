-- ============================================================================
-- Fase 45: relatório de vendas com comissões + gestão completa de comissões
--          + histórico de pedidos/financeiro correlacionado no cliente
-- Idempotente. Reutiliza pedidos, comissoes, metas_vendas, contas_pagar,
-- contas_receber, representantes, centros e rotas já existentes.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Relatório de vendas (uma linha por pedido, com comissão apurada)
-- ---------------------------------------------------------------------------
drop view if exists public.vw_relatorio_vendas cascade;
create view public.vw_relatorio_vendas
with (security_invoker = on) as
select
  p.id                                        as pedido_id,
  p.numero,
  p.data_pedido,
  to_char(p.data_pedido, 'YYYY-MM')           as mes,
  extract(year  from p.data_pedido)::int      as ano,
  extract(month from p.data_pedido)::int      as mes_numero,
  p.status,
  p.cliente_id,
  cl.razao_social                             as cliente,
  cl.pessoa_id,
  p.representante_id,
  rp.nome                                     as representante,
  p.centro_id,
  ce.nome                                     as centro,
  p.rota_id,
  ro.nome                                     as rota,
  p.forma_pagamento_id,
  fp.nome                                     as forma_pagamento,
  coalesce(p.total_itens, 0)                  as total_itens,
  coalesce(p.desconto_valor, 0)               as desconto_valor,
  coalesce(p.frete_valor, 0)                  as frete_valor,
  coalesce(p.forma_acrescimo_valor, 0)        as forma_acrescimo_valor,
  coalesce(p.forma_desconto_valor, 0)         as forma_desconto_valor,
  coalesce(p.total_liquido, 0)                as total_liquido,
  coalesce(p.comissao_percentual, 0)          as comissao_percentual,
  coalesce(p.comissao_valor, 0)               as comissao_valor,
  coalesce(cm.valor, 0)                       as comissao_apurada,
  cm.status                                   as comissao_status,
  coalesce(public.peso_pedido(p.id), 0)       as peso_kg
from public.pedidos p
left join public.clientes cl          on cl.id = p.cliente_id
left join public.representantes rp    on rp.id = p.representante_id
left join public.centros ce           on ce.id = p.centro_id
left join public.rotas ro             on ro.id = p.rota_id
left join public.formas_pagamento fp  on fp.id = p.forma_pagamento_id
left join public.comissoes cm         on cm.pedido_id = p.id;

grant select on public.vw_relatorio_vendas to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Comissões detalhadas (comissão + pedido + cliente + centro)
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 3. Lotes de pagamento de comissão (gera conta a pagar)
-- ---------------------------------------------------------------------------
create table if not exists public.comissao_pagamentos (
  id               uuid primary key default gen_random_uuid(),
  representante_id uuid not null references public.representantes(id) on delete cascade,
  centro_id        uuid references public.centros(id) on delete set null,
  competencia      text,
  periodo_inicio   date,
  periodo_fim      date,
  quantidade       integer not null default 0,
  valor_total      numeric(14,2) not null default 0,
  conta_pagar_id   uuid references public.contas_pagar(id) on delete set null,
  vencimento       date,
  status           text not null default 'aberto'
                   check (status in ('aberto','cancelado')),
  observacao       text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.comissao_pagamento_itens (
  id            uuid primary key default gen_random_uuid(),
  pagamento_id  uuid not null references public.comissao_pagamentos(id) on delete cascade,
  comissao_id   uuid not null references public.comissoes(id) on delete cascade,
  valor         numeric(14,2) not null default 0,
  created_at    timestamptz not null default now(),
  unique (pagamento_id, comissao_id)
);

create index if not exists comissao_pagamentos_rep_idx  on public.comissao_pagamentos(representante_id);
create index if not exists comissao_pag_itens_com_idx   on public.comissao_pagamento_itens(comissao_id);

grant select, insert, update, delete on public.comissao_pagamentos      to authenticated;
grant select, insert, update, delete on public.comissao_pagamento_itens to authenticated;
grant all on public.comissao_pagamentos      to service_role;
grant all on public.comissao_pagamento_itens to service_role;

alter table public.comissao_pagamentos      enable row level security;
alter table public.comissao_pagamento_itens enable row level security;

drop policy if exists "comissao_pagamentos_select" on public.comissao_pagamentos;
create policy "comissao_pagamentos_select" on public.comissao_pagamentos
  for select to authenticated
  using (not public.escopo_representante() or representante_id = public.meu_representante_id());

drop policy if exists "comissao_pagamentos_write" on public.comissao_pagamentos;
create policy "comissao_pagamentos_write" on public.comissao_pagamentos
  to authenticated using (public.can_finance(auth.uid())) with check (public.can_finance(auth.uid()));

drop policy if exists "comissao_pag_itens_select" on public.comissao_pagamento_itens;
create policy "comissao_pag_itens_select" on public.comissao_pagamento_itens
  for select to authenticated using (true);

drop policy if exists "comissao_pag_itens_write" on public.comissao_pagamento_itens;
create policy "comissao_pag_itens_write" on public.comissao_pagamento_itens
  to authenticated using (public.can_finance(auth.uid())) with check (public.can_finance(auth.uid()));

drop trigger if exists set_updated_at on public.comissao_pagamentos;
create trigger set_updated_at before update on public.comissao_pagamentos
  for each row execute function public.set_updated_at();

-- recria a view de detalhe agora que a tabela de itens existe
drop view if exists public.vw_comissoes_detalhe cascade;
create view public.vw_comissoes_detalhe
with (security_invoker = on) as
select
  cm.id                                       as comissao_id,
  cm.representante_id,
  rp.nome                                     as representante,
  rp.pessoa_id,
  cm.pedido_id,
  p.numero                                    as pedido_numero,
  p.data_pedido,
  to_char(p.data_pedido, 'YYYY-MM')           as mes,
  extract(year  from p.data_pedido)::int      as ano,
  extract(month from p.data_pedido)::int      as mes_numero,
  p.status                                    as pedido_status,
  p.cliente_id,
  cl.razao_social                             as cliente,
  coalesce(cm.centro_id, p.centro_id)         as centro_id,
  ce.nome                                     as centro,
  cm.base_calculo,
  cm.percentual,
  cm.valor,
  cm.status,
  cm.created_at,
  cpi.pagamento_id
from public.comissoes cm
left join public.representantes rp on rp.id = cm.representante_id
left join public.pedidos p         on p.id  = cm.pedido_id
left join public.clientes cl       on cl.id = p.cliente_id
left join public.centros ce        on ce.id = coalesce(cm.centro_id, p.centro_id)
left join public.comissao_pagamento_itens cpi on cpi.comissao_id = cm.id;

grant select on public.vw_comissoes_detalhe to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Resumo por representante/mês com meta e atingimento
-- ---------------------------------------------------------------------------
drop view if exists public.vw_comissoes_resumo cascade;
create view public.vw_comissoes_resumo
with (security_invoker = on) as
with base as (
  select
    d.representante_id,
    d.representante,
    d.ano,
    d.mes_numero,
    d.mes,
    count(*)                                                              as pedidos,
    sum(d.base_calculo)                                                   as base_total,
    sum(case when d.status = 'prevista' then d.valor else 0 end)          as prevista,
    sum(case when d.status = 'liberada' then d.valor else 0 end)          as liberada,
    sum(case when d.status = 'paga'     then d.valor else 0 end)          as paga,
    sum(case when d.status = 'cancelada' then d.valor else 0 end)         as cancelada,
    sum(case when d.status in ('prevista','liberada') then d.valor else 0 end) as a_pagar,
    sum(case when d.status <> 'cancelada' then d.valor else 0 end)        as total
  from public.vw_comissoes_detalhe d
  where d.ano is not null
  group by d.representante_id, d.representante, d.ano, d.mes_numero, d.mes
)
select
  b.*,
  coalesce(m.valor_meta, 0) as valor_meta,
  coalesce(v.realizado, 0)  as realizado,
  case when coalesce(m.valor_meta, 0) > 0
       then round(coalesce(v.realizado, 0) / m.valor_meta * 100, 2)
       else 0 end           as atingimento_percentual
from base b
left join public.metas_vendas m
  on m.representante_id = b.representante_id and m.ano = b.ano and m.mes = b.mes_numero
left join (
  select representante_id,
         extract(year from data_pedido)::int  as ano,
         extract(month from data_pedido)::int as mes,
         sum(coalesce(total_liquido, 0))      as realizado
  from public.pedidos
  where status not in ('cancelado','rascunho','digitacao','recusado')
  group by 1, 2, 3
) v on v.representante_id = b.representante_id and v.ano = b.ano and v.mes = b.mes_numero;

grant select on public.vw_comissoes_resumo to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Histórico correlacionado do cliente (pedidos + financeiro)
-- ---------------------------------------------------------------------------
drop view if exists public.vw_cliente_titulos cascade;
create view public.vw_cliente_titulos
with (security_invoker = on) as
select
  cr.id                                as titulo_id,
  cr.cliente_id,
  cl.pessoa_id,
  cr.pedido_id,
  p.numero                             as pedido_numero,
  cr.documento,
  cr.parcela,
  cr.descricao,
  cr.data_emissao,
  cr.vencimento,
  cr.data_pagamento,
  cr.valor,
  coalesce(cr.valor_pago, 0)           as valor_pago,
  greatest(coalesce(cr.valor, 0)
    + coalesce(cr.juros, 0) + coalesce(cr.multa, 0) + coalesce(cr.acrescimo, 0)
    - coalesce(cr.desconto, 0) - coalesce(cr.valor_pago, 0), 0) as saldo,
  cr.status,
  case
    when cr.status = 'cancelado' then 'cancelado'
    when coalesce(cr.valor_pago, 0) >= cr.valor then 'pago'
    when cr.vencimento < current_date then 'vencido'
    when coalesce(cr.valor_pago, 0) > 0 then 'parcial'
    else 'aberto'
  end                                  as status_efetivo,
  cr.centro_id,
  ce.nome                              as centro
from public.contas_receber cr
left join public.clientes cl on cl.id = cr.cliente_id
left join public.pedidos p   on p.id  = cr.pedido_id
left join public.centros ce  on ce.id = cr.centro_id;

grant select on public.vw_cliente_titulos to authenticated;

-- ---------------------------------------------------------------------------
-- 6. RPCs de gestão de comissões
-- ---------------------------------------------------------------------------
create or replace function public.liberar_comissoes(_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para liberar comissoes';
  end if;
  update public.comissoes
     set status = 'liberada'
   where id = any(_ids) and status = 'prevista';
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.liberar_comissoes(uuid[]) to authenticated;

create or replace function public.pagar_comissoes(
  _representante_id uuid,
  _comissao_ids     uuid[],
  _vencimento       date default current_date,
  _categoria_id     uuid default null,
  _conta_id         uuid default null,
  _forma_id         uuid default null,
  _observacao       text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  lote_id    uuid;
  conta_id   uuid;
  total      numeric(14,2);
  qtd        integer;
  centro     uuid;
  ini        date;
  fim        date;
  rep_nome   text;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para pagar comissoes';
  end if;

  select coalesce(sum(cm.valor), 0), count(*), min(cm.centro_id),
         min(coalesce(p.data_pedido, cm.created_at::date)),
         max(coalesce(p.data_pedido, cm.created_at::date))
    into total, qtd, centro, ini, fim
  from public.comissoes cm
  left join public.pedidos p on p.id = cm.pedido_id
  where cm.id = any(_comissao_ids)
    and cm.representante_id = _representante_id
    and cm.status in ('prevista','liberada');

  if coalesce(qtd, 0) = 0 then
    raise exception 'Nenhuma comissao elegivel selecionada';
  end if;
  if total <= 0 then
    raise exception 'Valor total das comissoes deve ser maior que zero';
  end if;

  select nome into rep_nome from public.representantes where id = _representante_id;

  insert into public.contas_pagar
    (fornecedor_id, documento, parcela, valor, vencimento, data_emissao, status,
     centro_id, categoria_id, forma_pagamento_id, conta_financeira_id, descricao, observacao)
  values
    (null, null, 1, total, coalesce(_vencimento, current_date), current_date, 'aberto',
     centro, _categoria_id, _forma_id, _conta_id,
     'Comissao ' || coalesce(rep_nome, 'representante') ||
       ' (' || to_char(coalesce(ini, current_date), 'DD/MM/YYYY') || ' a ' ||
       to_char(coalesce(fim, current_date), 'DD/MM/YYYY') || ')',
     _observacao)
  returning id into conta_id;

  insert into public.comissao_pagamentos
    (representante_id, centro_id, competencia, periodo_inicio, periodo_fim,
     quantidade, valor_total, conta_pagar_id, vencimento, observacao, created_by)
  values
    (_representante_id, centro, to_char(coalesce(fim, current_date), 'YYYY-MM'), ini, fim,
     qtd, total, conta_id, coalesce(_vencimento, current_date), _observacao, auth.uid())
  returning id into lote_id;

  insert into public.comissao_pagamento_itens (pagamento_id, comissao_id, valor)
  select lote_id, cm.id, cm.valor
  from public.comissoes cm
  where cm.id = any(_comissao_ids)
    and cm.representante_id = _representante_id
    and cm.status in ('prevista','liberada');

  update public.comissoes
     set status = 'paga'
   where id in (select comissao_id from public.comissao_pagamento_itens where pagamento_id = lote_id);

  return lote_id;
end;
$$;

grant execute on function public.pagar_comissoes(uuid, uuid[], date, uuid, uuid, uuid, text) to authenticated;

create or replace function public.cancelar_pagamento_comissao(_pagamento_id uuid, _motivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare lote record;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para cancelar pagamentos de comissao';
  end if;

  select * into lote from public.comissao_pagamentos where id = _pagamento_id;
  if lote.id is null then raise exception 'Lote nao encontrado'; end if;
  if lote.status = 'cancelado' then raise exception 'Lote ja cancelado'; end if;

  if lote.conta_pagar_id is not null then
    if exists (select 1 from public.contas_pagar
                where id = lote.conta_pagar_id and coalesce(valor_pago, 0) > 0) then
      raise exception 'Conta a pagar da comissao ja possui baixa; estorne o pagamento primeiro';
    end if;
    update public.contas_pagar
       set status = 'cancelado',
           observacao = coalesce(observacao, '') || ' | cancelado: ' || coalesce(_motivo, 'estorno de comissao')
     where id = lote.conta_pagar_id;
  end if;

  update public.comissoes
     set status = 'liberada'
   where id in (select comissao_id from public.comissao_pagamento_itens where pagamento_id = _pagamento_id);

  update public.comissao_pagamentos
     set status = 'cancelado',
         observacao = coalesce(observacao, '') || ' | ' || coalesce(_motivo, 'cancelado')
   where id = _pagamento_id;
end;
$$;

grant execute on function public.cancelar_pagamento_comissao(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Menu / permissões da nova tela de relatório de vendas
-- ---------------------------------------------------------------------------
insert into public.role_menus (role, path)
select r::app_role, '/relatorio-vendas'
from unnest(array['admin','gestor','financeiro','comercial']) as r
on conflict do nothing;

insert into public.role_menus (role, path)
select r::app_role, '/gestao-comissoes'
from unnest(array['admin','gestor','financeiro','comercial']) as r
on conflict do nothing;

insert into public.permissoes (codigo, nome, grupo, ordem) values
  ('comissoes_pagar', 'Pagar comissoes de representantes', 'Financeiro', 40),
  ('vendas_relatorio_ver', 'Visualizar relatorio de vendas', 'Gerencial', 41)
on conflict (codigo) do nothing;

commit;
