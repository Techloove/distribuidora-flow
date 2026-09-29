-- Fase 54: hardening de seguranca, isolamento por centro e concorrencia.
-- Esta migration e aditiva/idempotente. Nao remove dados.

-- 1) Isolamento por centro no banco.
create or replace function public.usuario_pode_acessar_centro(_centro_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'gestor')
    or (
      _centro_id is not null
      and (
        coalesce((select p.todos_centros from public.profiles p where p.id = auth.uid()), false)
        or exists (
          select 1
          from public.usuario_centros uc
          where uc.user_id = auth.uid()
            and uc.centro_id = _centro_id
        )
      )
    );
$$;

grant execute on function public.usuario_pode_acessar_centro(uuid) to authenticated;

-- 2) Boletos: deriva o centro do título antes da inserção, evitando boleto sem escopo.
create or replace function public.definir_centro_boleto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.centro_id is null and new.conta_receber_id is not null then
    select centro_id into new.centro_id
      from public.contas_receber
     where id = new.conta_receber_id;
  end if;
  if new.centro_id is null then
    raise exception 'Centro é obrigatório para boleto';
  end if;
  return new;
end;
$$;

drop trigger if exists definir_centro_boleto_trg on public.boletos;
create trigger definir_centro_boleto_trg
before insert or update on public.boletos
for each row execute function public.definir_centro_boleto();

-- 3) Views devem respeitar RLS das tabelas subjacentes.
do $$
begin
  if to_regclass('public.vw_vendas_rota') is not null then
    execute 'alter view public.vw_vendas_rota set (security_invoker = on)';
  end if;
  if to_regclass('public.vw_vendas_rota_cidade') is not null then
    execute 'alter view public.vw_vendas_rota_cidade set (security_invoker = on)';
  end if;
  if to_regclass('public.vw_produtos_rota') is not null then
    execute 'alter view public.vw_produtos_rota set (security_invoker = on)';
  end if;
  if to_regclass('public.vw_vendas_representante_rota') is not null then
    execute 'alter view public.vw_vendas_representante_rota set (security_invoker = on)';
  end if;
end $$;

-- 4) Tabelas financeiras/logisticas que possuem centro_id.
-- SELECT passa a respeitar o centro. Escritas continuam sujeitas as permissoes
-- funcionais existentes e, para tabelas com centro_id, ao mesmo escopo.
do $$
begin
  if to_regclass('public.boletos') is not null then
    execute 'drop policy if exists boletos_select on public.boletos';
    execute 'create policy boletos_select on public.boletos for select to authenticated using (public.tem_permissao(''financeiro_ver'') and public.usuario_pode_acessar_centro(centro_id))';
    execute 'drop policy if exists boletos_write on public.boletos';
    execute 'create policy boletos_write on public.boletos for all to authenticated using (public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id)) with check (public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id))';
  end if;

  if to_regclass('public.contas_financeiras') is not null then
    execute 'drop policy if exists contas_financeiras_select on public.contas_financeiras';
    execute 'create policy contas_financeiras_select on public.contas_financeiras for select to authenticated using (public.tem_permissao(''bancos_ver'') and public.usuario_pode_acessar_centro(centro_id))';
    execute 'drop policy if exists contas_financeiras_write on public.contas_financeiras';
    execute 'create policy contas_financeiras_write on public.contas_financeiras for all to authenticated using (public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id)) with check (public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id))';
  end if;

  if to_regclass('public.movimentos_financeiros') is not null then
    execute 'drop policy if exists movimentos_financeiros_select on public.movimentos_financeiros';
    execute 'create policy movimentos_financeiros_select on public.movimentos_financeiros for select to authenticated using (public.tem_permissao(''bancos_ver'') and public.usuario_pode_acessar_centro(centro_id))';
    execute 'drop policy if exists movimentos_financeiros_write on public.movimentos_financeiros';
    execute 'create policy movimentos_financeiros_write on public.movimentos_financeiros for all to authenticated using (public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id)) with check (public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id))';
  end if;

  if to_regclass('public.transferencias') is not null then
    execute 'drop policy if exists transferencias_select on public.transferencias';
    execute 'create policy transferencias_select on public.transferencias for select to authenticated using (public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id))';
    execute 'drop policy if exists transferencias_write on public.transferencias';
    execute 'create policy transferencias_write on public.transferencias for all to authenticated using (public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id)) with check (public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id))';
  end if;

  if to_regclass('public.cargas') is not null then
    execute 'drop policy if exists cargas_select on public.cargas';
    execute 'create policy cargas_select on public.cargas for select to authenticated using (public.usuario_pode_acessar_centro(centro_id))';
    execute 'drop policy if exists cargas_write on public.cargas';
    execute 'create policy cargas_write on public.cargas for all to authenticated using (public.can_ship(auth.uid()) and public.usuario_pode_acessar_centro(centro_id)) with check (public.can_ship(auth.uid()) and public.usuario_pode_acessar_centro(centro_id))';
  end if;

  if to_regclass('public.estoque_movimentos') is not null then
    execute 'drop policy if exists estoque_movimentos_select on public.estoque_movimentos';
    execute 'create policy estoque_movimentos_select on public.estoque_movimentos for select to authenticated using (public.usuario_pode_acessar_centro(centro_id))';
    execute 'drop policy if exists estoque_movimentos_insert on public.estoque_movimentos';
    execute 'create policy estoque_movimentos_insert on public.estoque_movimentos for insert to authenticated with check (public.can_stock(auth.uid()) and public.usuario_pode_acessar_centro(centro_id))';
  end if;

  if to_regclass('public.pedidos') is not null then
    execute 'drop policy if exists pedidos_select_auth on public.pedidos';
    execute 'create policy pedidos_select_auth on public.pedidos for select to authenticated using (public.usuario_pode_acessar_centro(centro_id) and (not public.escopo_representante() or representante_id = public.meu_representante_id()))';
  end if;

  if to_regclass('public.compras') is not null then
    execute 'drop policy if exists compras_select_auth on public.compras';
    execute 'create policy compras_select_auth on public.compras for select to authenticated using (public.usuario_pode_acessar_centro(centro_id))';
  end if;

  if to_regclass('public.pedido_separacoes') is not null then
    execute 'drop policy if exists sep_select on public.pedido_separacoes';
    execute 'create policy sep_select on public.pedido_separacoes for select to authenticated using (exists (select 1 from public.pedidos p where p.id = pedido_id and public.usuario_pode_acessar_centro(p.centro_id)))';
    execute 'drop policy if exists sep_write on public.pedido_separacoes';
    execute 'create policy sep_write on public.pedido_separacoes for all to authenticated using (public.can_stock(auth.uid()) and exists (select 1 from public.pedidos p where p.id = pedido_id and public.usuario_pode_acessar_centro(p.centro_id))) with check (public.can_stock(auth.uid()) and exists (select 1 from public.pedidos p where p.id = pedido_id and public.usuario_pode_acessar_centro(p.centro_id)))';
  end if;

  if to_regclass('public.carga_pedidos') is not null then
    execute 'drop policy if exists carga_pedidos_select on public.carga_pedidos';
    execute 'create policy carga_pedidos_select on public.carga_pedidos for select to authenticated using (exists (select 1 from public.cargas c where c.id = carga_id and public.usuario_pode_acessar_centro(c.centro_id)))';
    execute 'drop policy if exists carga_pedidos_write on public.carga_pedidos';
    execute 'create policy carga_pedidos_write on public.carga_pedidos for all to authenticated using (public.can_ship(auth.uid()) and exists (select 1 from public.cargas c where c.id = carga_id and public.usuario_pode_acessar_centro(c.centro_id))) with check (public.can_ship(auth.uid()) and exists (select 1 from public.cargas c where c.id = carga_id and public.usuario_pode_acessar_centro(c.centro_id)))';
  end if;
end $$;

-- 5) Índices para as políticas de escopo.
create index if not exists comissoes_centro_idx on public.comissoes(centro_id);
create index if not exists contas_pagar_centro_idx on public.contas_pagar(centro_id);
create index if not exists pedido_separacoes_pedido_idx on public.pedido_separacoes(pedido_id);
create index if not exists carga_pedidos_carga_idx on public.carga_pedidos(carga_id);
create index if not exists pedidos_centro_idx on public.pedidos(centro_id);
create index if not exists compras_centro_idx on public.compras(centro_id);
create index if not exists boletos_centro_idx on public.boletos(centro_id);
create index if not exists cargas_centro_idx on public.cargas(centro_id);
create index if not exists estoque_movimentos_centro_idx on public.estoque_movimentos(centro_id);
create index if not exists usuario_centros_centro_idx on public.usuario_centros(centro_id);

-- 6) Concorrencia: bloqueia as comissoes antes de criar o lote de pagamento.
create or replace function public.pagar_comissoes(
  _representante_id uuid,
  _comissao_ids uuid[],
  _vencimento date default current_date,
  _categoria_id uuid default null,
  _conta_id uuid default null,
  _forma_id uuid default null,
  _observacao text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  lote_id uuid;
  conta_id uuid;
  total numeric(14,2);
  qtd integer;
  centro uuid;
  ini date;
  fim date;
  rep_nome text;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para pagar comissoes';
  end if;

  if _comissao_ids is null or cardinality(_comissao_ids) = 0 then
    raise exception 'Nenhuma comissao selecionada';
  end if;

  -- Serializa pagamentos concorrentes das mesmas comissoes.
  perform 1
  from public.comissoes cm
  where cm.id = any(_comissao_ids)
    and cm.representante_id = _representante_id
    and cm.status in ('prevista','liberada')
  for update;

  select coalesce(sum(cm.valor), 0), count(*), min(cm.centro_id),
         min(coalesce(p.data_pedido, cm.created_at::date)),
         max(coalesce(p.data_pedido, cm.created_at::date))
    into total, qtd, centro, ini, fim
  from public.comissoes cm
  left join public.pedidos p on p.id = cm.pedido_id
  where cm.id = any(_comissao_ids)
    and cm.representante_id = _representante_id
    and cm.status in ('prevista','liberada');

  if coalesce(qtd, 0) = 0 then
    raise exception 'Nenhuma comissao elegivel selecionada';
  end if;
  if total <= 0 then
    raise exception 'Valor total das comissoes deve ser maior que zero';
  end if;

  -- Todas as comissoes do lote devem pertencer ao mesmo centro.
  if exists (
    select 1
    from public.comissoes cm
    where cm.id = any(_comissao_ids)
      and cm.representante_id = _representante_id
      and cm.status in ('prevista','liberada')
      and cm.centro_id is distinct from centro
  ) then
    raise exception 'As comissoes selecionadas pertencem a centros diferentes';
  end if;

  if not public.usuario_pode_acessar_centro(centro) then
    raise exception 'Usuario sem acesso ao centro das comissoes';
  end if;

  if _conta_id is not null and not exists (
    select 1 from public.contas_financeiras cf
    where cf.id = _conta_id
      and public.usuario_pode_acessar_centro(cf.centro_id)
      and cf.centro_id is not distinct from centro
  ) then
    raise exception 'Conta financeira invalida ou de outro centro';
  end if;

  select nome into rep_nome from public.representantes where id = _representante_id;

  insert into public.contas_pagar
    (fornecedor_id, documento, parcela, valor, vencimento, data_emissao, status,
     centro_id, categoria_id, forma_pagamento_id, conta_financeira_id, descricao, observacao)
  values
    (null, null, 1, total, coalesce(_vencimento, current_date), current_date, 'aberto',
     centro, _categoria_id, _forma_id, _conta_id,
     'Comissao ' || coalesce(rep_nome, 'representante') ||
       ' (' || to_char(coalesce(ini, current_date), 'DD/MM/YYYY') || ' a ' ||
       to_char(coalesce(fim, current_date), 'DD/MM/YYYY') || ')',
     _observacao)
  returning id into conta_id;

  insert into public.comissao_pagamentos
    (representante_id, centro_id, competencia, periodo_inicio, periodo_fim,
     quantidade, valor_total, conta_pagar_id, vencimento, observacao, created_by)
  values
    (_representante_id, centro, to_char(coalesce(fim, current_date), 'YYYY-MM'), ini, fim,
     qtd, total, conta_id, coalesce(_vencimento, current_date), _observacao, auth.uid())
  returning id into lote_id;

  insert into public.comissao_pagamento_itens (pagamento_id, comissao_id, valor)
  select lote_id, cm.id, cm.valor
  from public.comissoes cm
  where cm.id = any(_comissao_ids)
    and cm.representante_id = _representante_id
    and cm.status in ('prevista','liberada');

  update public.comissoes
     set status = 'paga'
   where id in (select comissao_id from public.comissao_pagamento_itens where pagamento_id = lote_id);

  return lote_id;
end;
$$;

grant execute on function public.pagar_comissoes(uuid, uuid[], date, uuid, uuid, uuid, text) to authenticated;
