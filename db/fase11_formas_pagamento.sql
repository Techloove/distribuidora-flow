-- Fase 11: formas de pagamento + vinculo em pedidos/compras
create table if not exists public.formas_pagamento (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  nome text not null,
  tipo text not null default 'boleto'
    check (tipo in ('dinheiro','pix','boleto','cartao_credito','cartao_debito','transferencia','cheque','prazo')),
  parcelas_padrao integer not null default 1 check (parcelas_padrao between 1 and 36),
  dias_primeira_parcela integer not null default 30 check (dias_primeira_parcela >= 0),
  intervalo_dias integer not null default 30 check (intervalo_dias >= 0),
  taxa_percentual numeric(5,2) not null default 0,
  observacoes text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.formas_pagamento to authenticated;
grant all on public.formas_pagamento to service_role;
alter table public.formas_pagamento enable row level security;

drop policy if exists "formas_pagamento_select" on public.formas_pagamento;
create policy "formas_pagamento_select" on public.formas_pagamento for select using (true);
drop policy if exists "formas_pagamento_write" on public.formas_pagamento;
create policy "formas_pagamento_write" on public.formas_pagamento for all
  using (public.can_manage(auth.uid())) with check (public.can_manage(auth.uid()));

drop trigger if exists set_updated_at_formas_pagamento on public.formas_pagamento;
create trigger set_updated_at_formas_pagamento before update on public.formas_pagamento
  for each row execute function public.set_updated_at();

create sequence if not exists public.seq_codigo_forma_pagamento;
drop trigger if exists trg_codigo_formas_pagamento on public.formas_pagamento;
create trigger trg_codigo_formas_pagamento before insert on public.formas_pagamento
  for each row execute function public.gerar_codigo('', 'public.seq_codigo_forma_pagamento');

-- vinculo nos documentos
alter table public.pedidos add column if not exists forma_pagamento_id uuid references public.formas_pagamento(id);
alter table public.compras add column if not exists forma_pagamento_id uuid references public.formas_pagamento(id);
create index if not exists pedidos_forma_pagamento_idx on public.pedidos(forma_pagamento_id);
create index if not exists pedidos_centro_idx on public.pedidos(centro_id);

-- formas padrao
insert into public.formas_pagamento (nome, tipo, parcelas_padrao, dias_primeira_parcela, intervalo_dias)
select v.nome, v.tipo, v.p, v.d, v.i
  from (values
    ('Dinheiro', 'dinheiro', 1, 0, 0),
    ('PIX', 'pix', 1, 0, 0),
    ('Cartão de crédito', 'cartao_credito', 1, 30, 30),
    ('Boleto 30 dias', 'boleto', 1, 30, 30),
    ('Boleto 30/60', 'boleto', 2, 30, 30),
    ('Boleto 30/60/90', 'boleto', 3, 30, 30)
  ) as v(nome, tipo, p, d, i)
 where not exists (select 1 from public.formas_pagamento f where f.nome = v.nome);

-- alinha sequencia de codigos
select setval('public.seq_codigo_forma_pagamento',
  greatest(1, coalesce((select max(nullif(regexp_replace(codigo,'\D','','g'),'')::bigint) from public.formas_pagamento), 0)));

update public.formas_pagamento set codigo = sub.n::text
  from (select id, row_number() over (order by created_at, id) as n from public.formas_pagamento) sub
 where sub.id = formas_pagamento.id and (formas_pagamento.codigo is null or btrim(formas_pagamento.codigo) = '');
create or replace function public.confirmar_pedido(_pedido_id uuid)
returns public.pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  ped public.pedidos;
  fp public.formas_pagamento;
  item record;
  n int;
  valor_parcela numeric(14,2);
  saldo numeric(14,2);
  dias_1 int := 30;
  intervalo int := 30;
begin
  if not public.can_operate(auth.uid()) then
    raise exception 'Sem permissão para confirmar pedidos';
  end if;

  select * into ped from public.pedidos where id = _pedido_id for update;
  if ped is null then raise exception 'Pedido não encontrado'; end if;
  if ped.status <> 'rascunho' then raise exception 'Pedido já foi confirmado ou cancelado'; end if;
  if not exists (select 1 from public.pedido_itens where pedido_id = _pedido_id) then
    raise exception 'Inclua ao menos um item no pedido';
  end if;
  if ped.forma_pagamento_id is null then
    raise exception 'Selecione a forma de pagamento do pedido';
  end if;

  select * into fp from public.formas_pagamento where id = ped.forma_pagamento_id;
  if fp.id is not null then
    dias_1 := fp.dias_primeira_parcela;
    intervalo := fp.intervalo_dias;
  end if;

  perform public.recalcular_pedido(_pedido_id);
  select * into ped from public.pedidos where id = _pedido_id;

  for item in select produto_id, sum(quantidade) as qtd
                from public.pedido_itens where pedido_id = _pedido_id group by produto_id loop
    insert into public.estoque_movimentos
      (produto_id, centro_id, tipo, quantidade, origem, documento_id, observacao, created_by)
    values (item.produto_id, ped.centro_id, 'saida', item.qtd, 'pedido', _pedido_id,
            'Baixa por confirmação de pedido', auth.uid());
  end loop;

  valor_parcela := round(ped.total_liquido / greatest(ped.parcelas, 1), 2);
  saldo := ped.total_liquido;
  for n in 1..greatest(ped.parcelas, 1) loop
    if n = ped.parcelas then valor_parcela := saldo; end if;
    insert into public.contas_receber
      (cliente_id, pedido_id, documento, parcela, valor, vencimento)
    values (ped.cliente_id, ped.id, 'PED-' || ped.numero, n, valor_parcela,
            ped.data_pedido + (dias_1 + (n - 1) * intervalo));
    saldo := saldo - valor_parcela;
  end loop;

  if ped.representante_id is not null and ped.comissao_valor > 0 then
    insert into public.comissoes
      (representante_id, pedido_id, base_calculo, percentual, valor)
    values (ped.representante_id, ped.id, ped.total_itens, ped.comissao_percentual, ped.comissao_valor);
  end if;

  update public.pedidos set status = 'confirmado' where id = _pedido_id returning * into ped;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('pedidos', _pedido_id, 'confirmar',
          jsonb_build_object('total', ped.total_liquido, 'parcelas', ped.parcelas), auth.uid());

  return ped;
end;
$$;
