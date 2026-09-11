-- ============================================================
-- FASE 35 - Rentabilidade de vendas + custo e resultado de rota
-- Reutiliza pedidos, pedido_itens, produtos, rotas, centros.
-- Idempotente.
-- ============================================================

-- ---------- rentabilidade por item de pedido ----------
create or replace view public.vw_rentabilidade_item as
select
  i.id as item_id,
  p.id as pedido_id,
  p.numero as pedido_numero,
  p.data_pedido,
  p.status,
  p.centro_id,
  p.cliente_id,
  c.razao_social as cliente,
  p.representante_id,
  r.nome as representante,
  p.rota_id,
  ro.nome as rota,
  i.produto_id,
  pr.descricao as produto,
  pr.categoria as produto_categoria,
  i.quantidade,
  i.preco_unitario,
  coalesce(pr.custo_medio, pr.preco_custo, pr.ultimo_custo, 0) as custo_unitario,
  round(i.total, 2) as receita,
  round(i.quantidade * coalesce(pr.custo_medio, pr.preco_custo, pr.ultimo_custo, 0), 2) as custo_total,
  round(i.quantidade * i.preco_unitario * coalesce(i.desconto_percentual,0) / 100, 2) as desconto,
  round(i.total - i.quantidade * coalesce(pr.custo_medio, pr.preco_custo, pr.ultimo_custo, 0), 2) as lucro_bruto,
  case when i.total > 0
    then round((i.total - i.quantidade * coalesce(pr.custo_medio, pr.preco_custo, pr.ultimo_custo, 0))
               / i.total * 100, 2)
    else 0 end as margem_percentual,
  case when coalesce(pr.custo_medio, pr.preco_custo, pr.ultimo_custo, 0) > 0
    then round((i.preco_unitario / coalesce(pr.custo_medio, pr.preco_custo, pr.ultimo_custo) - 1) * 100, 2)
    else 0 end as markup_percentual,
  round(i.total * coalesce(p.comissao_percentual,0) / 100, 2) as comissao
from public.pedido_itens i
join public.pedidos p on p.id = i.pedido_id
join public.produtos pr on pr.id = i.produto_id
left join public.clientes c on c.id = p.cliente_id
left join public.representantes r on r.id = p.representante_id
left join public.rotas ro on ro.id = p.rota_id
where p.status not in ('rascunho','cancelado','recusado');

alter view public.vw_rentabilidade_item set (security_invoker = on);
grant select on public.vw_rentabilidade_item to authenticated;

-- ---------- rentabilidade por pedido ----------
create or replace view public.vw_rentabilidade_pedido as
select
  pedido_id,
  pedido_numero,
  data_pedido,
  status,
  centro_id,
  cliente_id,
  cliente,
  representante_id,
  representante,
  rota_id,
  rota,
  sum(quantidade) as quantidade,
  sum(receita) as receita,
  sum(custo_total) as custo,
  sum(desconto) as desconto,
  sum(comissao) as comissao,
  sum(lucro_bruto) as lucro_bruto,
  case when sum(receita) > 0 then round(sum(lucro_bruto) / sum(receita) * 100, 2) else 0 end as margem_percentual,
  sum(lucro_bruto) - sum(comissao) as resultado_pos_comissao
from public.vw_rentabilidade_item
group by 1,2,3,4,5,6,7,8,9,10,11;

alter view public.vw_rentabilidade_pedido set (security_invoker = on);
grant select on public.vw_rentabilidade_pedido to authenticated;

-- ---------- parametros de custo de rota (configuraveis) ----------
create table if not exists public.rota_parametros (
  id uuid primary key default gen_random_uuid(),
  centro_id uuid unique references public.centros(id) on delete cascade,
  preco_combustivel numeric(14,2) not null default 6.00,
  consumo_km_l numeric(10,2) not null default 8.00,
  custo_km_extra numeric(14,2) not null default 0,
  pedagio_padrao numeric(14,2) not null default 0,
  alimentacao_dia numeric(14,2) not null default 0,
  hotel_noite numeric(14,2) not null default 0,
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.rota_parametros to authenticated;
grant all on public.rota_parametros to service_role;
alter table public.rota_parametros enable row level security;

drop policy if exists "rota_parametros_select" on public.rota_parametros;
create policy "rota_parametros_select" on public.rota_parametros for select to authenticated using (true);
drop policy if exists "rota_parametros_write" on public.rota_parametros;
create policy "rota_parametros_write" on public.rota_parametros for all to authenticated
using (public.can_manage(auth.uid()) or public.can_finance(auth.uid()))
with check (public.can_manage(auth.uid()) or public.can_finance(auth.uid()));

drop trigger if exists trg_rota_parametros_updated on public.rota_parametros;
create trigger trg_rota_parametros_updated before update on public.rota_parametros
for each row execute function public.set_updated_at();

insert into public.rota_parametros (centro_id)
select null where not exists (select 1 from public.rota_parametros where centro_id is null);

-- ---------- despesas de rota / viagem ----------
create table if not exists public.rota_despesas (
  id uuid primary key default gen_random_uuid(),
  rota_id uuid not null references public.rotas(id) on delete restrict,
  centro_id uuid references public.centros(id) on delete set null,
  data date not null default current_date,
  responsavel text,
  representante_id uuid references public.representantes(id) on delete set null,
  veiculo text,
  km_inicial numeric(12,1),
  km_final numeric(12,1),
  combustivel numeric(14,2) not null default 0,
  alimentacao numeric(14,2) not null default 0,
  hotel numeric(14,2) not null default 0,
  pedagio numeric(14,2) not null default 0,
  estacionamento numeric(14,2) not null default 0,
  outras numeric(14,2) not null default 0,
  clientes_visitados integer not null default 0,
  observacoes text,
  conta_pagar_id uuid references public.contas_pagar(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rota_despesas_rota_data_idx on public.rota_despesas(rota_id, data);
create index if not exists rota_despesas_centro_idx on public.rota_despesas(centro_id);

grant select, insert, update, delete on public.rota_despesas to authenticated;
grant all on public.rota_despesas to service_role;
alter table public.rota_despesas enable row level security;

drop policy if exists "rota_despesas_select" on public.rota_despesas;
create policy "rota_despesas_select" on public.rota_despesas for select to authenticated using (true);
drop policy if exists "rota_despesas_write" on public.rota_despesas;
create policy "rota_despesas_write" on public.rota_despesas for all to authenticated
using (public.can_operate(auth.uid())) with check (public.can_operate(auth.uid()));

drop trigger if exists trg_rota_despesas_updated on public.rota_despesas;
create trigger trg_rota_despesas_updated before update on public.rota_despesas
for each row execute function public.set_updated_at();

-- ---------- despesas da rota com totais e custo por km ----------
create or replace view public.vw_rota_despesas as
select
  d.*,
  r.nome as rota_nome,
  r.codigo as rota_codigo,
  greatest(coalesce(d.km_final,0) - coalesce(d.km_inicial,0), 0) as km_percorrido,
  round(d.combustivel + d.alimentacao + d.hotel + d.pedagio + d.estacionamento + d.outras, 2) as custo_total,
  case when greatest(coalesce(d.km_final,0) - coalesce(d.km_inicial,0), 0) > 0
    then round((d.combustivel + d.alimentacao + d.hotel + d.pedagio + d.estacionamento + d.outras)
               / (d.km_final - d.km_inicial), 2)
    else 0 end as custo_por_km,
  case when d.clientes_visitados > 0
    then round((d.combustivel + d.alimentacao + d.hotel + d.pedagio + d.estacionamento + d.outras)
               / d.clientes_visitados, 2)
    else 0 end as custo_por_cliente
from public.rota_despesas d
join public.rotas r on r.id = d.rota_id;

alter view public.vw_rota_despesas set (security_invoker = on);
grant select on public.vw_rota_despesas to authenticated;

-- ---------- resultado da rota (faturamento x custo x despesas) ----------
create or replace view public.vw_rota_resultado as
with vendas as (
  select
    rota_id,
    date_trunc('month', data_pedido)::date as periodo,
    centro_id,
    count(distinct pedido_id) as pedidos,
    count(distinct cliente_id) as clientes,
    sum(receita) as faturamento,
    sum(custo) as custo_produtos,
    sum(lucro_bruto) as lucro_bruto
  from public.vw_rentabilidade_pedido
  where rota_id is not null
  group by 1,2,3
),
despesas as (
  select
    rota_id,
    date_trunc('month', data)::date as periodo,
    centro_id,
    sum(custo_total) as despesas_rota,
    sum(km_percorrido) as km
  from public.vw_rota_despesas
  group by 1,2,3
)
select
  coalesce(v.rota_id, d.rota_id) as rota_id,
  r.nome as rota,
  coalesce(v.periodo, d.periodo) as periodo,
  coalesce(v.centro_id, d.centro_id) as centro_id,
  coalesce(v.pedidos, 0) as pedidos,
  coalesce(v.clientes, 0) as clientes,
  coalesce(v.faturamento, 0) as faturamento,
  coalesce(v.custo_produtos, 0) as custo_produtos,
  coalesce(v.lucro_bruto, 0) as lucro_bruto,
  coalesce(d.despesas_rota, 0) as despesas_rota,
  coalesce(d.km, 0) as km,
  coalesce(v.lucro_bruto, 0) - coalesce(d.despesas_rota, 0) as resultado,
  case when coalesce(v.faturamento,0) > 0
    then round((coalesce(v.lucro_bruto,0) - coalesce(d.despesas_rota,0)) / v.faturamento * 100, 2)
    else 0 end as margem_percentual
from vendas v
full join despesas d
  on d.rota_id = v.rota_id and d.periodo = v.periodo and coalesce(d.centro_id::text,'') = coalesce(v.centro_id::text,'')
left join public.rotas r on r.id = coalesce(v.rota_id, d.rota_id);

alter view public.vw_rota_resultado set (security_invoker = on);
grant select on public.vw_rota_resultado to authenticated;

-- ---------- custo estimado de rota pelos parametros ----------
create or replace function public.estimar_custo_rota(
  _km numeric, _dias integer default 1, _noites integer default 0, _centro uuid default null
) returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with p as (
    select * from public.rota_parametros
     where centro_id is not distinct from _centro
    union all
    select * from public.rota_parametros where centro_id is null
    limit 1
  )
  select jsonb_build_object(
    'litros', case when p.consumo_km_l > 0 then round(_km / p.consumo_km_l, 2) else 0 end,
    'combustivel', case when p.consumo_km_l > 0
                        then round(_km / p.consumo_km_l * p.preco_combustivel, 2) else 0 end,
    'custo_km_combustivel', case when p.consumo_km_l > 0
                        then round(p.preco_combustivel / p.consumo_km_l, 2) else 0 end,
    'pedagio', p.pedagio_padrao,
    'alimentacao', round(p.alimentacao_dia * greatest(coalesce(_dias,1),0), 2),
    'hotel', round(p.hotel_noite * greatest(coalesce(_noites,0),0), 2),
    'extra_km', round(p.custo_km_extra * _km, 2),
    'total', round(
      case when p.consumo_km_l > 0 then _km / p.consumo_km_l * p.preco_combustivel else 0 end
      + p.pedagio_padrao
      + p.alimentacao_dia * greatest(coalesce(_dias,1),0)
      + p.hotel_noite * greatest(coalesce(_noites,0),0)
      + p.custo_km_extra * _km, 2)
  ) from p;
$$;

grant execute on function public.estimar_custo_rota(numeric, integer, integer, uuid) to authenticated;

-- ---------- fim da fase 35 ----------
