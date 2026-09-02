-- Fase 23: markup fixo. Ao entrar nota fiscal e recalcular custo medio,
-- o markup permanece e o preco de venda sobe automaticamente.

-- 1) markup passa a ser coluna real (antes era gerada)
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'produtos'
       and column_name = 'markup_percentual' and is_generated = 'ALWAYS'
  ) then
    alter table public.produtos drop column markup_percentual;
    alter table public.produtos add column markup_percentual numeric(14,2) not null default 0;
  end if;
end $$;

alter table public.produtos
  add column if not exists markup_percentual numeric(14,2) not null default 0;

-- backfill com o markup atual entre custo medio e preco de venda
update public.produtos
   set markup_percentual = round(((preco_venda / custo_medio) - 1) * 100, 2)
 where coalesce(custo_medio, 0) > 0
   and coalesce(markup_percentual, 0) = 0;

-- 2) sincronizacao markup <-> preco de venda
create or replace function public.sincronizar_markup_produto()
returns trigger
language plpgsql
as $$
declare
  custo numeric := coalesce(new.custo_medio, 0);
begin
  if tg_op = 'INSERT' then
    if custo > 0 and coalesce(new.markup_percentual, 0) > 0
       and coalesce(new.preco_venda, 0) = 0 then
      new.preco_venda := round(custo * (1 + new.markup_percentual / 100), 4);
    elsif custo > 0 and coalesce(new.preco_venda, 0) > 0 then
      new.markup_percentual := round(((new.preco_venda / custo) - 1) * 100, 2);
    end if;
    return new;
  end if;

  -- custo medio mudou (entrada de NF): mantem o markup e ajusta o preco de venda
  if custo > 0 and coalesce(new.custo_medio, 0) is distinct from coalesce(old.custo_medio, 0)
     and coalesce(new.preco_venda, 0) = coalesce(old.preco_venda, 0)
     and coalesce(new.markup_percentual, 0) > 0 then
    new.preco_venda := round(custo * (1 + new.markup_percentual / 100), 4);
    return new;
  end if;

  -- markup alterado manualmente: recalcula o preco de venda
  if custo > 0 and coalesce(new.markup_percentual, 0) is distinct from coalesce(old.markup_percentual, 0)
     and coalesce(new.preco_venda, 0) = coalesce(old.preco_venda, 0) then
    new.preco_venda := round(custo * (1 + new.markup_percentual / 100), 4);
    return new;
  end if;

  -- preco de venda alterado manualmente: recalcula o markup
  if custo > 0 and coalesce(new.preco_venda, 0) is distinct from coalesce(old.preco_venda, 0) then
    new.markup_percentual := round(((new.preco_venda / custo) - 1) * 100, 2);
  end if;

  return new;
end $$;

drop trigger if exists trg_sincronizar_markup_produto on public.produtos;
create trigger trg_sincronizar_markup_produto
before insert or update of custo_medio, preco_venda, markup_percentual
on public.produtos
for each row execute function public.sincronizar_markup_produto();
