-- ============================================================
-- FASE 32 - Base financeira: contas (banco/caixa), categorias,
-- movimentacoes com saldo auditavel e transferencias.
-- Idempotente. Nao remove nem altera estruturas existentes.
-- ============================================================

-- ---------- categorias / subcategorias ----------
create table if not exists public.categorias_financeiras (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  nome text not null,
  tipo text not null default 'despesa' check (tipo in ('receita','despesa')),
  parent_id uuid references public.categorias_financeiras(id) on delete restrict,
  grupo_dre text not null default 'despesa_operacional'
    check (grupo_dre in ('receita_bruta','deducao','cpv','despesa_administrativa',
                         'despesa_comercial','despesa_vendas','despesa_logistica',
                         'despesa_operacional','despesa_financeira','receita_financeira','outras')),
  padrao_para text check (padrao_para in ('compra','comissao','frete','recebimento','tarifa','rota')),
  ordem integer not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists categorias_financeiras_parent_idx on public.categorias_financeiras(parent_id);
create index if not exists categorias_financeiras_tipo_idx on public.categorias_financeiras(tipo, ativo);

grant select, insert, update, delete on public.categorias_financeiras to authenticated;
grant all on public.categorias_financeiras to service_role;
alter table public.categorias_financeiras enable row level security;

drop policy if exists "categorias_financeiras_select" on public.categorias_financeiras;
create policy "categorias_financeiras_select" on public.categorias_financeiras
for select to authenticated using (true);

drop policy if exists "categorias_financeiras_write" on public.categorias_financeiras;
create policy "categorias_financeiras_write" on public.categorias_financeiras
for all to authenticated
using (public.can_finance(auth.uid())) with check (public.can_finance(auth.uid()));

drop trigger if exists trg_categorias_financeiras_updated on public.categorias_financeiras;
create trigger trg_categorias_financeiras_updated before update on public.categorias_financeiras
for each row execute function public.set_updated_at();

create sequence if not exists public.seq_codigo_categoria_financeira;
drop trigger if exists trg_codigo_categorias_financeiras on public.categorias_financeiras;
create trigger trg_codigo_categorias_financeiras before insert on public.categorias_financeiras
for each row execute function public.gerar_codigo('', 'public.seq_codigo_categoria_financeira');

-- ---------- contas financeiras (banco / caixa) ----------
create table if not exists public.contas_financeiras (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  nome text not null,
  tipo text not null default 'banco'
    check (tipo in ('banco','caixa','conta_corrente','conta_poupanca','conta_pagamento','outros')),
  banco text,
  agencia text,
  conta text,
  saldo_inicial numeric(14,2) not null default 0,
  data_saldo_inicial date not null default current_date,
  centro_id uuid references public.centros(id) on delete set null,
  observacoes text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contas_financeiras_centro_idx on public.contas_financeiras(centro_id);

grant select, insert, update, delete on public.contas_financeiras to authenticated;
grant all on public.contas_financeiras to service_role;
alter table public.contas_financeiras enable row level security;

drop policy if exists "contas_financeiras_select" on public.contas_financeiras;
create policy "contas_financeiras_select" on public.contas_financeiras
for select to authenticated using (public.can_finance(auth.uid()));

drop policy if exists "contas_financeiras_write" on public.contas_financeiras;
create policy "contas_financeiras_write" on public.contas_financeiras
for all to authenticated
using (public.can_finance(auth.uid())) with check (public.can_finance(auth.uid()));

drop trigger if exists trg_contas_financeiras_updated on public.contas_financeiras;
create trigger trg_contas_financeiras_updated before update on public.contas_financeiras
for each row execute function public.set_updated_at();

create sequence if not exists public.seq_codigo_conta_financeira;
drop trigger if exists trg_codigo_contas_financeiras on public.contas_financeiras;
create trigger trg_codigo_contas_financeiras before insert on public.contas_financeiras
for each row execute function public.gerar_codigo('', 'public.seq_codigo_conta_financeira');

-- ---------- transferencias entre contas ----------
create table if not exists public.transferencias (
  id uuid primary key default gen_random_uuid(),
  conta_origem_id uuid not null references public.contas_financeiras(id) on delete restrict,
  conta_destino_id uuid not null references public.contas_financeiras(id) on delete restrict,
  valor numeric(14,2) not null check (valor > 0),
  data date not null default current_date,
  historico text,
  status text not null default 'ativa' check (status in ('ativa','estornada')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint transferencias_contas_diferentes check (conta_origem_id <> conta_destino_id)
);

create index if not exists transferencias_data_idx on public.transferencias(data);

grant select, insert, update on public.transferencias to authenticated;
grant all on public.transferencias to service_role;
alter table public.transferencias enable row level security;

drop policy if exists "transferencias_select" on public.transferencias;
create policy "transferencias_select" on public.transferencias
for select to authenticated using (public.can_finance(auth.uid()));

drop policy if exists "transferencias_write" on public.transferencias;
create policy "transferencias_write" on public.transferencias
for all to authenticated
using (public.can_finance(auth.uid())) with check (public.can_finance(auth.uid()));

-- ---------- movimentacoes financeiras ----------
create table if not exists public.movimentos_financeiros (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas_financeiras(id) on delete restrict,
  data date not null default current_date,
  tipo text not null check (tipo in ('entrada','saida')),
  origem text not null default 'ajuste'
    check (origem in ('recebimento','pagamento','transferencia','ajuste','receita','despesa','estorno')),
  valor numeric(14,2) not null check (valor > 0),
  categoria_id uuid references public.categorias_financeiras(id) on delete set null,
  centro_id uuid references public.centros(id) on delete set null,
  forma_pagamento_id uuid references public.formas_pagamento(id) on delete set null,
  conta_receber_id uuid references public.contas_receber(id) on delete set null,
  conta_pagar_id uuid references public.contas_pagar(id) on delete set null,
  transferencia_id uuid references public.transferencias(id) on delete set null,
  estorno_de uuid references public.movimentos_financeiros(id) on delete set null,
  dre_ignorar boolean not null default false,
  descricao text,
  documento text,
  status text not null default 'ativo' check (status in ('ativo','estornado')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists movimentos_conta_data_idx on public.movimentos_financeiros(conta_id, data);
create index if not exists movimentos_data_idx on public.movimentos_financeiros(data);
create index if not exists movimentos_categoria_idx on public.movimentos_financeiros(categoria_id);
create index if not exists movimentos_centro_idx on public.movimentos_financeiros(centro_id);
create index if not exists movimentos_receber_idx on public.movimentos_financeiros(conta_receber_id);
create index if not exists movimentos_pagar_idx on public.movimentos_financeiros(conta_pagar_id);
create index if not exists movimentos_transferencia_idx on public.movimentos_financeiros(transferencia_id);

grant select, insert, update on public.movimentos_financeiros to authenticated;
grant all on public.movimentos_financeiros to service_role;
alter table public.movimentos_financeiros enable row level security;

drop policy if exists "movimentos_financeiros_select" on public.movimentos_financeiros;
create policy "movimentos_financeiros_select" on public.movimentos_financeiros
for select to authenticated using (public.can_finance(auth.uid()));

drop policy if exists "movimentos_financeiros_write" on public.movimentos_financeiros;
create policy "movimentos_financeiros_write" on public.movimentos_financeiros
for all to authenticated
using (public.can_finance(auth.uid())) with check (public.can_finance(auth.uid()));

drop trigger if exists trg_movimentos_financeiros_updated on public.movimentos_financeiros;
create trigger trg_movimentos_financeiros_updated before update on public.movimentos_financeiros
for each row execute function public.set_updated_at();

-- transferencia nunca entra no resultado (DRE)
create or replace function public.movimento_defaults()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.origem = 'transferencia' then
    new.dre_ignorar := true;
  end if;
  if new.centro_id is null then
    select c.centro_id into new.centro_id from public.contas_financeiras c where c.id = new.conta_id;
  end if;
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_movimento_defaults on public.movimentos_financeiros;
create trigger trg_movimento_defaults before insert on public.movimentos_financeiros
for each row execute function public.movimento_defaults();

-- ---------- saldos e extrato (calculados) ----------
create or replace view public.vw_conta_saldo as
select
  c.id as conta_id,
  c.codigo,
  c.nome,
  c.tipo,
  c.banco,
  c.centro_id,
  c.ativo,
  c.saldo_inicial,
  c.data_saldo_inicial,
  coalesce(sum(case when m.tipo = 'entrada' and m.origem <> 'transferencia' then m.valor else 0 end), 0) as entradas,
  coalesce(sum(case when m.tipo = 'saida' and m.origem <> 'transferencia' then m.valor else 0 end), 0) as saidas,
  coalesce(sum(case when m.origem = 'transferencia' and m.tipo = 'entrada' then m.valor
                    when m.origem = 'transferencia' and m.tipo = 'saida' then -m.valor else 0 end), 0) as transferencias,
  c.saldo_inicial
    + coalesce(sum(case when m.tipo = 'entrada' then m.valor else -m.valor end), 0) as saldo_atual
from public.contas_financeiras c
left join public.movimentos_financeiros m
  on m.conta_id = c.id and m.status = 'ativo'
group by c.id;

alter view public.vw_conta_saldo set (security_invoker = on);
grant select on public.vw_conta_saldo to authenticated;

create or replace view public.vw_extrato_conta as
select
  m.id,
  m.conta_id,
  cf.nome as conta_nome,
  m.data,
  m.tipo,
  m.origem,
  m.valor,
  case when m.tipo = 'entrada' then m.valor else -m.valor end as valor_assinado,
  m.descricao,
  m.documento,
  m.status,
  m.centro_id,
  m.categoria_id,
  cat.nome as categoria_nome,
  pai.nome as categoria_pai,
  m.conta_receber_id,
  m.conta_pagar_id,
  m.transferencia_id,
  m.created_at,
  m.created_by,
  sum(case when m.status = 'ativo' then (case when m.tipo = 'entrada' then m.valor else -m.valor end) else 0 end)
    over (partition by m.conta_id order by m.data, m.created_at, m.id
          rows between unbounded preceding and current row)
    + cf.saldo_inicial as saldo_acumulado
from public.movimentos_financeiros m
join public.contas_financeiras cf on cf.id = m.conta_id
left join public.categorias_financeiras cat on cat.id = m.categoria_id
left join public.categorias_financeiras pai on pai.id = cat.parent_id;

alter view public.vw_extrato_conta set (security_invoker = on);
grant select on public.vw_extrato_conta to authenticated;

-- ---------- RPC: transferencia ----------
create or replace function public.transferir_entre_contas(
  _origem uuid, _destino uuid, _valor numeric, _data date default current_date, _historico text default null
) returns public.transferencias
language plpgsql
volatile
security definer
set search_path = public
as $$
declare t public.transferencias;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para transferir valores';
  end if;
  if _origem = _destino then raise exception 'Escolha contas diferentes'; end if;
  if coalesce(_valor, 0) <= 0 then raise exception 'Informe um valor maior que zero'; end if;

  insert into public.transferencias (conta_origem_id, conta_destino_id, valor, data, historico, created_by)
  values (_origem, _destino, _valor, coalesce(_data, current_date), nullif(_historico,''), auth.uid())
  returning * into t;

  insert into public.movimentos_financeiros
    (conta_id, data, tipo, origem, valor, transferencia_id, descricao, created_by)
  values (_origem, t.data, 'saida', 'transferencia', t.valor,
          t.id, coalesce(t.historico, 'Transferencia entre contas'), auth.uid()),
         (_destino, t.data, 'entrada', 'transferencia', t.valor,
          t.id, coalesce(t.historico, 'Transferencia entre contas'), auth.uid());

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('transferencias', t.id, 'transferir',
          jsonb_build_object('origem', _origem, 'destino', _destino, 'valor', t.valor), auth.uid());

  return t;
end;
$$;

grant execute on function public.transferir_entre_contas(uuid, uuid, numeric, date, text) to authenticated;

create or replace function public.estornar_transferencia(_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare t public.transferencias;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para estornar transferencias';
  end if;
  select * into t from public.transferencias where id = _id for update;
  if t is null then raise exception 'Transferencia nao encontrada'; end if;
  if t.status = 'estornada' then raise exception 'Transferencia ja estornada'; end if;

  update public.movimentos_financeiros set status = 'estornado'
   where transferencia_id = _id;
  update public.transferencias set status = 'estornada' where id = _id;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('transferencias', _id, 'estornar', jsonb_build_object('valor', t.valor), auth.uid());
end;
$$;

grant execute on function public.estornar_transferencia(uuid) to authenticated;

-- ---------- RPC: movimento manual e estorno ----------
create or replace function public.lancar_movimento(
  _conta_id uuid,
  _tipo text,
  _valor numeric,
  _data date default current_date,
  _categoria_id uuid default null,
  _centro_id uuid default null,
  _descricao text default null,
  _documento text default null
) returns public.movimentos_financeiros
language plpgsql
volatile
security definer
set search_path = public
as $$
declare m public.movimentos_financeiros;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para lancar movimentacoes';
  end if;
  if _tipo not in ('entrada','saida') then raise exception 'Tipo invalido'; end if;
  if coalesce(_valor,0) <= 0 then raise exception 'Informe um valor maior que zero'; end if;

  insert into public.movimentos_financeiros
    (conta_id, data, tipo, origem, valor, categoria_id, centro_id, descricao, documento, created_by)
  values (_conta_id, coalesce(_data, current_date), _tipo,
          case when _tipo = 'entrada' then 'receita' else 'despesa' end,
          _valor, _categoria_id, _centro_id, nullif(_descricao,''), nullif(_documento,''), auth.uid())
  returning * into m;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('movimentos_financeiros', m.id, 'lancar',
          jsonb_build_object('tipo', _tipo, 'valor', _valor, 'conta', _conta_id), auth.uid());

  return m;
end;
$$;

grant execute on function public.lancar_movimento(uuid, text, numeric, date, uuid, uuid, text, text) to authenticated;

create or replace function public.estornar_movimento(_id uuid, _motivo text default null)
returns public.movimentos_financeiros
language plpgsql
volatile
security definer
set search_path = public
as $$
declare orig public.movimentos_financeiros; novo public.movimentos_financeiros;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para estornar movimentacoes';
  end if;
  select * into orig from public.movimentos_financeiros where id = _id for update;
  if orig is null then raise exception 'Movimentacao nao encontrada'; end if;
  if orig.status = 'estornado' then raise exception 'Movimentacao ja estornada'; end if;
  if orig.transferencia_id is not null then
    raise exception 'Use o estorno da transferencia';
  end if;

  update public.movimentos_financeiros set status = 'estornado' where id = _id;

  insert into public.movimentos_financeiros
    (conta_id, data, tipo, origem, valor, categoria_id, centro_id, estorno_de,
     descricao, documento, dre_ignorar, created_by)
  values (orig.conta_id, current_date,
          case when orig.tipo = 'entrada' then 'saida' else 'entrada' end,
          'estorno', orig.valor, orig.categoria_id, orig.centro_id, orig.id,
          coalesce(nullif(_motivo,''), 'Estorno de movimentacao'), orig.documento,
          orig.dre_ignorar, auth.uid())
  returning * into novo;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('movimentos_financeiros', _id, 'estornar',
          jsonb_build_object('valor', orig.valor, 'motivo', _motivo), auth.uid());

  return novo;
end;
$$;

grant execute on function public.estornar_movimento(uuid, text) to authenticated;

-- ---------- categorias padrao ----------
with pais as (
  insert into public.categorias_financeiras (nome, tipo, grupo_dre, ordem)
  select v.nome, 'despesa', v.grupo, v.ordem
    from (values
      ('Despesas Operacionais', 'despesa_operacional', 10),
      ('Despesas Administrativas', 'despesa_administrativa', 20),
      ('Despesas Comerciais', 'despesa_comercial', 30),
      ('Despesas Financeiras', 'despesa_financeira', 40),
      ('Despesas de Logística', 'despesa_logistica', 50)
    ) as v(nome, grupo, ordem)
   where not exists (
     select 1 from public.categorias_financeiras c where c.nome = v.nome and c.parent_id is null
   )
  returning id, nome
)
select count(*) from pais;

insert into public.categorias_financeiras (nome, tipo, parent_id, grupo_dre, ordem)
select v.nome, 'despesa', p.id, p.grupo_dre, v.ordem
  from (values
    ('Despesas Operacionais', 'Combustível', 1),
    ('Despesas Operacionais', 'Alimentação', 2),
    ('Despesas Operacionais', 'Hotel', 3),
    ('Despesas Operacionais', 'Manutenção', 4),
    ('Despesas Operacionais', 'Pedágios', 5),
    ('Despesas Administrativas', 'Energia', 1),
    ('Despesas Administrativas', 'Internet', 2),
    ('Despesas Administrativas', 'Telefone', 3),
    ('Despesas Administrativas', 'Material de escritório', 4),
    ('Despesas Administrativas', 'Serviços', 5),
    ('Despesas Comerciais', 'Comissões', 1),
    ('Despesas Comerciais', 'Marketing', 2),
    ('Despesas Comerciais', 'Bonificações', 3),
    ('Despesas Comerciais', 'Representação', 4),
    ('Despesas Financeiras', 'Tarifas bancárias', 1),
    ('Despesas Financeiras', 'Juros', 2),
    ('Despesas Financeiras', 'Taxas', 3)
  ) as v(pai, nome, ordem)
  join public.categorias_financeiras p on p.nome = v.pai and p.parent_id is null
 where not exists (
   select 1 from public.categorias_financeiras c where c.nome = v.nome and c.parent_id = p.id
 );

insert into public.categorias_financeiras (nome, tipo, grupo_dre, ordem)
select v.nome, 'receita', v.grupo, v.ordem
  from (values
    ('Receita de Vendas', 'receita_bruta', 1),
    ('Receitas Financeiras', 'receita_financeira', 2),
    ('Outras Receitas', 'outras', 3)
  ) as v(nome, grupo, ordem)
 where not exists (
   select 1 from public.categorias_financeiras c where c.nome = v.nome and c.parent_id is null
 );

-- caixa padrao para quem ainda nao tem conta cadastrada
insert into public.contas_financeiras (nome, tipo, saldo_inicial)
select 'Caixa Geral', 'caixa', 0
 where not exists (select 1 from public.contas_financeiras);

-- ---------- fim da fase 32 ----------
