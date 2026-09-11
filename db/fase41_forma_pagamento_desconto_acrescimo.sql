-- Fase 41: desconto/acrescimo por forma de pagamento refletido no pedido
-- taxa_percentual passa a ser tratada como ACRESCIMO da forma de pagamento.
alter table public.formas_pagamento
  add column if not exists desconto_percentual numeric(5,2) not null default 0;

alter table public.pedidos
  add column if not exists forma_acrescimo_valor numeric(14,2) not null default 0,
  add column if not exists forma_desconto_valor numeric(14,2) not null default 0;

create or replace function public.recalcular_pedido(_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  soma numeric(14,2);
  base numeric(14,2);
  pct numeric(5,2);
  ped record;
  fp record;
  acr numeric(14,2) := 0;
  dsc numeric(14,2) := 0;
begin
  select coalesce(sum(total), 0) into soma from public.pedido_itens where pedido_id = _pedido_id;
  select * into ped from public.pedidos where id = _pedido_id;
  if ped is null then return; end if;

  base := greatest(soma - coalesce(ped.desconto_valor, 0), 0);
  pct := public.resolver_comissao(ped.representante_id, ped.cliente_id, ped.data_pedido, null, base);

  if ped.forma_pagamento_id is not null then
    select * into fp from public.formas_pagamento where id = ped.forma_pagamento_id;
    if fp.id is not null then
      acr := round(base * coalesce(fp.taxa_percentual, 0) / 100, 2);
      dsc := round(base * coalesce(fp.desconto_percentual, 0) / 100, 2);
    end if;
  end if;

  update public.pedidos
     set total_itens = soma,
         forma_acrescimo_valor = acr,
         forma_desconto_valor = dsc,
         total_liquido = greatest(base + coalesce(frete_valor,0) + acr - dsc, 0),
         comissao_percentual = pct,
         comissao_valor = round(base * pct / 100, 2)
   where id = _pedido_id;

  perform public.apurar_comissao_pedido(_pedido_id);
end $function$;

-- peso total dos itens do pedido
create or replace function public.peso_pedido(_pedido_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(i.quantidade * coalesce(p.peso_kg, 0)), 0)
    from public.pedido_itens i
    join public.produtos p on p.id = i.produto_id
   where i.pedido_id = _pedido_id;
$$;

-- recalcula pedidos abertos com a nova regra
do $$
declare r record;
begin
  for r in select id from public.pedidos where status in ('rascunho','digitacao') loop
    perform public.recalcular_pedido(r.id);
  end loop;
end $$;

-- recalcula o pedido quando muda forma de pagamento, desconto ou frete
create or replace function public.trg_recalcular_pedido_cabecalho()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalcular_pedido(new.id);
  return null;
end;
$$;

drop trigger if exists trg_recalc_cabecalho_pedidos on public.pedidos;
create trigger trg_recalc_cabecalho_pedidos
after update of forma_pagamento_id, desconto_valor, frete_valor on public.pedidos
for each row execute function public.trg_recalcular_pedido_cabecalho();
