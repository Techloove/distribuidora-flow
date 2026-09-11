-- ============================================================
-- FASE 33 - Contas a receber / a pagar aprimorados
-- Novos campos, baixa com banco/caixa + juros/multa/desconto,
-- baixa em lote, estorno, despesa parcelada, indicadores.
-- Idempotente. Nada e removido; RPCs antigas continuam validas.
-- ============================================================

-- ---------- novos campos nos titulos ----------
alter table public.contas_receber add column if not exists data_emissao date;
alter table public.contas_receber add column if not exists desconto numeric(14,2) not null default 0;
alter table public.contas_receber add column if not exists acrescimo numeric(14,2) not null default 0;
alter table public.contas_receber add column if not exists juros numeric(14,2) not null default 0;
alter table public.contas_receber add column if not exists multa numeric(14,2) not null default 0;
alter table public.contas_receber add column if not exists forma_pagamento_id uuid references public.formas_pagamento(id) on delete set null;
alter table public.contas_receber add column if not exists conta_financeira_id uuid references public.contas_financeiras(id) on delete set null;
alter table public.contas_receber add column if not exists categoria_id uuid references public.categorias_financeiras(id) on delete set null;
alter table public.contas_receber add column if not exists descricao text;

alter table public.contas_pagar add column if not exists data_emissao date;
alter table public.contas_pagar add column if not exists desconto numeric(14,2) not null default 0;
alter table public.contas_pagar add column if not exists acrescimo numeric(14,2) not null default 0;
alter table public.contas_pagar add column if not exists juros numeric(14,2) not null default 0;
alter table public.contas_pagar add column if not exists multa numeric(14,2) not null default 0;
alter table public.contas_pagar add column if not exists forma_pagamento_id uuid references public.formas_pagamento(id) on delete set null;
alter table public.contas_pagar add column if not exists conta_financeira_id uuid references public.contas_financeiras(id) on delete set null;
alter table public.contas_pagar add column if not exists categoria_id uuid references public.categorias_financeiras(id) on delete set null;
alter table public.contas_pagar add column if not exists descricao text;

update public.contas_receber set data_emissao = coalesce(data_emissao, created_at::date) where data_emissao is null;
update public.contas_pagar set data_emissao = coalesce(data_emissao, created_at::date) where data_emissao is null;

create index if not exists contas_receber_venc_status_idx on public.contas_receber(vencimento, status);
create index if not exists contas_receber_cliente_idx on public.contas_receber(cliente_id);
create index if not exists contas_receber_conta_fin_idx on public.contas_receber(conta_financeira_id);
create index if not exists contas_pagar_venc_status_idx on public.contas_pagar(vencimento, status);
create index if not exists contas_pagar_fornecedor_idx on public.contas_pagar(fornecedor_id);
create index if not exists contas_pagar_categoria_idx on public.contas_pagar(categoria_id);
create index if not exists contas_pagar_conta_fin_idx on public.contas_pagar(conta_financeira_id);

-- ---------- views com saldo e status efetivo ----------
create or replace view public.vw_titulos_receber as
select
  t.*,
  c.razao_social as parceiro,
  round(t.valor + t.juros + t.multa + t.acrescimo - t.desconto - coalesce(t.valor_pago,0), 2) as saldo,
  case
    when t.status = 'cancelado' then 'cancelado'
    when t.status = 'pago' then 'pago'
    when coalesce(t.valor_pago,0) > 0 and t.vencimento < current_date then 'vencido_parcial'
    when coalesce(t.valor_pago,0) > 0 then 'parcial'
    when t.vencimento < current_date then 'vencido'
    else 'aberto'
  end as status_efetivo,
  fp.nome as forma_pagamento,
  cf.nome as conta_nome,
  ct.nome as centro_nome
from public.contas_receber t
left join public.clientes c on c.id = t.cliente_id
left join public.formas_pagamento fp on fp.id = t.forma_pagamento_id
left join public.contas_financeiras cf on cf.id = t.conta_financeira_id
left join public.centros ct on ct.id = t.centro_id;

alter view public.vw_titulos_receber set (security_invoker = on);
grant select on public.vw_titulos_receber to authenticated;

create or replace view public.vw_titulos_pagar as
select
  t.*,
  f.razao_social as parceiro,
  round(t.valor + t.juros + t.multa + t.acrescimo - t.desconto - coalesce(t.valor_pago,0), 2) as saldo,
  case
    when t.status = 'cancelado' then 'cancelado'
    when t.status = 'pago' then 'pago'
    when coalesce(t.valor_pago,0) > 0 and t.vencimento < current_date then 'vencido_parcial'
    when coalesce(t.valor_pago,0) > 0 then 'parcial'
    when t.vencimento < current_date then 'vencido'
    else 'aberto'
  end as status_efetivo,
  fp.nome as forma_pagamento,
  cf.nome as conta_nome,
  ct.nome as centro_nome,
  cat.nome as categoria_nome,
  pai.nome as categoria_pai
from public.contas_pagar t
left join public.fornecedores f on f.id = t.fornecedor_id
left join public.formas_pagamento fp on fp.id = t.forma_pagamento_id
left join public.contas_financeiras cf on cf.id = t.conta_financeira_id
left join public.centros ct on ct.id = t.centro_id
left join public.categorias_financeiras cat on cat.id = t.categoria_id
left join public.categorias_financeiras pai on pai.id = cat.parent_id;

alter view public.vw_titulos_pagar set (security_invoker = on);
grant select on public.vw_titulos_pagar to authenticated;

-- ---------- baixa com movimentacao bancaria ----------
create or replace function public.receber_titulo(
  _id uuid,
  _valor numeric,
  _data date default current_date,
  _conta_id uuid default null,
  _forma_id uuid default null,
  _juros numeric default 0,
  _multa numeric default 0,
  _desconto numeric default 0,
  _observacao text default null
) returns public.contas_receber
language plpgsql
volatile
security definer
set search_path = public
as $$
declare titulo public.contas_receber; pago numeric(14,2); devido numeric(14,2); conta uuid;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Somente financeiro/gestor pode receber titulos';
  end if;
  if coalesce(_valor,0) <= 0 then raise exception 'Informe um valor maior que zero'; end if;

  select * into titulo from public.contas_receber where id = _id for update;
  if titulo is null then raise exception 'Titulo nao encontrado'; end if;
  if titulo.status = 'cancelado' then raise exception 'Titulo cancelado'; end if;

  conta := coalesce(_conta_id, titulo.conta_financeira_id,
                    (select id from public.contas_financeiras where ativo order by created_at limit 1));
  if conta is null then raise exception 'Cadastre uma conta de banco/caixa antes de receber'; end if;

  update public.contas_receber
     set juros = juros + coalesce(_juros,0),
         multa = multa + coalesce(_multa,0),
         desconto = desconto + coalesce(_desconto,0)
   where id = _id returning * into titulo;

  devido := titulo.valor + titulo.juros + titulo.multa + titulo.acrescimo - titulo.desconto;
  pago := least(coalesce(titulo.valor_pago,0) + _valor, devido);

  update public.contas_receber
     set valor_pago = pago,
         conta_financeira_id = conta,
         forma_pagamento_id = coalesce(_forma_id, forma_pagamento_id),
         data_pagamento = case when pago >= devido then coalesce(_data, current_date) else data_pagamento end,
         status = case when pago >= devido then 'pago' when pago > 0 then 'parcial' else 'aberto' end,
         observacao = coalesce(nullif(_observacao,''), observacao)
   where id = _id returning * into titulo;

  insert into public.movimentos_financeiros
    (conta_id, data, tipo, origem, valor, centro_id, forma_pagamento_id,
     conta_receber_id, categoria_id, descricao, documento, created_by)
  values (conta, coalesce(_data, current_date), 'entrada', 'recebimento', _valor,
          titulo.centro_id, coalesce(_forma_id, titulo.forma_pagamento_id), titulo.id,
          coalesce(titulo.categoria_id,
                   (select id from public.categorias_financeiras
                     where tipo = 'receita' and grupo_dre = 'receita_bruta' and parent_id is null
                     order by ordem limit 1)),
          'Recebimento ' || coalesce(titulo.documento,'titulo') ||
            ' parcela ' || coalesce(titulo.parcela,1)::text,
          titulo.documento, auth.uid());

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('contas_receber', _id, 'baixa',
          jsonb_build_object('valor', _valor, 'conta', conta, 'pago_antes',
                             coalesce(titulo.valor_pago,0) - _valor, 'pago_depois', pago), auth.uid());

  return titulo;
end;
$$;

grant execute on function public.receber_titulo(uuid, numeric, date, uuid, uuid, numeric, numeric, numeric, text) to authenticated;

create or replace function public.pagar_titulo(
  _id uuid,
  _valor numeric,
  _data date default current_date,
  _conta_id uuid default null,
  _forma_id uuid default null,
  _juros numeric default 0,
  _multa numeric default 0,
  _desconto numeric default 0,
  _observacao text default null
) returns public.contas_pagar
language plpgsql
volatile
security definer
set search_path = public
as $$
declare titulo public.contas_pagar; pago numeric(14,2); devido numeric(14,2); conta uuid;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Somente financeiro/gestor pode pagar titulos';
  end if;
  if coalesce(_valor,0) <= 0 then raise exception 'Informe um valor maior que zero'; end if;

  select * into titulo from public.contas_pagar where id = _id for update;
  if titulo is null then raise exception 'Titulo nao encontrado'; end if;
  if titulo.status = 'cancelado' then raise exception 'Titulo cancelado'; end if;

  conta := coalesce(_conta_id, titulo.conta_financeira_id,
                    (select id from public.contas_financeiras where ativo order by created_at limit 1));
  if conta is null then raise exception 'Cadastre uma conta de banco/caixa antes de pagar'; end if;

  update public.contas_pagar
     set juros = juros + coalesce(_juros,0),
         multa = multa + coalesce(_multa,0),
         desconto = desconto + coalesce(_desconto,0)
   where id = _id returning * into titulo;

  devido := titulo.valor + titulo.juros + titulo.multa + titulo.acrescimo - titulo.desconto;
  pago := least(coalesce(titulo.valor_pago,0) + _valor, devido);

  update public.contas_pagar
     set valor_pago = pago,
         conta_financeira_id = conta,
         forma_pagamento_id = coalesce(_forma_id, forma_pagamento_id),
         data_pagamento = case when pago >= devido then coalesce(_data, current_date) else data_pagamento end,
         status = case when pago >= devido then 'pago' when pago > 0 then 'parcial' else 'aberto' end,
         observacao = coalesce(nullif(_observacao,''), observacao)
   where id = _id returning * into titulo;

  insert into public.movimentos_financeiros
    (conta_id, data, tipo, origem, valor, centro_id, forma_pagamento_id,
     conta_pagar_id, categoria_id, descricao, documento, created_by)
  values (conta, coalesce(_data, current_date), 'saida', 'pagamento', _valor,
          titulo.centro_id, coalesce(_forma_id, titulo.forma_pagamento_id), titulo.id,
          titulo.categoria_id,
          'Pagamento ' || coalesce(titulo.documento,'titulo') ||
            ' parcela ' || coalesce(titulo.parcela,1)::text,
          titulo.documento, auth.uid());

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('contas_pagar', _id, 'baixa',
          jsonb_build_object('valor', _valor, 'conta', conta, 'pago_depois', pago), auth.uid());

  return titulo;
end;
$$;

grant execute on function public.pagar_titulo(uuid, numeric, date, uuid, uuid, numeric, numeric, numeric, text) to authenticated;

-- ---------- baixa em lote ----------
create or replace function public.baixar_titulos_lote(
  _tabela text,
  _ids uuid[],
  _data date default current_date,
  _conta_id uuid default null,
  _forma_id uuid default null
) returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare id uuid; saldo numeric(14,2); n integer := 0;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para baixar titulos';
  end if;
  if _tabela not in ('contas_receber','contas_pagar') then
    raise exception 'Tabela invalida';
  end if;

  foreach id in array coalesce(_ids, array[]::uuid[]) loop
    if _tabela = 'contas_receber' then
      select round(valor + juros + multa + acrescimo - desconto - coalesce(valor_pago,0), 2)
        into saldo from public.contas_receber where contas_receber.id = baixar_titulos_lote.id;
      if coalesce(saldo,0) > 0 then
        perform public.receber_titulo(id, saldo, _data, _conta_id, _forma_id);
        n := n + 1;
      end if;
    else
      select round(valor + juros + multa + acrescimo - desconto - coalesce(valor_pago,0), 2)
        into saldo from public.contas_pagar where contas_pagar.id = baixar_titulos_lote.id;
      if coalesce(saldo,0) > 0 then
        perform public.pagar_titulo(id, saldo, _data, _conta_id, _forma_id);
        n := n + 1;
      end if;
    end if;
  end loop;

  return n;
end;
$$;

grant execute on function public.baixar_titulos_lote(text, uuid[], date, uuid, uuid) to authenticated;

-- ---------- estorno de baixa ----------
create or replace function public.estornar_baixa(_movimento_id uuid, _motivo text default null)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare m public.movimentos_financeiros;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para estornar baixas';
  end if;
  select * into m from public.movimentos_financeiros where id = _movimento_id;
  if m is null then raise exception 'Movimentacao nao encontrada'; end if;
  if m.status = 'estornado' then raise exception 'Movimentacao ja estornada'; end if;

  perform public.estornar_movimento(_movimento_id, _motivo);

  if m.conta_receber_id is not null then
    update public.contas_receber
       set valor_pago = greatest(coalesce(valor_pago,0) - m.valor, 0),
           data_pagamento = null,
           status = case when greatest(coalesce(valor_pago,0) - m.valor, 0) > 0 then 'parcial' else 'aberto' end
     where id = m.conta_receber_id;
  end if;

  if m.conta_pagar_id is not null then
    update public.contas_pagar
       set valor_pago = greatest(coalesce(valor_pago,0) - m.valor, 0),
           data_pagamento = null,
           status = case when greatest(coalesce(valor_pago,0) - m.valor, 0) > 0 then 'parcial' else 'aberto' end
     where id = m.conta_pagar_id;
  end if;
end;
$$;

grant execute on function public.estornar_baixa(uuid, text) to authenticated;

-- ---------- despesa parcelada (lancamento manual) ----------
create or replace function public.criar_despesa(
  _fornecedor_id uuid,
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
    raise exception 'Sem permissao para lancar despesas';
  end if;
  if coalesce(_valor,0) <= 0 then raise exception 'Informe um valor maior que zero'; end if;

  parcelas := greatest(coalesce(_parcelas,1), 1);
  valor_parcela := round(_valor / parcelas, 2);
  saldo := _valor;

  for n in 1..parcelas loop
    if n = parcelas then valor_parcela := saldo; end if;
    insert into public.contas_pagar
      (fornecedor_id, documento, parcela, valor, vencimento, data_emissao, status,
       centro_id, categoria_id, forma_pagamento_id, conta_financeira_id, descricao, observacao)
    values (_fornecedor_id, nullif(_documento,''), n, valor_parcela,
            coalesce(_primeiro_vencimento, current_date) + ((n - 1) * coalesce(_intervalo_dias,30)),
            current_date, 'aberto', _centro_id, _categoria_id, _forma_id, _conta_id,
            nullif(_descricao,''), nullif(_descricao,''));
    saldo := saldo - valor_parcela;
  end loop;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('contas_pagar', null, 'despesa',
          jsonb_build_object('valor', _valor, 'parcelas', parcelas, 'descricao', _descricao), auth.uid());

  return parcelas;
end;
$$;

grant execute on function public.criar_despesa(uuid, uuid, uuid, text, text, numeric, integer, date, integer, uuid, uuid) to authenticated;

-- ---------- cancelamento de titulo (sem exclusao) ----------
create or replace function public.cancelar_titulo(_tabela text, _id uuid, _motivo text default null)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para cancelar titulos';
  end if;
  if _tabela = 'contas_receber' then
    update public.contas_receber set status = 'cancelado',
      observacao = coalesce(nullif(_motivo,''), observacao) where id = _id;
  elsif _tabela = 'contas_pagar' then
    update public.contas_pagar set status = 'cancelado',
      observacao = coalesce(nullif(_motivo,''), observacao) where id = _id;
  else
    raise exception 'Tabela invalida';
  end if;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values (_tabela, _id, 'cancelar', jsonb_build_object('motivo', _motivo), auth.uid());
end;
$$;

grant execute on function public.cancelar_titulo(text, uuid, text) to authenticated;

-- ---------- fim da fase 33 ----------
