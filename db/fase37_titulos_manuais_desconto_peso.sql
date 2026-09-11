-- ============================================================
-- FASE 37 - Lancamento manual de titulos (receber) +
-- desconto escalonado por peso (kg) nos pedidos.
-- Idempotente. Nada existente e removido.
-- ============================================================

-- ---------- receita parcelada manual (espelho de criar_despesa) ----------
create or replace function public.criar_receita(
  _cliente_id uuid,
  _categoria_id uuid,
  _centro_id uuid,
  _descricao text,
  _documento text,
  _valor numeric,
  _parcelas integer default 1,
  _primeiro_vencimento date default current_date,
  _intervalo_dias integer default 30,
  _forma_id uuid default null,
  _conta_id uuid default null
) returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare n integer; parcelas integer; valor_parcela numeric(14,2); saldo numeric(14,2);
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para lancar titulos a receber';
  end if;
  if coalesce(_valor,0) <= 0 then raise exception 'Informe um valor maior que zero'; end if;

  parcelas := greatest(coalesce(_parcelas,1), 1);
  valor_parcela := round(_valor / parcelas, 2);
  saldo := _valor;

  for n in 1..parcelas loop
    if n = parcelas then valor_parcela := saldo; end if;
    insert into public.contas_receber
      (cliente_id, documento, parcela, valor, vencimento, data_emissao, status,
       centro_id, categoria_id, forma_pagamento_id, conta_financeira_id, descricao, observacao)
    values (_cliente_id, nullif(_documento,''), n, valor_parcela,
            coalesce(_primeiro_vencimento, current_date) + ((n - 1) * coalesce(_intervalo_dias,30)),
            current_date, 'aberto', _centro_id, _categoria_id, _forma_id, _conta_id,
            nullif(_descricao,''), nullif(_descricao,''));
    saldo := saldo - valor_parcela;
  end loop;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('contas_receber', null, 'lancamento_manual',
          jsonb_build_object('valor', _valor, 'parcelas', parcelas, 'descricao', _descricao), auth.uid());

  return parcelas;
end;
$$;

grant execute on function public.criar_receita(uuid, uuid, uuid, text, text, numeric, integer, date, integer, uuid, uuid) to authenticated;

-- ---------- faixas de desconto por peso ----------
create table if not exists public.desconto_faixas_peso (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria text,                       -- null = vale para todos os produtos
  peso_min numeric(14,3) not null default 0,
  peso_max numeric(14,3),               -- null = sem limite superior
  percentual numeric(5,2) not null default 0,
  ativo boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists desconto_faixas_peso_faixa_idx
  on public.desconto_faixas_peso(ativo, peso_min, peso_max);

grant select, insert, update, delete on public.desconto_faixas_peso to authenticated;
grant all on public.desconto_faixas_peso to service_role;

alter table public.desconto_faixas_peso enable row level security;

drop policy if exists desconto_faixas_peso_select on public.desconto_faixas_peso;
create policy desconto_faixas_peso_select on public.desconto_faixas_peso
  for select to authenticated using (true);

drop policy if exists desconto_faixas_peso_write on public.desconto_faixas_peso;
create policy desconto_faixas_peso_write on public.desconto_faixas_peso
  to authenticated using (public.can_finance(auth.uid()))
  with check (public.can_finance(auth.uid()));

drop trigger if exists set_updated_at on public.desconto_faixas_peso;
create trigger set_updated_at before update on public.desconto_faixas_peso
  for each row execute function public.set_updated_at();

-- faixas iniciais (somente se a tabela estiver vazia)
insert into public.desconto_faixas_peso (nome, categoria, peso_min, peso_max, percentual, ordem)
select * from (values
  ('Desconto 1 - ate 3.000 kg', null::text, 0::numeric, 3000::numeric, 2::numeric, 1),
  ('Desconto 2 - 3.001 a 5.000 kg', null, 3000.001, 5000, 3, 2),
  ('Desconto 3 - 5.001 a 10.000 kg', null, 5000.001, 10000, 4, 3),
  ('Desconto 4 - acima de 10.000 kg', null, 10000.001, null, 5, 4)
) v
where not exists (select 1 from public.desconto_faixas_peso);

-- ---------- calculo do desconto por peso do pedido ----------
create or replace function public.desconto_peso_pedido(_pedido_id uuid)
returns table (
  peso_total numeric,
  faixa_id uuid,
  faixa_nome text,
  percentual numeric,
  desconto_valor numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare ped record; peso numeric(14,3); f record; melhor record; base numeric(14,2);
begin
  select * into ped from public.pedidos where id = _pedido_id;
  if ped is null then return; end if;

  select coalesce(sum(i.quantidade * coalesce(p.peso_kg, 0)), 0)
    into peso
    from public.pedido_itens i
    join public.produtos p on p.id = i.produto_id
   where i.pedido_id = _pedido_id;

  base := coalesce(ped.total_itens, 0);
  melhor := null;

  for f in
    select * from public.desconto_faixas_peso where ativo order by ordem, peso_min
  loop
    declare peso_escopo numeric(14,3);
    begin
      if f.categoria is null then
        peso_escopo := peso;
      else
        select coalesce(sum(i.quantidade * coalesce(p.peso_kg, 0)), 0)
          into peso_escopo
          from public.pedido_itens i
          join public.produtos p on p.id = i.produto_id
         where i.pedido_id = _pedido_id
           and lower(coalesce(p.categoria,'')) = lower(f.categoria);
      end if;

      if peso_escopo >= f.peso_min
         and (f.peso_max is null or peso_escopo <= f.peso_max)
         and peso_escopo > 0
         and (melhor is null or f.percentual > melhor.percentual) then
        melhor := f;
      end if;
    end;
  end loop;

  if melhor is null then
    return query select peso, null::uuid, null::text, 0::numeric, 0::numeric;
  else
    return query select peso, melhor.id, melhor.nome::text, melhor.percentual,
                        round(base * melhor.percentual / 100, 2);
  end if;
end;
$$;

grant execute on function public.desconto_peso_pedido(uuid) to authenticated;

-- ---------- aplicar o desconto calculado no pedido ----------
create or replace function public.aplicar_desconto_peso(_pedido_id uuid)
returns numeric
language plpgsql
volatile
security definer
set search_path = public
as $$
declare info record; ped record;
begin
  if not public.can_operate(auth.uid()) then
    raise exception 'Sem permissao para alterar pedidos';
  end if;

  select * into ped from public.pedidos where id = _pedido_id;
  if ped is null then raise exception 'Pedido nao encontrado'; end if;
  if ped.status not in ('rascunho','digitacao') then
    raise exception 'O desconto por peso so pode ser aplicado em pedidos em rascunho';
  end if;

  select * into info from public.desconto_peso_pedido(_pedido_id);

  update public.pedidos set desconto_valor = coalesce(info.desconto_valor, 0)
   where id = _pedido_id;

  perform public.recalcular_pedido(_pedido_id);

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('pedidos', _pedido_id, 'desconto_peso',
          jsonb_build_object('peso_total', info.peso_total, 'faixa', info.faixa_nome,
                             'percentual', info.percentual, 'desconto', info.desconto_valor),
          auth.uid());

  return coalesce(info.desconto_valor, 0);
end;
$$;

grant execute on function public.aplicar_desconto_peso(uuid) to authenticated;

-- ---------- fim da fase 37 ----------
