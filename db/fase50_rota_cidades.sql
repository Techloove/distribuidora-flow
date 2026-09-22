-- ============================================================
-- FASE 50 — SEQUÊNCIA DE CIDADES POR ROTA + RELATÓRIOS POR ROTA/REPRESENTANTE
-- Reaproveita rotas, clientes.cidade/uf, pedidos e pedido_itens.
-- Idempotente: pode ser aplicada mais de uma vez.
-- ============================================================

-- ---------- normalização de nome de cidade ----------
create or replace function public.norm_cidade(_t text)
returns text
language sql
immutable
as $$
  select nullif(
    upper(
      translate(btrim(regexp_replace(coalesce(_t,''), '\s+', ' ', 'g')),
        'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
        'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')
    ), '')
$$;

-- ---------- cidades atendidas dentro de cada rota ----------
create table if not exists public.rota_cidades (
  id uuid primary key default gen_random_uuid(),
  rota_id uuid not null references public.rotas(id) on delete cascade,
  cidade text not null,
  uf text,
  sequencia integer not null default 1,
  observacao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rota_cidades
  add column if not exists cidade_norm text
  generated always as (public.norm_cidade(cidade)) stored;

create unique index if not exists rota_cidades_cidade_uf_key
  on public.rota_cidades(cidade_norm, coalesce(upper(uf), ''));
create index if not exists rota_cidades_rota_idx on public.rota_cidades(rota_id, sequencia);

grant select, insert, update, delete on public.rota_cidades to authenticated;
grant all on public.rota_cidades to service_role;
alter table public.rota_cidades enable row level security;

drop policy if exists "rota_cidades_select" on public.rota_cidades;
create policy "rota_cidades_select" on public.rota_cidades
for select to authenticated using (true);
drop policy if exists "rota_cidades_write" on public.rota_cidades;
create policy "rota_cidades_write" on public.rota_cidades
for all to authenticated using (public.can_manage(auth.uid())) with check (public.can_manage(auth.uid()));

create or replace function public.rota_cidades_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists trg_rota_cidades_touch on public.rota_cidades;
create trigger trg_rota_cidades_touch before update on public.rota_cidades
for each row execute function public.rota_cidades_touch();

-- ---------- backfill a partir do campo texto rotas.cidades ----------
insert into public.rota_cidades (rota_id, cidade, sequencia)
select r.id, btrim(c.cidade), c.n
  from public.rotas r
  cross join lateral (
    select btrim(x) as cidade, row_number() over () as n
      from unnest(string_to_array(coalesce(r.cidades,''), ',')) as x
     where btrim(x) <> ''
  ) c
 where not exists (
   select 1 from public.rota_cidades rc
    where rc.cidade_norm = public.norm_cidade(c.cidade)
      and coalesce(upper(rc.uf),'') = ''
 )
on conflict do nothing;

-- ---------- localizar a rota de uma cidade ----------
create or replace function public.rota_por_cidade(_cidade text, _uf text default null)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select rc.rota_id
    from public.rota_cidades rc
   where rc.ativo
     and rc.cidade_norm = public.norm_cidade(_cidade)
     and (rc.uf is null or _uf is null or upper(rc.uf) = upper(_uf))
   order by (rc.uf is not null) desc
   limit 1
$$;
grant execute on function public.rota_por_cidade(text, text) to authenticated;

create or replace function public.sequencia_por_cidade(_cidade text, _uf text default null)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select rc.sequencia
    from public.rota_cidades rc
   where rc.ativo
     and rc.cidade_norm = public.norm_cidade(_cidade)
     and (rc.uf is null or _uf is null or upper(rc.uf) = upper(_uf))
   order by (rc.uf is not null) desc
   limit 1
$$;
grant execute on function public.sequencia_por_cidade(text, text) to authenticated;

-- ---------- cliente sem rota recebe a rota da sua cidade ----------
create or replace function public.cliente_rota_por_cidade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_rota uuid;
begin
  if new.rota_id is null and new.cidade is not null then
    v_rota := public.rota_por_cidade(new.cidade, new.uf);
    if v_rota is not null then new.rota_id := v_rota; end if;
  end if;
  if new.sequencia_entrega is null and new.cidade is not null then
    new.sequencia_entrega := public.sequencia_por_cidade(new.cidade, new.uf);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cliente_rota_por_cidade on public.clientes;
create trigger trg_cliente_rota_por_cidade
before insert or update of cidade, uf, rota_id on public.clientes
for each row execute function public.cliente_rota_por_cidade();

-- aplicar em massa (opcionalmente sobrescrevendo rotas já definidas)
create or replace function public.aplicar_rotas_por_cidade(_sobrescrever boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_qtd integer;
begin
  if not public.can_manage(auth.uid()) then
    raise exception 'Sem permissão para aplicar rotas por cidade';
  end if;
  with alvo as (
    select c.id, rc.rota_id, rc.sequencia
      from public.clientes c
      join public.rota_cidades rc
        on rc.ativo
       and rc.cidade_norm = public.norm_cidade(c.cidade)
       and (rc.uf is null or c.uf is null or upper(rc.uf) = upper(c.uf))
     where _sobrescrever or c.rota_id is null
  ), upd as (
    update public.clientes c
       set rota_id = a.rota_id,
           sequencia_entrega = coalesce(c.sequencia_entrega, a.sequencia)
      from alvo a
     where c.id = a.id
       and (c.rota_id is distinct from a.rota_id or c.sequencia_entrega is null)
     returning 1
  )
  select count(*) into v_qtd from upd;
  return coalesce(v_qtd, 0);
end;
$$;
grant execute on function public.aplicar_rotas_por_cidade(boolean) to authenticated;

-- ============================================================
-- RELATÓRIOS POR ROTA, CIDADE E REPRESENTANTE
-- ============================================================
create or replace view public.vw_vendas_rota as
select r.id as rota_id,
       r.nome as rota,
       r.sequencia as rota_sequencia,
       p.centro_id,
       p.data_pedido,
       count(distinct p.id) as pedidos,
       count(distinct p.cliente_id) as clientes,
       coalesce(sum(p.total_liquido),0) as total,
       coalesce(sum(p.desconto_valor),0) as desconto
  from public.pedidos p
  join public.rotas r on r.id = p.rota_id
 where p.status not in ('cancelado','rascunho','digitacao','recusado')
 group by r.id, r.nome, r.sequencia, p.centro_id, p.data_pedido;
grant select on public.vw_vendas_rota to authenticated;

create or replace view public.vw_vendas_rota_cidade as
select r.id as rota_id,
       r.nome as rota,
       coalesce(rc.sequencia, c.sequencia_entrega) as sequencia,
       c.cidade,
       c.uf,
       p.centro_id,
       p.data_pedido,
       count(distinct p.id) as pedidos,
       count(distinct c.id) as clientes,
       coalesce(sum(p.total_liquido),0) as total
  from public.pedidos p
  join public.clientes c on c.id = p.cliente_id
  left join public.rotas r on r.id = coalesce(p.rota_id, c.rota_id)
  left join public.rota_cidades rc
    on rc.cidade_norm = public.norm_cidade(c.cidade)
   and (rc.uf is null or c.uf is null or upper(rc.uf) = upper(c.uf))
 where p.status not in ('cancelado','rascunho','digitacao','recusado')
 group by r.id, r.nome, coalesce(rc.sequencia, c.sequencia_entrega), c.cidade, c.uf,
          p.centro_id, p.data_pedido;
grant select on public.vw_vendas_rota_cidade to authenticated;

create or replace view public.vw_produtos_rota as
select r.id as rota_id,
       r.nome as rota,
       pr.id as produto_id,
       pr.codigo as produto_codigo,
       pr.descricao as produto,
       p.centro_id,
       p.data_pedido,
       p.representante_id,
       sum(pi.quantidade) as quantidade,
       coalesce(sum(pi.total),0) as total
  from public.pedido_itens pi
  join public.pedidos p on p.id = pi.pedido_id
  join public.produtos pr on pr.id = pi.produto_id
  left join public.rotas r on r.id = p.rota_id
 where p.status not in ('cancelado','rascunho','digitacao','recusado')
 group by r.id, r.nome, pr.id, pr.codigo, pr.descricao, p.centro_id, p.data_pedido,
          p.representante_id;
grant select on public.vw_produtos_rota to authenticated;

create or replace view public.vw_vendas_representante_rota as
select rep.id as representante_id,
       rep.nome as representante,
       r.id as rota_id,
       r.nome as rota,
       p.centro_id,
       p.data_pedido,
       count(distinct p.id) as pedidos,
       count(distinct p.cliente_id) as clientes,
       coalesce(sum(p.total_liquido),0) as total
  from public.pedidos p
  left join public.representantes rep on rep.id = p.representante_id
  left join public.rotas r on r.id = p.rota_id
 where p.status not in ('cancelado','rascunho','digitacao','recusado')
 group by rep.id, rep.nome, r.id, r.nome, p.centro_id, p.data_pedido;
grant select on public.vw_vendas_representante_rota to authenticated;
