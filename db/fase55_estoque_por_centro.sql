-- Fase 55: estoque por centro de distribuição
-- Mantém produtos.estoque_atual como saldo global para compatibilidade,
-- mas passa a manter saldo e custo médio também por centro.
-- Mercado Livre e Shopee não fazem parte deste projeto.

begin;

create table if not exists public.estoque_saldos (
  produto_id uuid not null references public.produtos(id) on delete restrict,
  centro_id uuid not null references public.centros(id) on delete cascade,
  quantidade numeric(14,3) not null default 0,
  custo_medio numeric(14,4) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (produto_id, centro_id)
);

create index if not exists estoque_saldos_centro_idx
  on public.estoque_saldos(centro_id, produto_id);

grant select on public.estoque_saldos to authenticated;
grant all on public.estoque_saldos to service_role;
alter table public.estoque_saldos enable row level security;

drop policy if exists estoque_saldos_select on public.estoque_saldos;
create policy estoque_saldos_select
  on public.estoque_saldos
  for select to authenticated
  using (public.usuario_pode_acessar_centro(centro_id));

-- Reconstrói o saldo por centro a partir do histórico já existente.
insert into public.estoque_saldos (produto_id, centro_id, quantidade, custo_medio)
select
  m.produto_id,
  m.centro_id,
  sum(
    case
      when m.tipo = 'entrada' then abs(m.quantidade)
      when m.tipo = 'saida' then -abs(m.quantidade)
      else m.quantidade
    end
  )::numeric(14,3) as quantidade,
  coalesce(
    sum(case when m.tipo = 'entrada' and m.custo_unitario is not null
             then abs(m.quantidade) * m.custo_unitario else 0 end)
    / nullif(sum(case when m.tipo = 'entrada' and m.custo_unitario is not null
                      then abs(m.quantidade) else 0 end), 0),
    0
  )::numeric(14,4) as custo_medio
from public.estoque_movimentos m
where m.centro_id is not null
group by m.produto_id, m.centro_id
on conflict (produto_id, centro_id) do update
set quantidade = excluded.quantidade,
    custo_medio = excluded.custo_medio,
    updated_at = now();

-- Produtos antigos que já possuíam um centro cadastrado e ainda não tinham
-- movimentação por centro recebem o saldo legado nesse centro.
insert into public.estoque_saldos (produto_id, centro_id, quantidade, custo_medio)
select p.id, p.centro_id, coalesce(p.estoque_atual,0), coalesce(p.custo_medio,0)
  from public.produtos p
 where p.centro_id is not null
   and not exists (
     select 1 from public.estoque_saldos s
      where s.produto_id = p.id
   )
on conflict (produto_id, centro_id) do nothing;

-- O saldo por centro só pode ser alterado pelo motor de estoque.
revoke insert, update, delete on public.estoque_saldos from authenticated;

create or replace function public.aplicar_movimento_estoque()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  delta numeric(14,3);
  saldo_anterior numeric(14,3);
  saldo_novo numeric(14,3);
  custo_anterior numeric(14,4);
  custo_novo numeric(14,4);
begin
  delta := case
    when new.tipo = 'entrada' then abs(new.quantidade)
    when new.tipo = 'saida' then -abs(new.quantidade)
    else new.quantidade
  end;

  if new.centro_id is not null then
    insert into public.estoque_saldos (produto_id, centro_id)
    values (new.produto_id, new.centro_id)
    on conflict (produto_id, centro_id) do nothing;

    select quantidade, custo_medio
      into saldo_anterior, custo_anterior
      from public.estoque_saldos
     where produto_id = new.produto_id
       and centro_id = new.centro_id
     for update;

    saldo_novo := coalesce(saldo_anterior, 0) + delta;
    custo_novo := case
      when new.tipo = 'entrada' and new.custo_unitario is not null and saldo_novo > 0
      then (
        (coalesce(saldo_anterior,0) * coalesce(custo_anterior,0))
        + (abs(new.quantidade) * new.custo_unitario)
      ) / saldo_novo
      else coalesce(custo_anterior, 0)
    end;

    update public.estoque_saldos
       set quantidade = saldo_novo,
           custo_medio = custo_novo,
           updated_at = now()
     where produto_id = new.produto_id
       and centro_id = new.centro_id;
  end if;

  -- Mantém o saldo global legado para relatórios e telas ainda não migradas.
  update public.produtos
     set estoque_atual = coalesce(estoque_atual, 0) + delta,
         custo_medio = case
           when new.tipo = 'entrada' and new.custo_unitario is not null
             and coalesce(estoque_atual, 0) + delta > 0
           then ((coalesce(estoque_atual,0) * coalesce(custo_medio,0))
                 + (abs(new.quantidade) * new.custo_unitario))
                / (coalesce(estoque_atual,0) + delta)
           else custo_medio
         end
   where id = new.produto_id;

  return new;
end;
$$;

-- Validação de estoque negativo passa a respeitar o centro da movimentação.
create or replace function public.validar_estoque_negativo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  delta numeric(14,3);
  saldo numeric(14,3);
  permite boolean;
  descricao_produto text;
begin
  delta := case
    when new.tipo = 'entrada' then abs(new.quantidade)
    when new.tipo = 'saida' then -abs(new.quantidade)
    else new.quantidade
  end;

  if delta >= 0 then return new; end if;

  select descricao, coalesce(permite_estoque_negativo, false)
    into descricao_produto, permite
    from public.produtos
   where id = new.produto_id;

  if new.centro_id is not null then
    insert into public.estoque_saldos (produto_id, centro_id)
    values (new.produto_id, new.centro_id)
    on conflict (produto_id, centro_id) do nothing;

    select quantidade
      into saldo
      from public.estoque_saldos
     where produto_id = new.produto_id
       and centro_id = new.centro_id
     for update;
  else
    select coalesce(estoque_atual, 0)
      into saldo
      from public.produtos
     where id = new.produto_id
     for update;
  end if;

  if coalesce(permite, false) = false and coalesce(saldo, 0) + delta < 0 then
    raise exception 'Estoque insuficiente para % no centro selecionado (saldo %, saída %). Habilite "permite estoque negativo" no cadastro do produto para liberar.',
      coalesce(descricao_produto, 'produto'), coalesce(saldo, 0), abs(delta);
  end if;

  return new;
end;
$$;

drop trigger if exists aa_valida_estoque_negativo on public.estoque_movimentos;
create trigger aa_valida_estoque_negativo
  before insert on public.estoque_movimentos
  for each row execute function public.validar_estoque_negativo();

-- Movimentação manual deve carregar o centro escolhido.
create or replace function public.lancar_movimento_estoque(
  _produto_id uuid,
  _centro_id uuid,
  _tipo text,
  _quantidade numeric,
  _custo_unitario numeric default null,
  _origem text default 'manual',
  _documento_id uuid default null,
  _observacao text default null
) returns public.estoque_movimentos
language plpgsql
security definer
set search_path = public
as $$
declare
  movimento public.estoque_movimentos;
begin
  if not public.can_stock(auth.uid()) then
    raise exception 'Sem permissão para movimentar estoque';
  end if;
  if _produto_id is null or _centro_id is null then
    raise exception 'Produto e centro são obrigatórios';
  end if;
  if not public.usuario_pode_acessar_centro(_centro_id) then
    raise exception 'Usuário sem acesso ao centro informado';
  end if;
  if _tipo not in ('entrada','saida','ajuste') then
    raise exception 'Tipo de movimento inválido';
  end if;
  if coalesce(_quantidade, 0) = 0 then
    raise exception 'A quantidade deve ser diferente de zero';
  end if;

  insert into public.estoque_movimentos
    (produto_id, centro_id, tipo, quantidade, custo_unitario, origem, documento_id, observacao, created_by)
  values
    (_produto_id, _centro_id, _tipo, _quantidade, _custo_unitario, coalesce(_origem,'manual'),
     _documento_id, _observacao, auth.uid())
  returning * into movimento;

  return movimento;
end;
$$;

grant execute on function public.lancar_movimento_estoque(uuid, uuid, text, numeric, numeric, text, uuid, text)
  to authenticated;

-- Transferência entre centros: duas movimentações dentro da mesma transação.
create table if not exists public.transferencias_estoque (
  id uuid primary key default gen_random_uuid(),
  origem_centro_id uuid not null references public.centros(id) on delete restrict,
  destino_centro_id uuid not null references public.centros(id) on delete restrict,
  status text not null default 'concluida' check (status in ('concluida','cancelada')),
  observacao text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (origem_centro_id <> destino_centro_id)
);

create table if not exists public.transferencias_estoque_itens (
  id uuid primary key default gen_random_uuid(),
  transferencia_id uuid not null references public.transferencias_estoque(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete restrict,
  quantidade numeric(14,3) not null check (quantidade > 0),
  custo_unitario numeric(14,4),
  created_at timestamptz not null default now()
);

create index if not exists transferencias_estoque_origem_idx
  on public.transferencias_estoque(origem_centro_id, created_at desc);
create index if not exists transferencias_estoque_destino_idx
  on public.transferencias_estoque(destino_centro_id, created_at desc);
create index if not exists transferencias_estoque_itens_produto_idx
  on public.transferencias_estoque_itens(produto_id);

grant select on public.transferencias_estoque to authenticated;
grant select on public.transferencias_estoque_itens to authenticated;
revoke insert, update, delete on public.transferencias_estoque from authenticated;
revoke insert, update, delete on public.transferencias_estoque_itens from authenticated;
grant all on public.transferencias_estoque to service_role;
grant all on public.transferencias_estoque_itens to service_role;
alter table public.transferencias_estoque enable row level security;
alter table public.transferencias_estoque_itens enable row level security;

drop policy if exists transferencias_estoque_select on public.transferencias_estoque;
create policy transferencias_estoque_select
  on public.transferencias_estoque for select to authenticated
  using (
    public.usuario_pode_acessar_centro(origem_centro_id)
    and public.usuario_pode_acessar_centro(destino_centro_id)
  );

drop policy if exists transferencias_estoque_itens_select on public.transferencias_estoque_itens;
create policy transferencias_estoque_itens_select
  on public.transferencias_estoque_itens for select to authenticated
  using (
    exists (
      select 1 from public.transferencias_estoque t
       where t.id = transferencia_id
         and public.usuario_pode_acessar_centro(t.origem_centro_id)
         and public.usuario_pode_acessar_centro(t.destino_centro_id)
    )
  );

create or replace function public.transferir_estoque(
  _origem_centro_id uuid,
  _destino_centro_id uuid,
  _itens jsonb,
  _observacao text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  transferencia_id uuid;
  item jsonb;
  produto uuid;
  qtd numeric(14,3);
  custo numeric(14,4);
begin
  if not public.can_stock(auth.uid()) then
    raise exception 'Sem permissão para transferir estoque';
  end if;
  if _origem_centro_id is null or _destino_centro_id is null
     or _origem_centro_id = _destino_centro_id then
    raise exception 'Informe centros de origem e destino diferentes';
  end if;
  if not public.usuario_pode_acessar_centro(_origem_centro_id)
     or not public.usuario_pode_acessar_centro(_destino_centro_id) then
    raise exception 'Usuário sem acesso aos centros da transferência';
  end if;
  if _itens is null or jsonb_typeof(_itens) <> 'array' or jsonb_array_length(_itens) = 0 then
    raise exception 'Informe ao menos um item';
  end if;

  insert into public.transferencias_estoque
    (origem_centro_id, destino_centro_id, observacao, created_by)
  values
    (_origem_centro_id, _destino_centro_id, nullif(_observacao,''), auth.uid())
  returning id into transferencia_id;

  for item in select value from jsonb_array_elements(_itens)
  loop
    produto := (item->>'produto_id')::uuid;
    qtd := (item->>'quantidade')::numeric;
    custo := nullif(item->>'custo_unitario','')::numeric;

    if produto is null or qtd is null or qtd <= 0 then
      raise exception 'Item de transferência inválido';
    end if;

    select coalesce(
             (select s.custo_medio
                from public.estoque_saldos s
               where s.produto_id = p.id
                 and s.centro_id = _origem_centro_id),
             p.custo_medio,
             0
           )
      into custo
      from public.produtos p
     where p.id = produto;

    insert into public.transferencias_estoque_itens
      (transferencia_id, produto_id, quantidade, custo_unitario)
    values (transferencia_id, produto, qtd, custo);

    insert into public.estoque_movimentos
      (produto_id, centro_id, tipo, quantidade, custo_unitario, origem, documento_id, observacao, created_by)
    values
      (produto, _origem_centro_id, 'saida', qtd, custo, 'transferencia', transferencia_id, _observacao, auth.uid()),
      (produto, _destino_centro_id, 'entrada', qtd, custo, 'transferencia', transferencia_id, _observacao, auth.uid());
  end loop;

  return transferencia_id;
end;
$$;

grant execute on function public.transferir_estoque(uuid, uuid, jsonb, text) to authenticated;

-- Compra pendente deve ser segregada por centro.
drop view if exists public.vw_produto_comprado;
create view public.vw_produto_comprado
with (security_invoker = on) as
select ci.produto_id,
       c.centro_id,
       sum(ci.quantidade)::numeric(14, 3) as quantidade_comprada
  from public.compra_itens ci
  join public.compras c on c.id = ci.compra_id
 where c.status = 'comprado'
 group by ci.produto_id, c.centro_id;

grant select on public.vw_produto_comprado to authenticated;
grant select on public.vw_produto_comprado to service_role;

commit;
