-- =============================================================
-- FASE 14 — Operação completa
-- Centros de custo em todos os módulos, fluxo de status do pedido,
-- aprovação comercial, separação, rotas/entregas, comissão escalonada,
-- histórico e planejamento de compras, boletos, despesas e RLS por
-- representante.
-- Idempotente: pode ser executado novamente sem erro.
-- =============================================================

-- -------------------------------------------------------------
-- 1. CENTROS DE CUSTO / UNIDADES OPERACIONAIS
-- -------------------------------------------------------------
insert into public.centros (nome, cidade, uf, ativo)
select 'Centro A — Distribuidora 1', null, null, true
where not exists (select 1 from public.centros);
insert into public.centros (nome, cidade, uf, ativo)
select 'Centro B — Distribuidora 2', null, null, true
where (select count(*) from public.centros) = 1;

alter table public.pessoas          add column if not exists centro_id uuid references public.centros(id) on delete set null;
alter table public.clientes         add column if not exists centro_id uuid references public.centros(id) on delete set null;
alter table public.fornecedores     add column if not exists centro_id uuid references public.centros(id) on delete set null;
alter table public.produtos         add column if not exists centro_id uuid references public.centros(id) on delete set null;
alter table public.contas_receber   add column if not exists centro_id uuid references public.centros(id) on delete set null;
alter table public.contas_pagar     add column if not exists centro_id uuid references public.centros(id) on delete set null;
alter table public.comissoes        add column if not exists centro_id uuid references public.centros(id) on delete set null;
alter table public.notas_saida      add column if not exists centro_id uuid references public.centros(id) on delete set null;
alter table public.pedido_itens     add column if not exists centro_id uuid references public.centros(id) on delete set null;
alter table public.representantes   add column if not exists centro_id uuid references public.centros(id) on delete set null;

-- vínculo de pessoa (cliente/fornecedor) com vários centros
create table if not exists public.pessoa_centros (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  centro_id uuid not null references public.centros(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (pessoa_id, centro_id)
);
grant select, insert, update, delete on public.pessoa_centros to authenticated;
grant all on public.pessoa_centros to service_role;
alter table public.pessoa_centros enable row level security;
drop policy if exists pessoa_centros_select on public.pessoa_centros;
create policy pessoa_centros_select on public.pessoa_centros for select to authenticated using (true);
drop policy if exists pessoa_centros_write on public.pessoa_centros;
create policy pessoa_centros_write on public.pessoa_centros for all to authenticated
  using (public.can_manage(auth.uid())) with check (public.can_manage(auth.uid()));

-- herda o centro do pedido para os títulos e comissões gerados
create or replace function public.propagar_centro_receber()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.centro_id is null and new.pedido_id is not null then
    select centro_id into new.centro_id from public.pedidos where id = new.pedido_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_centro_receber on public.contas_receber;
create trigger trg_centro_receber before insert on public.contas_receber
  for each row execute function public.propagar_centro_receber();

create or replace function public.propagar_centro_pagar()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.centro_id is null and new.compra_id is not null then
    select centro_id into new.centro_id from public.compras where id = new.compra_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_centro_pagar on public.contas_pagar;
create trigger trg_centro_pagar before insert on public.contas_pagar
  for each row execute function public.propagar_centro_pagar();

create or replace function public.propagar_centro_comissao()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.centro_id is null and new.pedido_id is not null then
    select centro_id into new.centro_id from public.pedidos where id = new.pedido_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_centro_comissao on public.comissoes;
create trigger trg_centro_comissao before insert on public.comissoes
  for each row execute function public.propagar_centro_comissao();

-- -------------------------------------------------------------
-- 2. CADASTROS: campos complementares
-- -------------------------------------------------------------
alter table public.pessoas add column if not exists whatsapp text;
alter table public.pessoas add column if not exists tipo_representante text;
alter table public.pessoas add column if not exists meta_mensal numeric(14,2) default 0;
alter table public.pessoas add column if not exists cob_logradouro text;
alter table public.pessoas add column if not exists cob_numero text;
alter table public.pessoas add column if not exists cob_bairro text;
alter table public.pessoas add column if not exists cob_cidade text;
alter table public.pessoas add column if not exists cob_uf text;
alter table public.pessoas add column if not exists cob_cep text;
alter table public.pessoas add column if not exists ent_logradouro text;
alter table public.pessoas add column if not exists ent_numero text;
alter table public.pessoas add column if not exists ent_bairro text;
alter table public.pessoas add column if not exists ent_cidade text;
alter table public.pessoas add column if not exists ent_uf text;
alter table public.pessoas add column if not exists ent_cep text;
alter table public.pessoas add column if not exists sequencia_entrega int;

alter table public.produtos add column if not exists sku text;
alter table public.produtos add column if not exists subcategoria text;
alter table public.produtos add column if not exists cest text;
alter table public.produtos add column if not exists cfop text;
alter table public.produtos add column if not exists comprimento_cm numeric(10,2);
alter table public.produtos add column if not exists largura_cm numeric(10,2);
alter table public.produtos add column if not exists altura_cm numeric(10,2);
alter table public.produtos add column if not exists estoque_maximo numeric(14,3) default 0;
alter table public.produtos add column if not exists preco_promocional numeric(14,4);
alter table public.produtos add column if not exists comissao_percentual numeric(5,2);
alter table public.produtos add column if not exists margem_minima numeric(5,2) default 0;
alter table public.produtos add column if not exists ultimo_custo numeric(14,4) default 0;
alter table public.produtos add column if not exists custo_reposicao numeric(14,4) default 0;
alter table public.produtos add column if not exists prazo_fornecedor_dias int default 15;

-- NF de entrada
alter table public.compras add column if not exists chave_acesso text;
alter table public.compras add column if not exists valor_impostos numeric(14,2) default 0;
alter table public.compra_itens add column if not exists lote text;
alter table public.compra_itens add column if not exists validade date;

-- despesas no contas a pagar
alter table public.contas_pagar add column if not exists categoria text default 'fornecedor';
alter table public.contas_pagar alter column fornecedor_id drop not null;

-- -------------------------------------------------------------
-- 3. ROTAS
-- -------------------------------------------------------------
create table if not exists public.rotas (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  nome text not null,
  regiao text,
  cidades text,
  bairros text,
  dia_semana text,
  motorista text,
  veiculo text,
  centro_id uuid references public.centros(id) on delete set null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.rotas to authenticated;
grant all on public.rotas to service_role;
alter table public.rotas enable row level security;
drop policy if exists rotas_select on public.rotas;
create policy rotas_select on public.rotas for select to authenticated using (true);
drop policy if exists rotas_write on public.rotas;
create policy rotas_write on public.rotas for all to authenticated
  using (public.can_manage(auth.uid())) with check (public.can_manage(auth.uid()));
drop trigger if exists set_updated_at_rotas on public.rotas;
create trigger set_updated_at_rotas before update on public.rotas
  for each row execute function public.set_updated_at();

create sequence if not exists public.seq_codigo_rota;
create or replace function public.gerar_codigo_rota()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.codigo is null or new.codigo = '' then
    loop
      new.codigo := nextval('public.seq_codigo_rota')::text;
      exit when not exists (select 1 from public.rotas where codigo = new.codigo);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_codigo_rotas on public.rotas;
create trigger trg_codigo_rotas before insert on public.rotas
  for each row execute function public.gerar_codigo_rota();

alter table public.pessoas    add column if not exists rota_id uuid references public.rotas(id) on delete set null;
alter table public.clientes   add column if not exists rota_id uuid references public.rotas(id) on delete set null;
alter table public.pedidos    add column if not exists rota_id uuid references public.rotas(id) on delete set null;
alter table public.pedidos    add column if not exists previsao_entrega date;
alter table public.pedidos    add column if not exists endereco_entrega text;
alter table public.pedidos    add column if not exists tabela_preco text;
alter table public.expedicoes add column if not exists rota_id uuid references public.rotas(id) on delete set null;
alter table public.expedicoes add column if not exists romaneio text;

-- -------------------------------------------------------------
-- 4. FLUXO DE STATUS DO PEDIDO
-- -------------------------------------------------------------
alter table public.pedidos drop constraint if exists pedidos_status_check;
alter table public.pedidos add constraint pedidos_status_check check (status = any (array[
  'rascunho','digitacao','aguardando_aprovacao','aprovado','recusado',
  'confirmado','separacao','separado','faturado','em_rota',
  'entregue','parcial','nao_entregue','devolvido','cancelado'
]));

create or replace function public.avancar_pedido(_pedido_id uuid, _novo_status text)
returns public.pedidos
language plpgsql security definer set search_path to 'public' as $$
declare
  ped public.pedidos;
  permitido boolean := false;
begin
  select * into ped from public.pedidos where id = _pedido_id for update;
  if ped is null then raise exception 'Pedido não encontrado'; end if;

  permitido := case ped.status
    when 'rascunho'             then _novo_status in ('digitacao','aguardando_aprovacao','cancelado')
    when 'digitacao'            then _novo_status in ('aguardando_aprovacao','cancelado')
    when 'aguardando_aprovacao' then _novo_status in ('aprovado','recusado','cancelado')
    when 'aprovado'             then _novo_status in ('separacao','cancelado')
    when 'confirmado'           then _novo_status in ('separacao','cancelado')
    when 'separacao'            then _novo_status in ('separado','cancelado')
    when 'separado'             then _novo_status in ('em_rota','cancelado')
    when 'faturado'             then _novo_status in ('em_rota','cancelado')
    when 'em_rota'              then _novo_status in ('entregue','parcial','nao_entregue','devolvido')
    else false end;

  if not permitido then
    raise exception 'Transição inválida: % → %', ped.status, _novo_status;
  end if;

  if _novo_status in ('aprovado','recusado') and not public.can_manage(auth.uid()) then
    raise exception 'Somente admin/gestor pode aprovar ou recusar pedidos';
  end if;
  if _novo_status not in ('aprovado','recusado') and not public.can_operate(auth.uid())
     and not public.can_ship(auth.uid()) and not public.can_stock(auth.uid()) then
    raise exception 'Sem permissão para alterar o status do pedido';
  end if;

  update public.pedidos set status = _novo_status where id = _pedido_id returning * into ped;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('pedidos', _pedido_id, 'status',
          jsonb_build_object('de', _novo_status, 'numero', ped.numero), auth.uid());

  perform public.notificar('Pedido ' || ped.numero,
    'Novo status: ' || _novo_status, 'info', '/pedidos');
  return ped;
end $$;

-- confirmar_pedido passa a aceitar pedidos aprovados também
create or replace function public.confirmar_pedido(_pedido_id uuid)
returns public.pedidos
language plpgsql security definer set search_path to 'public' as $$
declare
  ped public.pedidos;
  fp public.formas_pagamento;
  item record;
  n int;
  valor_parcela numeric(14,2);
  saldo numeric(14,2);
  dias_1 int := 30;
  intervalo int := 30;
  bloqueios jsonb;
begin
  if not public.can_operate(auth.uid()) then
    raise exception 'Sem permissão para confirmar pedidos';
  end if;

  select * into ped from public.pedidos where id = _pedido_id for update;
  if ped is null then raise exception 'Pedido não encontrado'; end if;
  if ped.status not in ('rascunho','digitacao','aprovado') then
    raise exception 'Pedido já foi confirmado ou cancelado';
  end if;
  if not exists (select 1 from public.pedido_itens where pedido_id = _pedido_id) then
    raise exception 'Inclua ao menos um item no pedido';
  end if;
  if ped.forma_pagamento_id is null then
    raise exception 'Selecione a forma de pagamento do pedido';
  end if;

  -- aprovação comercial: bloqueios impedem a confirmação
  select jsonb_agg(a) into bloqueios
    from jsonb_array_elements(public.validar_pedido(_pedido_id)) a
   where a->>'nivel' = 'bloqueio';
  if bloqueios is not null and ped.status <> 'aprovado' then
    raise exception 'Pedido bloqueado para aprovação: %',
      (select string_agg(b->>'mensagem', ' | ') from jsonb_array_elements(bloqueios) b);
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
end $$;

-- faturamento aceita confirmado ou separado
create or replace function public.faturar_pedido(_pedido_id uuid, _nf_numero text default null, _serie text default '1')
returns public.notas_saida
language plpgsql security definer set search_path to 'public' as $$
declare
  ped record;
  nota public.notas_saida;
begin
  if not public.can_bill(auth.uid()) then
    raise exception 'Sem permissao para faturar pedidos';
  end if;

  select * into ped from public.pedidos where id = _pedido_id;
  if ped is null then raise exception 'Pedido nao encontrado'; end if;
  if ped.status not in ('confirmado','separacao','separado') then
    raise exception 'Somente pedidos confirmados ou separados podem ser faturados';
  end if;
  if exists (select 1 from public.notas_saida
              where pedido_id = _pedido_id and status = 'emitida') then
    raise exception 'Pedido ja possui nota fiscal emitida';
  end if;

  insert into public.notas_saida
    (pedido_id, cliente_id, centro_id, serie, nf_numero, valor_produtos, valor_frete,
     valor_desconto, valor_total, created_by)
  values (ped.id, ped.cliente_id, ped.centro_id, coalesce(nullif(_serie,''), '1'), nullif(_nf_numero,''),
          ped.total_itens, ped.frete_valor, ped.desconto_valor, ped.total_liquido, auth.uid())
  returning * into nota;

  update public.pedidos set status = 'faturado' where id = _pedido_id;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('notas_saida', nota.id, 'faturar',
          jsonb_build_object('pedido', ped.numero, 'total', nota.valor_total), auth.uid());

  perform public.notificar('Pedido faturado',
    'Pedido ' || ped.numero || ' faturado por ' || to_char(nota.valor_total, 'FM999999990.00'),
    'sucesso', '/faturamento');

  return nota;
end $$;

-- cancelamento devolve estoque em todos os status pós-confirmação
create or replace function public.cancelar_pedido(_pedido_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare ped public.pedidos; item record;
begin
  if not public.can_operate(auth.uid()) then
    raise exception 'Sem permissão para cancelar pedidos';
  end if;
  select * into ped from public.pedidos where id = _pedido_id for update;
  if ped is null then raise exception 'Pedido não encontrado'; end if;
  if ped.status = 'cancelado' then return; end if;

  if ped.status in ('confirmado','separacao','separado','faturado','em_rota') then
    for item in select produto_id, sum(quantidade) as qtd
                  from public.pedido_itens where pedido_id = _pedido_id group by produto_id loop
      insert into public.estoque_movimentos
        (produto_id, centro_id, tipo, quantidade, origem, documento_id, observacao, created_by)
      values (item.produto_id, ped.centro_id, 'entrada', item.qtd, 'pedido_cancelado', _pedido_id,
              'Devolução por cancelamento de pedido', auth.uid());
    end loop;

    update public.contas_receber set status = 'cancelado'
     where pedido_id = _pedido_id and status <> 'pago';
    update public.comissoes set status = 'cancelada' where pedido_id = _pedido_id;
  end if;

  update public.pedidos set status = 'cancelado' where id = _pedido_id;

  insert into public.auditoria (tabela, registro_id, acao, user_id)
  values ('pedidos', _pedido_id, 'cancelar', auth.uid());
end $$;

-- -------------------------------------------------------------
-- 5. APROVAÇÃO COMERCIAL AUTOMÁTICA
-- -------------------------------------------------------------
insert into public.parametros (chave, valor, descricao) values
  ('margem_minima', '10', 'Margem mínima aceita no pedido (%)'),
  ('desconto_maximo', '15', 'Desconto máximo aceito no pedido (%)')
on conflict (chave) do nothing;

create or replace function public.validar_pedido(_pedido_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  ped record;
  cli record;
  res jsonb := '[]'::jsonb;
  vencidos numeric(14,2);
  aberto numeric(14,2);
  margem numeric(14,4);
  custo numeric(14,4);
  desconto_pct numeric(14,4);
  margem_min numeric := coalesce((select valor::numeric from public.parametros where chave = 'margem_minima'), 10);
  desc_max numeric := coalesce((select valor::numeric from public.parametros where chave = 'desconto_maximo'), 15);
  item record;
begin
  select * into ped from public.pedidos where id = _pedido_id;
  if ped is null then return res; end if;
  select * into cli from public.clientes where id = ped.cliente_id;

  select coalesce(sum(valor - coalesce(valor_pago,0)), 0) into vencidos
    from public.contas_receber
   where cliente_id = ped.cliente_id and status not in ('pago','cancelado')
     and vencimento < current_date;
  select coalesce(sum(valor - coalesce(valor_pago,0)), 0) into aberto
    from public.contas_receber
   where cliente_id = ped.cliente_id and status not in ('pago','cancelado');

  if cli.status = 'bloqueado' then
    res := res || jsonb_build_object('nivel','bloqueio','mensagem','Cliente bloqueado no cadastro');
  end if;
  if vencidos > 0 then
    res := res || jsonb_build_object('nivel','bloqueio',
      'mensagem','Cliente possui ' || to_char(vencidos,'FM999999990.00') || ' em títulos vencidos');
  end if;
  if coalesce(cli.limite_credito,0) > 0 and (aberto + ped.total_liquido) > cli.limite_credito then
    res := res || jsonb_build_object('nivel','bloqueio',
      'mensagem','Limite de crédito excedido (limite ' || to_char(cli.limite_credito,'FM999999990.00')
        || ', exposição ' || to_char(aberto + ped.total_liquido,'FM999999990.00') || ')');
  end if;
  if ped.forma_pagamento_id is null then
    res := res || jsonb_build_object('nivel','alerta','mensagem','Forma de pagamento não informada');
  end if;
  if ped.centro_id is null then
    res := res || jsonb_build_object('nivel','alerta','mensagem','Centro de custo não informado');
  end if;

  for item in
    select pi.quantidade, pi.preco_unitario, pi.desconto_percentual,
           p.descricao, p.estoque_atual, p.custo_medio, p.margem_minima
      from public.pedido_itens pi join public.produtos p on p.id = pi.produto_id
     where pi.pedido_id = _pedido_id
  loop
    if item.quantidade > coalesce(item.estoque_atual,0) then
      res := res || jsonb_build_object('nivel','alerta',
        'mensagem','Estoque insuficiente de ' || item.descricao ||
          ' (disponível ' || to_char(coalesce(item.estoque_atual,0),'FM999999990.###') || ')');
    end if;
    custo := coalesce(item.custo_medio, 0);
    if custo > 0 and item.preco_unitario > 0 then
      margem := round(((item.preco_unitario * (1 - coalesce(item.desconto_percentual,0)/100) / custo) - 1) * 100, 2);
      if margem < greatest(coalesce(item.margem_minima,0), margem_min) then
        res := res || jsonb_build_object('nivel','bloqueio',
          'mensagem','Margem de ' || item.descricao || ' abaixo do mínimo (' || margem || '%)');
      end if;
    end if;
    if coalesce(item.desconto_percentual,0) > desc_max then
      res := res || jsonb_build_object('nivel','bloqueio',
        'mensagem','Desconto de ' || item.descricao || ' acima do máximo permitido (' || desc_max || '%)');
    end if;
  end loop;

  return res;
end $$;

-- -------------------------------------------------------------
-- 6. COMISSÃO ESCALONADA
-- -------------------------------------------------------------
create table if not exists public.comissao_faixas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  representante_id uuid references public.representantes(id) on delete cascade,
  periodo text not null default 'mensal'
    check (periodo in ('mensal','semanal','pedido','faturamento','recebimento')),
  base_calculo text not null default 'liquido'
    check (base_calculo in ('bruto','liquido','apos_desconto')),
  valor_min numeric(14,2) not null default 0,
  valor_max numeric(14,2),
  percentual numeric(5,2) not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.comissao_faixas to authenticated;
grant all on public.comissao_faixas to service_role;
alter table public.comissao_faixas enable row level security;
drop policy if exists comissao_faixas_select on public.comissao_faixas;
create policy comissao_faixas_select on public.comissao_faixas for select to authenticated using (true);
drop policy if exists comissao_faixas_write on public.comissao_faixas;
create policy comissao_faixas_write on public.comissao_faixas for all to authenticated
  using (public.can_manage(auth.uid())) with check (public.can_manage(auth.uid()));
drop trigger if exists set_updated_at_comissao_faixas on public.comissao_faixas;
create trigger set_updated_at_comissao_faixas before update on public.comissao_faixas
  for each row execute function public.set_updated_at();

create or replace function public.resolver_comissao_faixa(
  _representante_id uuid, _valor_pedido numeric, _data date default current_date)
returns numeric
language plpgsql stable security definer set search_path to 'public' as $$
declare
  base numeric(14,2) := 0;
  f record;
begin
  if _representante_id is null then return null; end if;

  select * into f from public.comissao_faixas
   where ativo and (representante_id is null or representante_id = _representante_id)
   order by (representante_id is not null)::int desc limit 1;
  if f.id is null then return null; end if;

  if f.periodo = 'pedido' then
    base := coalesce(_valor_pedido, 0);
  elsif f.periodo = 'semanal' then
    select coalesce(sum(total_liquido),0) into base from public.pedidos
     where representante_id = _representante_id
       and status not in ('rascunho','digitacao','cancelado','recusado')
       and data_pedido >= date_trunc('week', _data)::date;
    base := base + coalesce(_valor_pedido,0);
  elsif f.periodo = 'recebimento' then
    select coalesce(sum(cr.valor_pago),0) into base
      from public.contas_receber cr join public.pedidos p on p.id = cr.pedido_id
     where p.representante_id = _representante_id
       and cr.data_pagamento >= date_trunc('month', _data)::date;
  elsif f.periodo = 'faturamento' then
    select coalesce(sum(n.valor_total),0) into base
      from public.notas_saida n join public.pedidos p on p.id = n.pedido_id
     where p.representante_id = _representante_id and n.status = 'emitida'
       and n.data_emissao >= date_trunc('month', _data)::date;
  else
    select coalesce(sum(total_liquido),0) into base from public.pedidos
     where representante_id = _representante_id
       and status not in ('rascunho','digitacao','cancelado','recusado')
       and data_pedido >= date_trunc('month', _data)::date;
    base := base + coalesce(_valor_pedido,0);
  end if;

  select percentual into f from public.comissao_faixas
   where ativo and (representante_id is null or representante_id = _representante_id)
     and base >= valor_min and (valor_max is null or base <= valor_max)
   order by (representante_id is not null)::int desc, valor_min desc limit 1;

  return f.percentual;
end $$;

-- regra do produto > regra específica > faixa escalonada > padrão do representante
create or replace function public.resolver_comissao(
  _representante_id uuid, _cliente_id uuid, _data date default current_date,
  _produto_id uuid default null, _valor_pedido numeric default 0)
returns numeric
language plpgsql stable security definer set search_path to 'public' as $$
declare
  pct numeric(5,2);
  cli record;
  prod record;
begin
  if _representante_id is null then return 0; end if;
  select uf into cli from public.clientes where id = _cliente_id;

  if _produto_id is not null then
    select comissao_percentual, categoria into prod from public.produtos where id = _produto_id;
    if prod.comissao_percentual is not null and prod.comissao_percentual > 0 then
      return prod.comissao_percentual;
    end if;
  end if;

  select r.percentual into pct
    from public.regras_comissao r
   where r.ativo
     and (r.vigencia_inicio is null or r.vigencia_inicio <= _data)
     and (r.vigencia_fim is null or r.vigencia_fim >= _data)
     and (r.representante_id is null or r.representante_id = _representante_id)
     and (r.cliente_id is null or r.cliente_id = _cliente_id)
     and (r.produto_id is null or r.produto_id = _produto_id)
     and (r.uf is null or r.uf = cli.uf)
   order by r.prioridade desc,
            (r.produto_id is not null)::int desc,
            (r.cliente_id is not null)::int desc,
            (r.representante_id is not null)::int desc,
            (r.uf is not null)::int desc,
            r.created_at desc
   limit 1;
  if pct is not null then return pct; end if;

  pct := public.resolver_comissao_faixa(_representante_id, _valor_pedido, _data);
  if pct is not null then return pct; end if;

  select coalesce(comissao_percentual, 0) into pct
    from public.representantes where id = _representante_id;
  return coalesce(pct, 0);
end $$;

-- -------------------------------------------------------------
-- 7. SEPARAÇÃO E ENTREGAS
-- -------------------------------------------------------------
alter table public.expedicoes drop constraint if exists expedicoes_status_check;
alter table public.expedicoes add constraint expedicoes_status_check check (status = any (array[
  'pendente','separacao','separado','aguardando_entrega','em_rota',
  'entregue','entrega_parcial','nao_entregue','devolvido','cancelada'
]));

create table if not exists public.ondas_separacao (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  centro_id uuid references public.centros(id) on delete set null,
  responsavel text,
  status text not null default 'aberta' check (status in ('aberta','separando','concluida','cancelada')),
  observacoes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pedidos add column if not exists onda_id uuid references public.ondas_separacao(id) on delete set null;
grant select, insert, update, delete on public.ondas_separacao to authenticated;
grant all on public.ondas_separacao to service_role;
alter table public.ondas_separacao enable row level security;
drop policy if exists ondas_select on public.ondas_separacao;
create policy ondas_select on public.ondas_separacao for select to authenticated using (true);
drop policy if exists ondas_write on public.ondas_separacao;
create policy ondas_write on public.ondas_separacao for all to authenticated
  using (public.can_ship(auth.uid()) or public.can_manage(auth.uid()))
  with check (public.can_ship(auth.uid()) or public.can_manage(auth.uid()));
drop trigger if exists set_updated_at_ondas on public.ondas_separacao;
create trigger set_updated_at_ondas before update on public.ondas_separacao
  for each row execute function public.set_updated_at();

create sequence if not exists public.seq_codigo_onda;
create or replace function public.gerar_codigo_onda()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.codigo is null or new.codigo = '' then
    loop
      new.codigo := nextval('public.seq_codigo_onda')::text;
      exit when not exists (select 1 from public.ondas_separacao where codigo = new.codigo);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_codigo_ondas on public.ondas_separacao;
create trigger trg_codigo_ondas before insert on public.ondas_separacao
  for each row execute function public.gerar_codigo_onda();

create or replace view public.vw_separacao as
select p.id as pedido_id, p.numero, p.status, p.centro_id, c.nome as centro,
       cli.razao_social as cliente, p.onda_id,
       pr.id as produto_id, pr.codigo as produto_codigo, pr.descricao as produto,
       sum(pi.quantidade) as quantidade, pr.estoque_atual, r.nome as rota
  from public.pedidos p
  join public.pedido_itens pi on pi.pedido_id = p.id
  join public.produtos pr on pr.id = pi.produto_id
  left join public.clientes cli on cli.id = p.cliente_id
  left join public.centros c on c.id = p.centro_id
  left join public.rotas r on r.id = p.rota_id
 where p.status in ('aprovado','confirmado','separacao','separado')
 group by p.id, p.numero, p.status, p.centro_id, c.nome, cli.razao_social, p.onda_id,
          pr.id, pr.codigo, pr.descricao, pr.estoque_atual, r.nome;
grant select on public.vw_separacao to authenticated;

-- -------------------------------------------------------------
-- 8. HISTÓRICO DE CUSTOS DO PRODUTO
-- -------------------------------------------------------------
create table if not exists public.produto_custos (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id) on delete cascade,
  fornecedor_id uuid references public.fornecedores(id) on delete set null,
  compra_id uuid references public.compras(id) on delete set null,
  nf_numero text,
  data date not null default current_date,
  quantidade numeric(14,3) not null default 0,
  custo_unitario numeric(14,4) not null default 0,
  created_at timestamptz not null default now()
);
grant select, insert on public.produto_custos to authenticated;
grant all on public.produto_custos to service_role;
alter table public.produto_custos enable row level security;
drop policy if exists produto_custos_select on public.produto_custos;
create policy produto_custos_select on public.produto_custos for select to authenticated using (true);

create or replace function public.receber_compra(_compra_id uuid)
returns public.compras
language plpgsql security definer set search_path to 'public' as $$
declare
  cmp public.compras;
  fp public.formas_pagamento;
  item record;
  n int;
  valor_parcela numeric(14,2);
  saldo numeric(14,2);
  dias_1 int := 30;
  intervalo int := 30;
begin
  if not public.can_stock(auth.uid()) and not public.can_finance(auth.uid()) then
    raise exception 'Sem permissão para receber compras';
  end if;

  select * into cmp from public.compras where id = _compra_id for update;
  if cmp is null then raise exception 'Compra não encontrada'; end if;
  if cmp.status <> 'rascunho' then raise exception 'Compra já processada'; end if;
  if not exists (select 1 from public.compra_itens where compra_id = _compra_id) then
    raise exception 'Inclua ao menos um item na compra';
  end if;

  perform public.recalcular_compra(_compra_id);
  select * into cmp from public.compras where id = _compra_id;

  for item in select produto_id, sum(quantidade) as qtd,
                     case when sum(quantidade) > 0
                       then sum(quantidade * custo_unitario) / sum(quantidade) else 0 end as custo
                from public.compra_itens where compra_id = _compra_id group by produto_id loop
    insert into public.estoque_movimentos
      (produto_id, centro_id, tipo, quantidade, custo_unitario, origem, documento_id, observacao, created_by)
    values (item.produto_id, cmp.centro_id, 'entrada', item.qtd, item.custo, 'compra', _compra_id,
            'Entrada por NF de compra', auth.uid());

    insert into public.produto_custos
      (produto_id, fornecedor_id, compra_id, nf_numero, data, quantidade, custo_unitario)
    values (item.produto_id, cmp.fornecedor_id, cmp.id, cmp.nf_numero,
            cmp.data_entrada, item.qtd, item.custo);

    update public.produtos
       set ultimo_custo = item.custo,
           custo_reposicao = item.custo
     where id = item.produto_id;
  end loop;

  select * into fp from public.formas_pagamento where id = cmp.forma_pagamento_id;
  if fp.id is not null then
    dias_1 := fp.dias_primeira_parcela;
    intervalo := fp.intervalo_dias;
  end if;

  valor_parcela := round(cmp.total_liquido / greatest(cmp.parcelas, 1), 2);
  saldo := cmp.total_liquido;
  for n in 1..greatest(cmp.parcelas, 1) loop
    if n = cmp.parcelas then valor_parcela := saldo; end if;
    insert into public.contas_pagar
      (fornecedor_id, compra_id, documento, parcela, valor, vencimento, categoria)
    values (cmp.fornecedor_id, cmp.id,
            coalesce(nullif(cmp.nf_numero, ''), 'CMP-' || cmp.numero), n, valor_parcela,
            cmp.data_entrada + (dias_1 + (n - 1) * intervalo), 'fornecedor');
    saldo := saldo - valor_parcela;
  end loop;

  update public.compras set status = 'recebida' where id = _compra_id returning * into cmp;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('compras', _compra_id, 'receber',
          jsonb_build_object('total', cmp.total_liquido), auth.uid());

  return cmp;
end $$;

-- -------------------------------------------------------------
-- 9. VIEWS DE GESTÃO
-- -------------------------------------------------------------
create or replace view public.vw_produto_historico as
select p.id as produto_id, p.codigo, p.descricao, p.centro_id,
       coalesce(sum(pi.quantidade), 0) as quantidade,
       coalesce(sum(pi.total), 0) as faturamento,
       coalesce(sum(pi.quantidade * p.custo_medio), 0) as custo,
       coalesce(sum(pi.total) - sum(pi.quantidade * p.custo_medio), 0) as lucro,
       case when coalesce(sum(pi.total),0) > 0
         then round(((sum(pi.total) - sum(pi.quantidade * p.custo_medio)) / sum(pi.total)) * 100, 2)
         else 0 end as margem_percentual,
       count(distinct ped.cliente_id) as clientes,
       max(ped.data_pedido) as ultima_venda,
       round(coalesce(sum(pi.quantidade), 0) / 12.0, 2) as media_mensal
  from public.produtos p
  left join public.pedido_itens pi on pi.produto_id = p.id
  left join public.pedidos ped on ped.id = pi.pedido_id
       and ped.status not in ('cancelado','rascunho','digitacao','recusado')
       and ped.data_pedido >= current_date - interval '12 months'
 group by p.id, p.codigo, p.descricao, p.centro_id;
grant select on public.vw_produto_historico to authenticated;

create or replace view public.vw_cliente_historico as
select c.id as cliente_id, c.codigo, c.razao_social, c.centro_id, c.representante_id,
       count(distinct p.id) as pedidos,
       coalesce(sum(p.total_liquido), 0) as total_comprado,
       case when count(distinct p.id) > 0
         then round(coalesce(sum(p.total_liquido),0) / count(distinct p.id), 2) else 0 end as ticket_medio,
       max(p.data_pedido) as ultimo_pedido,
       coalesce((select sum(cr.valor - coalesce(cr.valor_pago,0)) from public.contas_receber cr
                  where cr.cliente_id = c.id and cr.status not in ('pago','cancelado')), 0) as titulos_abertos,
       coalesce((select sum(cr.valor - coalesce(cr.valor_pago,0)) from public.contas_receber cr
                  where cr.cliente_id = c.id and cr.status not in ('pago','cancelado')
                    and cr.vencimento < current_date), 0) as titulos_vencidos
  from public.clientes c
  left join public.pedidos p on p.cliente_id = c.id
       and p.status not in ('cancelado','rascunho','digitacao','recusado')
 group by c.id, c.codigo, c.razao_social, c.centro_id, c.representante_id;
grant select on public.vw_cliente_historico to authenticated;

create or replace view public.vw_clientes_inativos as
select c.id as cliente_id, c.codigo, c.razao_social, c.centro_id, c.cidade, c.uf,
       r.nome as representante, c.representante_id,
       max(p.data_pedido) as ultimo_pedido,
       coalesce(current_date - max(p.data_pedido), 9999) as dias_sem_comprar,
       coalesce(round(avg(p.total_liquido), 2), 0) as ticket_medio
  from public.clientes c
  left join public.representantes r on r.id = c.representante_id
  left join public.pedidos p on p.cliente_id = c.id
       and p.status not in ('cancelado','rascunho','digitacao','recusado')
 where c.status = 'ativo'
 group by c.id, c.codigo, c.razao_social, c.centro_id, c.cidade, c.uf, r.nome, c.representante_id;
grant select on public.vw_clientes_inativos to authenticated;

create or replace view public.vw_sugestao_compras as
with vendas as (
  select pi.produto_id,
    sum(case when ped.data_pedido >= current_date - 30 then pi.quantidade else 0 end) as v30,
    sum(case when ped.data_pedido >= current_date - 60 then pi.quantidade else 0 end) as v60,
    sum(case when ped.data_pedido >= current_date - 90 then pi.quantidade else 0 end) as v90
  from public.pedido_itens pi
  join public.pedidos ped on ped.id = pi.pedido_id
   and ped.status not in ('cancelado','rascunho','digitacao','recusado')
  group by pi.produto_id
), pendentes as (
  select pi.produto_id, sum(pi.quantidade) as qtd
    from public.pedido_itens pi join public.pedidos ped on ped.id = pi.pedido_id
   where ped.status in ('rascunho','digitacao','aguardando_aprovacao','aprovado')
   group by pi.produto_id
), transito as (
  select ci.produto_id, sum(ci.quantidade) as qtd
    from public.compra_itens ci join public.compras cp on cp.id = ci.compra_id
   where cp.status = 'rascunho'
   group by ci.produto_id
)
select p.id as produto_id, p.codigo, p.descricao, p.centro_id, p.unidade,
       p.estoque_atual, p.estoque_minimo, p.estoque_maximo, p.prazo_fornecedor_dias,
       coalesce(v.v30,0) as venda_30, coalesce(v.v60,0) as venda_60, coalesce(v.v90,0) as venda_90,
       round(coalesce(v.v90,0)/3.0, 2) as media_mensal,
       coalesce(pe.qtd,0) as pedidos_pendentes,
       coalesce(t.qtd,0) as em_transito,
       greatest(
         round(
           greatest(coalesce(p.estoque_maximo,0), round(coalesce(v.v90,0)/3.0,2) + coalesce(p.estoque_minimo,0))
           + coalesce(pe.qtd,0) - coalesce(p.estoque_atual,0) - coalesce(t.qtd,0)
         , 2), 0) as sugestao
  from public.produtos p
  left join vendas v on v.produto_id = p.id
  left join pendentes pe on pe.produto_id = p.id
  left join transito t on t.produto_id = p.id
 where p.ativo;
grant select on public.vw_sugestao_compras to authenticated;

create or replace view public.vw_margem_produto as
select p.id as produto_id, p.codigo, p.descricao, p.centro_id,
       p.custo_medio, p.preco_venda, p.margem_minima,
       case when coalesce(p.custo_medio,0) > 0
         then round(((p.preco_venda / p.custo_medio) - 1) * 100, 2) else 0 end as markup,
       case when coalesce(p.preco_venda,0) > 0
         then round(((p.preco_venda - coalesce(p.custo_medio,0)) / p.preco_venda) * 100, 2) else 0 end as margem,
       (p.preco_venda - coalesce(p.custo_medio,0)) as lucro_unitario,
       (p.preco_venda - coalesce(p.custo_medio,0)) * coalesce(p.estoque_atual,0) as lucro_estoque
  from public.produtos p where p.ativo;
grant select on public.vw_margem_produto to authenticated;

-- -------------------------------------------------------------
-- 10. BOLETOS (Sicredi) — estrutura e conciliação
-- -------------------------------------------------------------
create table if not exists public.boletos (
  id uuid primary key default gen_random_uuid(),
  conta_receber_id uuid references public.contas_receber(id) on delete set null,
  cliente_id uuid references public.clientes(id) on delete set null,
  centro_id uuid references public.centros(id) on delete set null,
  banco text not null default 'sicredi',
  nosso_numero text,
  seu_numero text,
  linha_digitavel text,
  codigo_barras text,
  valor numeric(14,2) not null default 0,
  valor_liquidado numeric(14,2) not null default 0,
  vencimento date,
  data_emissao date not null default current_date,
  data_liquidacao date,
  pdf_url text,
  status text not null default 'pendente'
    check (status in ('pendente','registrado','liquidado','baixado','cancelado','erro')),
  retorno jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists boletos_nosso_numero_idx on public.boletos (nosso_numero);
grant select, insert, update, delete on public.boletos to authenticated;
grant all on public.boletos to service_role;
alter table public.boletos enable row level security;
drop policy if exists boletos_select on public.boletos;
create policy boletos_select on public.boletos for select to authenticated using (true);
drop policy if exists boletos_write on public.boletos;
create policy boletos_write on public.boletos for all to authenticated
  using (public.can_finance(auth.uid())) with check (public.can_finance(auth.uid()));
drop trigger if exists set_updated_at_boletos on public.boletos;
create trigger set_updated_at_boletos before update on public.boletos
  for each row execute function public.set_updated_at();

create or replace function public.emitir_boleto(_conta_id uuid)
returns public.boletos
language plpgsql security definer set search_path to 'public' as $$
declare cr record; b public.boletos;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissão para emitir boletos';
  end if;
  select * into cr from public.contas_receber where id = _conta_id;
  if cr is null then raise exception 'Título não encontrado'; end if;
  if exists (select 1 from public.boletos where conta_receber_id = _conta_id
              and status in ('pendente','registrado','liquidado')) then
    raise exception 'Já existe boleto ativo para este título';
  end if;

  insert into public.boletos (conta_receber_id, cliente_id, seu_numero, valor, vencimento, created_by)
  values (_conta_id, cr.cliente_id, cr.documento || '/' || cr.parcela, cr.valor - coalesce(cr.valor_pago,0),
          cr.vencimento, auth.uid())
  returning * into b;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('boletos', b.id, 'emitir', jsonb_build_object('valor', b.valor), auth.uid());
  return b;
end $$;

create or replace function public.liquidar_boleto(_boleto_id uuid, _valor numeric, _data date default current_date)
returns void language plpgsql security definer set search_path to 'public' as $$
declare b public.boletos;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissão para conciliar boletos';
  end if;
  select * into b from public.boletos where id = _boleto_id for update;
  if b is null then raise exception 'Boleto não encontrado'; end if;

  update public.boletos
     set status = 'liquidado', valor_liquidado = _valor, data_liquidacao = _data
   where id = _boleto_id;

  if b.conta_receber_id is not null then
    perform public.baixar_receber(b.conta_receber_id, _valor, _data);
  end if;
end $$;

-- -------------------------------------------------------------
-- 11. RLS: representante vê apenas a própria carteira
-- -------------------------------------------------------------
create or replace function public.meu_representante_id()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select r.id from public.representantes r where r.profile_id = auth.uid() limit 1;
$$;

create or replace function public.escopo_representante()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.has_role(auth.uid(), 'representante')
     and not public.has_role(auth.uid(), 'admin')
     and not public.has_role(auth.uid(), 'gestor');
$$;

drop policy if exists pedidos_select_auth on public.pedidos;
create policy pedidos_select_auth on public.pedidos for select to authenticated
using (
  not public.escopo_representante()
  or representante_id = public.meu_representante_id()
);

drop policy if exists clientes_select_auth on public.clientes;
create policy clientes_select_auth on public.clientes for select to authenticated
using (
  not public.escopo_representante()
  or representante_id = public.meu_representante_id()
);

drop policy if exists comissoes_select_auth on public.comissoes;
create policy comissoes_select_auth on public.comissoes for select to authenticated
using (
  not public.escopo_representante()
  or representante_id = public.meu_representante_id()
);
