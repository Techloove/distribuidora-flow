-- ============================================================
-- FASE 25 — MÓDULO LEAD ROTA (vendas ativas por rota)
-- Reaproveita clientes, rotas, representantes, pedidos e produtos.
-- ============================================================

-- ---------- índices para consultas rápidas ----------
create index if not exists clientes_rota_idx on public.clientes(rota_id);
create index if not exists clientes_centro_idx on public.clientes(centro_id);
create index if not exists pedidos_cliente_data_idx on public.pedidos(cliente_id, data_pedido desc);
create index if not exists pedidos_representante_idx on public.pedidos(representante_id);
create index if not exists pedidos_rota_idx on public.pedidos(rota_id);
create index if not exists pedido_itens_produto_idx on public.pedido_itens(produto_id);
create index if not exists pedido_itens_pedido_idx on public.pedido_itens(pedido_id);

-- ---------- pesos configuráveis do score de oportunidade ----------
create table if not exists public.lead_score_config (
  id boolean primary key default true check (id),
  peso_dias numeric(6,2) not null default 30,
  peso_ticket numeric(6,2) not null default 20,
  peso_total numeric(6,2) not null default 20,
  peso_limite numeric(6,2) not null default 15,
  peso_frequencia numeric(6,2) not null default 15,
  ticket_referencia numeric(14,2) not null default 2000,
  total_referencia numeric(14,2) not null default 50000,
  dias_referencia integer not null default 120,
  pedidos_referencia integer not null default 12,
  updated_at timestamptz not null default now()
);
insert into public.lead_score_config (id) values (true) on conflict (id) do nothing;

grant select, insert, update on public.lead_score_config to authenticated;
grant all on public.lead_score_config to service_role;
alter table public.lead_score_config enable row level security;

drop policy if exists "lead_score_select" on public.lead_score_config;
create policy "lead_score_select" on public.lead_score_config
for select to authenticated using (true);
drop policy if exists "lead_score_update" on public.lead_score_config;
create policy "lead_score_update" on public.lead_score_config
for update to authenticated using (public.can_manage(auth.uid()));

-- ---------- contatos realizados na rota (histórico) ----------
create table if not exists public.lead_contatos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  rota_id uuid references public.rotas(id) on delete set null,
  representante_id uuid references public.representantes(id) on delete set null,
  centro_id uuid references public.centros(id) on delete set null,
  resultado text not null default 'contato_realizado' check (resultado in (
    'contato_realizado','nao_atendeu','pediu_retorno','fez_pedido',
    'sem_interesse','cliente_fechado','nao_localizado','outro'
  )),
  observacao text,
  proximo_contato date,
  responsavel uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists lead_contatos_cliente_idx on public.lead_contatos(cliente_id, created_at desc);
create index if not exists lead_contatos_rota_idx on public.lead_contatos(rota_id);
create index if not exists lead_contatos_rep_idx on public.lead_contatos(representante_id);

grant select, insert, update, delete on public.lead_contatos to authenticated;
grant all on public.lead_contatos to service_role;
alter table public.lead_contatos enable row level security;

-- ---------- situação atual do funil por cliente/rota ----------
create table if not exists public.lead_situacoes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  rota_id uuid references public.rotas(id) on delete set null,
  status text not null default 'nao_contatado' check (status in (
    'nao_contatado','contato_realizado','aguardando_retorno','em_negociacao',
    'pedido_realizado','sem_interesse','nao_localizado','proximo_contato'
  )),
  proximo_contato date,
  observacao text,
  atualizado_por uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (cliente_id)
);

create index if not exists lead_situacoes_rota_idx on public.lead_situacoes(rota_id);

grant select, insert, update, delete on public.lead_situacoes to authenticated;
grant all on public.lead_situacoes to service_role;
alter table public.lead_situacoes enable row level security;

-- escopo: representante só vê os seus clientes
do $$
declare t text;
begin
  foreach t in array array['lead_contatos','lead_situacoes'] loop
    execute format('drop policy if exists "%s_select" on public.%I', t, t);
    execute format($f$create policy "%s_select" on public.%I for select to authenticated
      using (not public.escopo_representante() or exists (
        select 1 from public.clientes c
         where c.id = %I.cliente_id and c.representante_id = public.meu_representante_id()))$f$, t, t, t);

    execute format('drop policy if exists "%s_insert" on public.%I', t, t);
    execute format($f$create policy "%s_insert" on public.%I for insert to authenticated
      with check (not public.escopo_representante() or exists (
        select 1 from public.clientes c
         where c.id = cliente_id and c.representante_id = public.meu_representante_id()))$f$, t, t);

    execute format('drop policy if exists "%s_update" on public.%I', t, t);
    execute format($f$create policy "%s_update" on public.%I for update to authenticated
      using (not public.escopo_representante() or exists (
        select 1 from public.clientes c
         where c.id = %I.cliente_id and c.representante_id = public.meu_representante_id()))$f$, t, t, t);

    execute format('drop policy if exists "%s_delete" on public.%I', t, t);
    execute format('create policy "%s_delete" on public.%I for delete to authenticated using (public.can_manage(auth.uid()))', t, t);
  end loop;
end $$;

-- registrar contato atualiza a situação do funil e a auditoria
create or replace function public.lead_aplicar_contato()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare novo_status text;
begin
  novo_status := case new.resultado
    when 'fez_pedido' then 'pedido_realizado'
    when 'cliente_fechado' then 'pedido_realizado'
    when 'pediu_retorno' then 'aguardando_retorno'
    when 'sem_interesse' then 'sem_interesse'
    when 'nao_localizado' then 'nao_localizado'
    when 'nao_atendeu' then 'nao_localizado'
    else 'contato_realizado'
  end;
  if new.proximo_contato is not null and novo_status = 'contato_realizado' then
    novo_status := 'proximo_contato';
  end if;

  insert into public.lead_situacoes (cliente_id, rota_id, status, proximo_contato, observacao, atualizado_por)
  values (new.cliente_id, new.rota_id, novo_status, new.proximo_contato, new.observacao, coalesce(new.responsavel, auth.uid()))
  on conflict (cliente_id) do update
    set status = excluded.status,
        rota_id = coalesce(excluded.rota_id, public.lead_situacoes.rota_id),
        proximo_contato = excluded.proximo_contato,
        observacao = excluded.observacao,
        atualizado_por = excluded.atualizado_por,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_lead_aplicar_contato on public.lead_contatos;
create trigger trg_lead_aplicar_contato
after insert on public.lead_contatos
for each row execute function public.lead_aplicar_contato();

-- ---------- carteira da rota ----------
create or replace view public.vw_lead_rota as
with agg as (
  select p.cliente_id,
         count(*) as pedidos,
         sum(p.total_liquido) as total_comprado,
         max(p.data_pedido) as ultima_compra
    from public.pedidos p
   where p.status not in ('cancelado','rascunho','digitacao','recusado')
   group by p.cliente_id
), ultimo as (
  select distinct on (p.cliente_id) p.cliente_id, p.id as ultimo_pedido_id,
         p.numero as ultimo_pedido_numero, p.total_liquido as ultimo_pedido_valor
    from public.pedidos p
   where p.status not in ('cancelado','rascunho','digitacao','recusado')
   order by p.cliente_id, p.data_pedido desc, p.created_at desc
), mes as (
  select p.cliente_id, count(*) as pedidos_mes, coalesce(sum(p.total_liquido),0) as valor_mes
    from public.pedidos p
   where p.status not in ('cancelado','rascunho','digitacao','recusado')
     and p.data_pedido >= date_trunc('month', current_date)::date
   group by p.cliente_id
), cfg as (select * from public.lead_score_config where id)
select
  c.id as cliente_id,
  c.codigo,
  c.razao_social,
  c.nome_fantasia,
  coalesce(c.telefone, ps.telefone) as telefone,
  ps.whatsapp,
  c.email,
  c.cidade,
  c.uf,
  concat_ws(', ', nullif(c.logradouro,''), nullif(c.numero,''), nullif(c.bairro,'')) as endereco,
  coalesce(nullif(ps.ent_logradouro,''), c.logradouro) as entrega_logradouro,
  c.status,
  c.centro_id,
  c.tabela_preco,
  c.condicao_pagamento,
  c.rota_id,
  r.nome as rota,
  r.sequencia as rota_sequencia,
  c.sequencia_entrega,
  c.representante_id,
  rep.nome as representante,
  coalesce(c.limite_credito,0) as limite_credito,
  coalesce(cred.em_aberto,0) as em_aberto,
  coalesce(cred.vencido,0) as vencido,
  coalesce(c.limite_credito,0) - coalesce(cred.em_aberto,0) as limite_disponivel,
  coalesce(a.pedidos,0) as pedidos,
  coalesce(a.total_comprado,0) as total_comprado,
  case when coalesce(a.pedidos,0) > 0
       then round(a.total_comprado / a.pedidos, 2) else 0 end as ticket_medio,
  a.ultima_compra,
  case when a.ultima_compra is null then 9999
       else (current_date - a.ultima_compra) end as dias_sem_comprar,
  u.ultimo_pedido_id,
  u.ultimo_pedido_numero,
  coalesce(u.ultimo_pedido_valor,0) as ultima_compra_valor,
  coalesce(m.pedidos_mes,0) as pedidos_mes,
  coalesce(m.valor_mes,0) as valor_mes,
  coalesce(s.status,'nao_contatado') as funil_status,
  s.proximo_contato,
  s.updated_at as funil_atualizado_em,
  round(
    cfg.peso_dias * least(
      case when a.ultima_compra is null then cfg.dias_referencia
           else (current_date - a.ultima_compra) end::numeric / cfg.dias_referencia, 1)
    + cfg.peso_ticket * least(
      (case when coalesce(a.pedidos,0) > 0 then a.total_comprado / a.pedidos else 0 end)
      / cfg.ticket_referencia, 1)
    + cfg.peso_total * least(coalesce(a.total_comprado,0) / cfg.total_referencia, 1)
    + cfg.peso_limite * case when coalesce(c.limite_credito,0) > 0
        then greatest(least((coalesce(c.limite_credito,0) - coalesce(cred.em_aberto,0))
             / c.limite_credito, 1), 0) else 0 end
    + cfg.peso_frequencia * least(coalesce(a.pedidos,0)::numeric / cfg.pedidos_referencia, 1)
  , 1) as score_oportunidade
from public.clientes c
cross join cfg
left join public.pessoas ps on ps.id = c.pessoa_id
left join public.rotas r on r.id = c.rota_id
left join public.representantes rep on rep.id = c.representante_id
left join public.vw_cliente_credito cred on cred.cliente_id = c.id
left join agg a on a.cliente_id = c.id
left join ultimo u on u.cliente_id = c.id
left join mes m on m.cliente_id = c.id
left join public.lead_situacoes s on s.cliente_id = c.id;

grant select on public.vw_lead_rota to authenticated;

-- ---------- pedidos do cliente (histórico enxuto) ----------
create or replace view public.vw_lead_pedidos as
select p.id as pedido_id,
       p.cliente_id,
       p.numero,
       p.data_pedido,
       p.status,
       p.rota_id,
       p.centro_id,
       p.representante_id,
       rep.nome as representante,
       coalesce(p.total_liquido,0) as total_liquido,
       coalesce(i.qtd_itens,0) as qtd_itens,
       coalesce(i.quantidade_total,0) as quantidade_total
  from public.pedidos p
  left join public.representantes rep on rep.id = p.representante_id
  left join (
    select pedido_id, count(*) as qtd_itens, sum(quantidade) as quantidade_total
      from public.pedido_itens group by pedido_id
  ) i on i.pedido_id = p.id;

grant select on public.vw_lead_pedidos to authenticated;

-- ---------- produtos que o cliente costuma comprar ----------
create or replace view public.vw_lead_produtos_cliente as
select p.cliente_id,
       pi.produto_id,
       pr.codigo as produto_codigo,
       pr.descricao as produto,
       pr.preco_venda,
       pr.estoque_atual,
       count(distinct p.id) as frequencia,
       sum(pi.quantidade) as quantidade_total,
       sum(pi.total) as valor_total,
       max(p.data_pedido) as ultima_compra,
       (current_date - max(p.data_pedido)) as dias_ultima_compra,
       round(avg(pi.preco_unitario), 4) as preco_medio
  from public.pedido_itens pi
  join public.pedidos p on p.id = pi.pedido_id
  join public.produtos pr on pr.id = pi.produto_id
 where p.status not in ('cancelado','rascunho','digitacao','recusado')
 group by p.cliente_id, pi.produto_id, pr.codigo, pr.descricao, pr.preco_venda, pr.estoque_atual;

grant select on public.vw_lead_produtos_cliente to authenticated;

-- ---------- produtividade da rota ----------
create or replace view public.vw_lead_rota_metas as
select r.id as rota_id,
       r.nome as rota,
       r.centro_id,
       count(distinct c.id) as clientes,
       count(distinct case when s.status is not null and s.status <> 'nao_contatado' then c.id end) as contatados,
       count(distinct case when s.status = 'em_negociacao' then c.id end) as em_negociacao,
       count(distinct case when s.status = 'sem_interesse' then c.id end) as sem_interesse,
       count(distinct case when pm.cliente_id is not null then c.id end) as clientes_com_pedido,
       coalesce(sum(pm.valor_mes),0) as faturamento_mes,
       coalesce(sum(pm.pedidos_mes),0) as pedidos_mes
  from public.rotas r
  left join public.clientes c on c.rota_id = r.id
  left join public.lead_situacoes s on s.cliente_id = c.id
  left join (
    select p.cliente_id, count(*) as pedidos_mes, sum(p.total_liquido) as valor_mes
      from public.pedidos p
     where p.status not in ('cancelado','rascunho','digitacao','recusado')
       and p.data_pedido >= date_trunc('month', current_date)::date
     group by p.cliente_id
  ) pm on pm.cliente_id = c.id
 group by r.id, r.nome, r.centro_id;

grant select on public.vw_lead_rota_metas to authenticated;

-- ---------- criar pedido a partir do Lead Rota ----------
-- modo: 'vazio' | 'ultimo' (repete o último pedido) | 'frequentes'
create or replace function public.lead_criar_pedido(
  _cliente_id uuid,
  _modo text default 'vazio',
  _rota_id uuid default null,
  _centro_id uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cliente public.clientes;
  v_pedido_id uuid;
  v_ultimo uuid;
begin
  select * into v_cliente from public.clientes where id = _cliente_id;
  if v_cliente.id is null then raise exception 'Cliente não encontrado'; end if;

  insert into public.pedidos (
    cliente_id, representante_id, rota_id, centro_id, data_pedido,
    tabela_preco, condicao_pagamento, endereco_entrega, status
  ) values (
    v_cliente.id,
    coalesce(v_cliente.representante_id, public.meu_representante_id()),
    coalesce(_rota_id, v_cliente.rota_id),
    coalesce(_centro_id, v_cliente.centro_id),
    current_date,
    v_cliente.tabela_preco,
    v_cliente.condicao_pagamento,
    nullif(concat_ws(', ', nullif(v_cliente.logradouro,''), nullif(v_cliente.numero,''),
      nullif(v_cliente.bairro,''), nullif(v_cliente.cidade,''), nullif(v_cliente.uf,'')), ''),
    'rascunho'
  ) returning id into v_pedido_id;

  if _modo = 'ultimo' then
    select p.id into v_ultimo
      from public.pedidos p
     where p.cliente_id = _cliente_id
       and p.id <> v_pedido_id
       and p.status not in ('cancelado','rascunho','digitacao','recusado')
     order by p.data_pedido desc, p.created_at desc
     limit 1;
    if v_ultimo is not null then
      insert into public.pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, desconto_percentual)
      select v_pedido_id, pi.produto_id, pi.quantidade,
             coalesce(pr.preco_venda, pi.preco_unitario), coalesce(pi.desconto_percentual, 0)
        from public.pedido_itens pi
        join public.produtos pr on pr.id = pi.produto_id
       where pi.pedido_id = v_ultimo;
    end if;
  elsif _modo = 'frequentes' then
    insert into public.pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, desconto_percentual)
    select v_pedido_id, f.produto_id,
           greatest(round(f.quantidade_total / f.frequencia, 0), 1),
           f.preco_venda, 0
      from public.vw_lead_produtos_cliente f
     where f.cliente_id = _cliente_id
     order by f.frequencia desc, f.quantidade_total desc
     limit 10;
  end if;

  return v_pedido_id;
end;
$$;

grant execute on function public.lead_criar_pedido(uuid, text, uuid, uuid) to authenticated;
