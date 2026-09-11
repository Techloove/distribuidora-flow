-- Fase 49: status "comprado" nas compras/NF de entrada, visibilidade da
-- quantidade comprada em produtos/pedidos e permissão de estoque negativo.
-- Idempotente: pode ser reaplicada sem perda de dados.

-- 1) Status "comprado" (pedido de compra feito, mercadoria ainda não chegou)
alter table public.compras drop constraint if exists compras_status_check;
alter table public.compras
  add constraint compras_status_check
  check (status in ('rascunho', 'comprado', 'recebida', 'cancelada'));

create or replace function public.marcar_compra_comprada(_compra_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cmp public.compras;
begin
  if not public.can_stock(auth.uid()) and not public.can_finance(auth.uid()) then
    raise exception 'Sem permissão para alterar compras';
  end if;

  select * into cmp from public.compras where id = _compra_id for update;
  if cmp is null then raise exception 'Compra não encontrada'; end if;
  if cmp.status <> 'rascunho' then
    raise exception 'Somente compras em rascunho podem ser marcadas como compradas';
  end if;
  if not exists (select 1 from public.compra_itens where compra_id = _compra_id) then
    raise exception 'Inclua ao menos um item na compra';
  end if;

  perform public.recalcular_compra(_compra_id);
  update public.compras set status = 'comprado' where id = _compra_id;
end;
$$;

grant execute on function public.marcar_compra_comprada(uuid) to authenticated;

-- 2) Receber NF passa a aceitar compras já marcadas como "comprado"
do $$
declare
  def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'receber_compra'
   limit 1;
  if def is null then return; end if;
  def := replace(
    def,
    'cmp.status <> ''rascunho''',
    'cmp.status not in (''rascunho'', ''comprado'')'
  );
  execute def;
end
$$;

-- 3) Quantidade comprada pendente de recebimento, por produto
create or replace view public.vw_produto_comprado as
select ci.produto_id,
       sum(ci.quantidade)::numeric(14, 3) as quantidade_comprada
  from public.compra_itens ci
  join public.compras c on c.id = ci.compra_id
 where c.status = 'comprado'
 group by ci.produto_id;

grant select on public.vw_produto_comprado to authenticated;
grant select on public.vw_produto_comprado to service_role;

-- 4) Permitir (ou não) venda com estoque negativo, por produto
alter table public.produtos
  add column if not exists permite_estoque_negativo boolean not null default false;

create or replace function public.validar_estoque_negativo()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  delta numeric(14, 3);
  prod record;
begin
  delta := case
    when new.tipo = 'entrada' then abs(new.quantidade)
    when new.tipo = 'saida' then -abs(new.quantidade)
    else new.quantidade
  end;

  if delta >= 0 then return new; end if;

  select descricao, coalesce(estoque_atual, 0) as saldo,
         coalesce(permite_estoque_negativo, false) as permite
    into prod
    from public.produtos
   where id = new.produto_id;

  if prod is null then return new; end if;

  if not prod.permite and prod.saldo + delta < 0 then
    raise exception 'Estoque insuficiente para % (saldo %, saída %). Habilite "permite estoque negativo" no cadastro do produto para liberar.',
      prod.descricao, prod.saldo, abs(delta);
  end if;

  return new;
end;
$$;

drop trigger if exists aa_valida_estoque_negativo on public.estoque_movimentos;
create trigger aa_valida_estoque_negativo
  before insert on public.estoque_movimentos
  for each row execute function public.validar_estoque_negativo();
