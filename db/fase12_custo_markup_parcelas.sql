-- Fase 12: preço de custo + markup no produto, parcelas vindas da forma de pagamento

-- 1) preço de custo e markup calculado
alter table public.produtos add column if not exists preco_custo numeric(14,4) not null default 0;

alter table public.produtos drop column if exists markup_percentual;
alter table public.produtos
  add column markup_percentual numeric(14,2)
  generated always as (
    case
      when coalesce(custo_medio, 0) > 0
        then round(((coalesce(preco_venda, 0) / custo_medio) - 1) * 100, 2)
      else 0
    end
  ) stored;

-- 2) parcelas do pedido/compra sempre vêm da forma de pagamento
create or replace function public.aplicar_parcelas_forma()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p integer;
begin
  if new.forma_pagamento_id is not null then
    select parcelas_padrao into p from public.formas_pagamento where id = new.forma_pagamento_id;
    if p is not null then
      new.parcelas := p;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_parcelas_forma_pedidos on public.pedidos;
create trigger trg_parcelas_forma_pedidos before insert or update of forma_pagamento_id
  on public.pedidos for each row execute function public.aplicar_parcelas_forma();

drop trigger if exists trg_parcelas_forma_compras on public.compras;
create trigger trg_parcelas_forma_compras before insert or update of forma_pagamento_id
  on public.compras for each row execute function public.aplicar_parcelas_forma();

update public.pedidos p
   set parcelas = f.parcelas_padrao
  from public.formas_pagamento f
 where f.id = p.forma_pagamento_id and p.status = 'rascunho';
