-- =============================================================
-- Fase 42: auditoria e travas do fluxo operacional
-- Pedido -> aprovação -> separação -> conferência -> faturamento ->
-- nota fiscal -> boleto -> carga -> entrega
-- Idempotente. Preserva todos os dados existentes.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Status: acrescenta os estados que faltavam (nada é removido)
-- -------------------------------------------------------------
alter table public.pedidos drop constraint if exists pedidos_status_check;
alter table public.pedidos add constraint pedidos_status_check check (status in (
  'rascunho','digitacao','aguardando_aprovacao','aprovado','recusado','confirmado',
  'separacao','separado','conferido','faturado','nf_emitida','em_carga',
  'em_rota','entregue','parcial','nao_entregue','devolvido','cancelado'
));

alter table public.notas_saida drop constraint if exists notas_saida_status_check;
alter table public.notas_saida add constraint notas_saida_status_check check (status in (
  'pendente','emitida','autorizada','rejeitada','cancelada'
));

alter table public.notas_saida
  add column if not exists protocolo text,
  add column if not exists xml_url text,
  add column if not exists danfe_url text,
  add column if not exists retorno jsonb,
  add column if not exists mensagem_retorno text,
  add column if not exists autorizada_em timestamptz,
  add column if not exists rejeitada_em timestamptz,
  add column if not exists centro_id uuid references public.centros(id) on delete set null;

-- parâmetro: exigir NF autorizada antes do boleto
insert into public.parametros (chave, valor)
select 'exigir_nf_boleto', 'true'
where not exists (select 1 from public.parametros where chave = 'exigir_nf_boleto');

-- -------------------------------------------------------------
-- 2. Histórico de status do pedido
-- -------------------------------------------------------------
create table if not exists public.pedido_status_historico (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  status_anterior text,
  status_novo text not null,
  observacao text,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists pedido_status_hist_pedido_idx on public.pedido_status_historico(pedido_id, created_at);
grant select, insert on public.pedido_status_historico to authenticated;
grant all on public.pedido_status_historico to service_role;
alter table public.pedido_status_historico enable row level security;
drop policy if exists "psh_select" on public.pedido_status_historico;
create policy "psh_select" on public.pedido_status_historico for select to authenticated using (true);
drop policy if exists "psh_insert" on public.pedido_status_historico;
create policy "psh_insert" on public.pedido_status_historico for insert to authenticated
  with check (public.can_operate(auth.uid()));

create or replace function public.trg_pedido_status_historico()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into public.pedido_status_historico (pedido_id, status_anterior, status_novo, user_id)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists trg_pedidos_status_historico on public.pedidos;
create trigger trg_pedidos_status_historico
after update of status on public.pedidos
for each row execute function public.trg_pedido_status_historico();

-- -------------------------------------------------------------
-- 3. Separação e conferência (reaproveita pedido_itens)
-- -------------------------------------------------------------
alter table public.pedido_itens
  add column if not exists quantidade_separada numeric(14,3),
  add column if not exists divergencia_acao text,
  add column if not exists divergencia_obs text,
  add column if not exists conferido boolean not null default false;

alter table public.pedido_itens drop constraint if exists pedido_itens_divergencia_acao_check;
alter table public.pedido_itens add constraint pedido_itens_divergencia_acao_check
  check (divergencia_acao is null or divergencia_acao in
    ('aguardar','alterar_quantidade','retirar_item','substituir','cancelar_item','outro'));

create table if not exists public.pedido_separacoes (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null unique references public.pedidos(id) on delete cascade,
  status text not null default 'em_separacao'
    check (status in ('em_separacao','separada','divergente','conferida','cancelada')),
  separador_id uuid references auth.users(id) on delete set null,
  conferente_id uuid references auth.users(id) on delete set null,
  iniciada_em timestamptz not null default now(),
  separada_em timestamptz,
  conferida_em timestamptz,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.pedido_separacoes to authenticated;
grant all on public.pedido_separacoes to service_role;
alter table public.pedido_separacoes enable row level security;
drop policy if exists "sep_select" on public.pedido_separacoes;
create policy "sep_select" on public.pedido_separacoes for select to authenticated using (true);
drop policy if exists "sep_write" on public.pedido_separacoes;
create policy "sep_write" on public.pedido_separacoes for all to authenticated
  using (public.can_stock(auth.uid())) with check (public.can_stock(auth.uid()));

drop trigger if exists trg_pedido_separacoes_updated on public.pedido_separacoes;
create trigger trg_pedido_separacoes_updated
before update on public.pedido_separacoes
for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- 4. Cargas de entrega por rota
-- -------------------------------------------------------------
create table if not exists public.cargas (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated by default as identity unique,
  rota_id uuid references public.rotas(id) on delete set null,
  centro_id uuid references public.centros(id) on delete set null,
  data date not null default current_date,
  responsavel text,
  motorista text,
  placa text,
  transportadora_id uuid references public.transportadoras(id) on delete set null,
  volumes integer not null default 0,
  peso_kg numeric(14,3) not null default 0,
  valor_total numeric(14,2) not null default 0,
  status text not null default 'aberta'
    check (status in ('aberta','em_preparacao','fechada','em_rota','entregando','concluida','cancelada')),
  observacoes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cargas_rota_idx on public.cargas(rota_id, status);
grant select, insert, update on public.cargas to authenticated;
grant all on public.cargas to service_role;
alter table public.cargas enable row level security;
drop policy if exists "cargas_select" on public.cargas;
create policy "cargas_select" on public.cargas for select to authenticated using (true);
drop policy if exists "cargas_write" on public.cargas;
create policy "cargas_write" on public.cargas for all to authenticated
  using (public.can_ship(auth.uid())) with check (public.can_ship(auth.uid()));

drop trigger if exists trg_cargas_updated on public.cargas;
create trigger trg_cargas_updated
before update on public.cargas for each row execute function public.set_updated_at();

create table if not exists public.carga_pedidos (
  id uuid primary key default gen_random_uuid(),
  carga_id uuid not null references public.cargas(id) on delete cascade,
  pedido_id uuid not null references public.pedidos(id) on delete restrict,
  volumes integer not null default 0,
  observacoes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (carga_id, pedido_id)
);
grant select, insert, delete on public.carga_pedidos to authenticated;
grant all on public.carga_pedidos to service_role;
alter table public.carga_pedidos enable row level security;
drop policy if exists "carga_pedidos_select" on public.carga_pedidos;
create policy "carga_pedidos_select" on public.carga_pedidos for select to authenticated using (true);
drop policy if exists "carga_pedidos_write" on public.carga_pedidos;
create policy "carga_pedidos_write" on public.carga_pedidos for all to authenticated
  using (public.can_ship(auth.uid())) with check (public.can_ship(auth.uid()));

alter table public.expedicoes add column if not exists carga_id uuid references public.cargas(id) on delete set null;

-- -------------------------------------------------------------
-- 5. Regras de liberação (backend)
-- -------------------------------------------------------------
-- retorna null quando o pedido está liberado para faturar; senão a mensagem do bloqueio
create or replace function public.bloqueio_faturamento(_pedido_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  ped record;
  sep record;
  pend int;
  div int;
begin
  select * into ped from public.pedidos where id = _pedido_id;
  if ped.id is null then return 'Pedido não encontrado'; end if;
  if ped.status in ('cancelado','recusado') then return 'Pedido cancelado ou recusado'; end if;
  if ped.status in ('rascunho','digitacao','aguardando_aprovacao') then
    return 'Este pedido ainda não está liberado para faturamento. A separação precisa ser concluída e conferida corretamente.';
  end if;
  if ped.status in ('aprovado','confirmado','separacao','separado') then
    return 'Este pedido ainda não está liberado para faturamento. A separação precisa ser concluída e conferida corretamente.';
  end if;

  select * into sep from public.pedido_separacoes where pedido_id = _pedido_id;
  if sep.pedido_id is null or sep.status <> 'conferida' then
    return 'Este pedido ainda não está liberado para faturamento. A separação precisa ser concluída e conferida corretamente.';
  end if;

  select count(*) into pend from public.pedido_itens
   where pedido_id = _pedido_id and (quantidade_separada is null or conferido = false);
  if pend > 0 then return 'Existem itens sem conferência na separação'; end if;

  select count(*) into div from public.pedido_itens
   where pedido_id = _pedido_id
     and coalesce(quantidade_separada, 0) <> quantidade
     and coalesce(divergencia_acao, 'aguardar') in ('aguardar');
  if div > 0 then return 'Existem divergências de separação pendentes de definição'; end if;

  return null;
end $$;
grant execute on function public.bloqueio_faturamento(uuid) to authenticated;

-- retorna null quando o título/pedido já pode gerar boleto
create or replace function public.bloqueio_boleto(_pedido_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  ped record;
  exige boolean := coalesce((select valor from public.parametros where chave='exigir_nf_boleto'), 'true') = 'true';
  nf record;
begin
  if _pedido_id is null then return null; end if; -- título manual/avulso
  select * into ped from public.pedidos where id = _pedido_id;
  if ped.id is null then return null; end if;

  if ped.status not in ('faturado','nf_emitida','em_carga','em_rota','entregue','parcial') then
    return 'O boleto só pode ser emitido depois da separação conferida e do faturamento do pedido.';
  end if;
  if public.bloqueio_faturamento(_pedido_id) is not null then
    return 'O boleto só pode ser emitido depois da separação conferida e do faturamento do pedido.';
  end if;
  if exige then
    select * into nf from public.notas_saida
     where pedido_id = _pedido_id and status in ('autorizada','emitida') limit 1;
    if nf.id is null then
      return 'Emita e autorize a nota fiscal antes de gerar o boleto deste pedido.';
    end if;
  end if;
  return null;
end $$;
grant execute on function public.bloqueio_boleto(uuid) to authenticated;

-- trava de boleto no banco (vale para RPC e para insert direto do app)
create or replace function public.trg_boleto_liberado()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ped uuid;
  msg text;
begin
  ped := new.pedido_id;
  if ped is null and new.conta_receber_id is not null then
    select pedido_id into ped from public.contas_receber where id = new.conta_receber_id;
  end if;
  msg := public.bloqueio_boleto(ped);
  if msg is not null then raise exception '%', msg; end if;
  if new.pedido_id is null then new.pedido_id := ped; end if;
  return new;
end $$;

drop trigger if exists trg_boletos_liberado on public.boletos;
create trigger trg_boletos_liberado
before insert on public.boletos
for each row execute function public.trg_boleto_liberado();

-- -------------------------------------------------------------
-- 6. RPCs de separação e conferência
-- -------------------------------------------------------------
create or replace function public.iniciar_separacao(_pedido_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ped record;
begin
  if not public.can_stock(auth.uid()) then
    raise exception 'Sem permissão para separar pedidos';
  end if;
  select * into ped from public.pedidos where id = _pedido_id for update;
  if ped.id is null then raise exception 'Pedido não encontrado'; end if;
  if ped.status not in ('aprovado','confirmado','separacao') then
    raise exception 'Somente pedidos aprovados podem entrar em separação (status atual: %)', ped.status;
  end if;

  insert into public.pedido_separacoes (pedido_id, separador_id, status)
  values (_pedido_id, auth.uid(), 'em_separacao')
  on conflict (pedido_id) do update
    set status = case when public.pedido_separacoes.status = 'conferida' then 'conferida' else 'em_separacao' end,
        separador_id = coalesce(public.pedido_separacoes.separador_id, auth.uid());

  if ped.status <> 'separacao' then
    update public.pedidos set status = 'separacao' where id = _pedido_id;
  end if;
end $$;
grant execute on function public.iniciar_separacao(uuid) to authenticated;

create or replace function public.registrar_separacao_item(
  _item_id uuid, _quantidade numeric, _acao text default null, _obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare it record; ped record;
begin
  if not public.can_stock(auth.uid()) then
    raise exception 'Sem permissão para separar pedidos';
  end if;
  select * into it from public.pedido_itens where id = _item_id;
  if it.id is null then raise exception 'Item não encontrado'; end if;
  select * into ped from public.pedidos where id = it.pedido_id;
  if ped.status not in ('separacao','separado') then
    raise exception 'O pedido precisa estar em separação para registrar quantidades';
  end if;
  if _quantidade < 0 then raise exception 'Quantidade separada inválida'; end if;

  update public.pedido_itens
     set quantidade_separada = _quantidade,
         divergencia_acao = case when _quantidade = quantidade then null else nullif(_acao,'') end,
         divergencia_obs = nullif(_obs,''),
         conferido = false
   where id = _item_id;

  update public.pedido_separacoes
     set status = 'em_separacao', separada_em = null, conferida_em = null, conferente_id = null
   where pedido_id = it.pedido_id and status <> 'conferida';
end $$;
grant execute on function public.registrar_separacao_item(uuid, numeric, text, text) to authenticated;

-- conclui a separação: exige quantidade informada em todos os itens e
-- definição formal para cada divergência
create or replace function public.concluir_separacao(_pedido_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ped record; faltando int; sem_acao int; it record;
begin
  if not public.can_stock(auth.uid()) then
    raise exception 'Sem permissão para separar pedidos';
  end if;
  select * into ped from public.pedidos where id = _pedido_id for update;
  if ped.id is null then raise exception 'Pedido não encontrado'; end if;
  if ped.status <> 'separacao' then
    raise exception 'O pedido não está em separação';
  end if;

  select count(*) into faltando from public.pedido_itens
   where pedido_id = _pedido_id and quantidade_separada is null;
  if faltando > 0 then
    raise exception 'Informe a quantidade separada de todos os itens (% pendente(s))', faltando;
  end if;

  select count(*) into sem_acao from public.pedido_itens
   where pedido_id = _pedido_id and quantidade_separada <> quantidade and divergencia_acao is null;
  if sem_acao > 0 then
    raise exception 'Defina o tratamento das % divergência(s) antes de concluir a separação', sem_acao;
  end if;

  -- aplica as definições das divergências
  for it in select * from public.pedido_itens
             where pedido_id = _pedido_id and quantidade_separada <> quantidade loop
    if it.divergencia_acao = 'alterar_quantidade' then
      update public.pedido_itens set quantidade = it.quantidade_separada where id = it.id;
    elsif it.divergencia_acao in ('retirar_item','cancelar_item') then
      delete from public.pedido_itens where id = it.id;
    end if;
  end loop;

  perform public.recalcular_pedido(_pedido_id);

  update public.pedido_separacoes
     set status = case when exists (
           select 1 from public.pedido_itens
            where pedido_id = _pedido_id
              and coalesce(quantidade_separada,0) <> quantidade
              and coalesce(divergencia_acao,'aguardar') = 'aguardar')
         then 'divergente' else 'separada' end,
         separada_em = now(),
         separador_id = coalesce(separador_id, auth.uid())
   where pedido_id = _pedido_id;

  update public.pedidos set status = 'separado' where id = _pedido_id;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('pedidos', _pedido_id, 'separacao_concluida',
          jsonb_build_object('numero', ped.numero), auth.uid());
end $$;
grant execute on function public.concluir_separacao(uuid) to authenticated;

-- conferência final: só passa se tudo estiver igual ao pedido (após ajustes)
create or replace function public.conferir_separacao(_pedido_id uuid, _obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare ped record; divs int;
begin
  if not public.can_stock(auth.uid()) then
    raise exception 'Sem permissão para conferir a separação';
  end if;
  select * into ped from public.pedidos where id = _pedido_id for update;
  if ped.id is null then raise exception 'Pedido não encontrado'; end if;
  if ped.status <> 'separado' then
    raise exception 'Conclua a separação antes de conferir';
  end if;

  select count(*) into divs from public.pedido_itens
   where pedido_id = _pedido_id
     and (quantidade_separada is null or coalesce(quantidade_separada,0) <> quantidade);
  if divs > 0 then
    raise exception 'Ainda existem % item(ns) divergente(s). A conferência só pode ser concluída com todas as quantidades corretas.', divs;
  end if;

  update public.pedido_itens set conferido = true where pedido_id = _pedido_id;
  update public.pedido_separacoes
     set status = 'conferida', conferida_em = now(), conferente_id = auth.uid(),
         observacoes = coalesce(nullif(_obs,''), observacoes)
   where pedido_id = _pedido_id;
  update public.pedidos set status = 'conferido' where id = _pedido_id;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('pedidos', _pedido_id, 'separacao_conferida',
          jsonb_build_object('numero', ped.numero), auth.uid());

  perform public.notificar('Pedido ' || ped.numero || ' conferido',
    'Separação conferida e liberada para faturamento.', 'sucesso', '/faturamento');
end $$;
grant execute on function public.conferir_separacao(uuid, text) to authenticated;

-- -------------------------------------------------------------
-- 7. Faturamento e nota fiscal com trava real
-- -------------------------------------------------------------
create or replace function public.faturar_pedido(_pedido_id uuid, _nf_numero text default null, _serie text default '1')
returns public.notas_saida
language plpgsql security definer set search_path = public as $$
declare
  ped record;
  nota public.notas_saida;
  msg text;
begin
  if not public.can_bill(auth.uid()) then
    raise exception 'Sem permissão para faturar pedidos';
  end if;

  select * into ped from public.pedidos where id = _pedido_id for update;
  if ped.id is null then raise exception 'Pedido não encontrado'; end if;

  msg := public.bloqueio_faturamento(_pedido_id);
  if msg is not null then raise exception '%', msg; end if;

  if exists (select 1 from public.notas_saida
              where pedido_id = _pedido_id and status in ('pendente','emitida','autorizada')) then
    raise exception 'Pedido já possui nota fiscal em processo ou emitida';
  end if;

  perform public.recalcular_pedido(_pedido_id);
  select * into ped from public.pedidos where id = _pedido_id;

  insert into public.notas_saida
    (pedido_id, cliente_id, centro_id, serie, nf_numero, valor_produtos, valor_frete,
     valor_desconto, valor_total, status, created_by)
  values (ped.id, ped.cliente_id, ped.centro_id, coalesce(nullif(_serie,''), '1'), nullif(_nf_numero,''),
          ped.total_itens, ped.frete_valor, ped.desconto_valor, ped.total_liquido, 'pendente', auth.uid())
  returning * into nota;

  update public.pedidos set status = 'faturado' where id = _pedido_id;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('notas_saida', nota.id, 'faturar',
          jsonb_build_object('pedido', ped.numero, 'total', nota.valor_total), auth.uid());

  perform public.notificar('Pedido faturado',
    'Pedido ' || ped.numero || ' faturado. Emita a nota fiscal.', 'sucesso', '/notas');

  return nota;
end $$;
grant execute on function public.faturar_pedido(uuid, text, text) to authenticated;

create or replace function public.autorizar_nota(
  _id uuid, _nf_numero text, _chave text default null, _protocolo text default null,
  _mensagem text default null, _serie text default null)
returns public.notas_saida
language plpgsql security definer set search_path = public as $$
declare nota public.notas_saida;
begin
  if not public.can_bill(auth.uid()) then
    raise exception 'Sem permissão para emitir notas fiscais';
  end if;
  select * into nota from public.notas_saida where id = _id for update;
  if nota.id is null then raise exception 'Nota não encontrada'; end if;
  if nota.status = 'cancelada' then raise exception 'Nota cancelada'; end if;
  if coalesce(nullif(_nf_numero,''), '') = '' then
    raise exception 'Informe o número da nota fiscal autorizada';
  end if;

  update public.notas_saida
     set status = 'autorizada', nf_numero = _nf_numero,
         serie = coalesce(nullif(_serie,''), serie),
         chave_acesso = nullif(_chave,''), protocolo = nullif(_protocolo,''),
         mensagem_retorno = nullif(_mensagem,''), autorizada_em = now(),
         data_emissao = current_date
   where id = _id returning * into nota;

  update public.pedidos set status = 'nf_emitida'
   where id = nota.pedido_id and status = 'faturado';

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('notas_saida', _id, 'nf_autorizada',
          jsonb_build_object('nf', _nf_numero, 'chave', _chave), auth.uid());
  return nota;
end $$;
grant execute on function public.autorizar_nota(uuid, text, text, text, text, text) to authenticated;

create or replace function public.rejeitar_nota(_id uuid, _motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare nota public.notas_saida;
begin
  if not public.can_bill(auth.uid()) then
    raise exception 'Sem permissão para emitir notas fiscais';
  end if;
  select * into nota from public.notas_saida where id = _id for update;
  if nota.id is null then raise exception 'Nota não encontrada'; end if;

  update public.notas_saida
     set status = 'rejeitada', mensagem_retorno = _motivo, rejeitada_em = now()
   where id = _id;
  update public.pedidos set status = 'faturado'
   where id = nota.pedido_id and status in ('faturado','nf_emitida');

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('notas_saida', _id, 'nf_rejeitada', jsonb_build_object('motivo', _motivo), auth.uid());
end $$;
grant execute on function public.rejeitar_nota(uuid, text) to authenticated;

create or replace function public.cancelar_nota_saida(_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare nota record;
begin
  if not public.can_bill(auth.uid()) then
    raise exception 'Sem permissão para cancelar notas';
  end if;
  select * into nota from public.notas_saida where id = _id;
  if nota is null then raise exception 'Nota não encontrada'; end if;
  if exists (select 1 from public.carga_pedidos cp where cp.pedido_id = nota.pedido_id) then
    raise exception 'Retire o pedido da carga antes de cancelar a nota';
  end if;

  update public.notas_saida set status = 'cancelada' where id = _id;
  update public.pedidos set status = 'conferido'
   where id = nota.pedido_id and status in ('faturado','nf_emitida');

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('notas_saida', _id, 'cancelar', jsonb_build_object('total', nota.valor_total), auth.uid());
end $$;
grant execute on function public.cancelar_nota_saida(uuid) to authenticated;

-- boleto pelo RPC também respeita a trava
create or replace function public.emitir_boleto(_conta_id uuid)
returns public.boletos language plpgsql security definer set search_path = public as $$
declare cr record; b public.boletos; msg text;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissão para emitir boletos';
  end if;
  select * into cr from public.contas_receber where id = _conta_id;
  if cr is null then raise exception 'Título não encontrado'; end if;
  msg := public.bloqueio_boleto(cr.pedido_id);
  if msg is not null then raise exception '%', msg; end if;
  if exists (select 1 from public.boletos where conta_receber_id = _conta_id
              and status in ('pendente','registrado','liquidado')) then
    raise exception 'Já existe boleto ativo para este título';
  end if;

  insert into public.boletos (conta_receber_id, pedido_id, cliente_id, seu_numero, valor, vencimento, created_by)
  values (_conta_id, cr.pedido_id, cr.cliente_id, cr.documento || '/' || cr.parcela,
          cr.valor - coalesce(cr.valor_pago,0), cr.vencimento, auth.uid())
  returning * into b;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('boletos', b.id, 'emitir', jsonb_build_object('valor', b.valor), auth.uid());
  return b;
end $$;
grant execute on function public.emitir_boleto(uuid) to authenticated;

-- -------------------------------------------------------------
-- 8. Transições de status: sem atalhos
-- -------------------------------------------------------------
create or replace function public.avancar_pedido(_pedido_id uuid, _novo_status text)
returns public.pedidos language plpgsql security definer set search_path to 'public' as $$
declare
  ped public.pedidos;
  permitido boolean := false;
begin
  select * into ped from public.pedidos where id = _pedido_id for update;
  if ped.id is null then raise exception 'Pedido não encontrado'; end if;

  if _novo_status in ('separado','conferido','faturado','nf_emitida','em_carga')
     and not public.can_manage(auth.uid()) then
    raise exception 'Este status é definido pelas telas de separação, faturamento ou carga';
  end if;

  permitido := case ped.status
    when 'rascunho'             then _novo_status in ('digitacao','aguardando_aprovacao','cancelado')
    when 'digitacao'            then _novo_status in ('aguardando_aprovacao','cancelado')
    when 'aguardando_aprovacao' then _novo_status in ('aprovado','recusado','cancelado')
    when 'recusado'             then _novo_status in ('digitacao','cancelado')
    when 'aprovado'             then _novo_status in ('separacao','confirmado','cancelado')
    when 'confirmado'           then _novo_status in ('separacao','cancelado')
    when 'separacao'            then _novo_status in ('separado','cancelado')
    when 'separado'             then _novo_status in ('conferido','separacao','cancelado')
    when 'conferido'            then _novo_status in ('faturado','cancelado')
    when 'faturado'             then _novo_status in ('nf_emitida','em_carga','cancelado')
    when 'nf_emitida'           then _novo_status in ('em_carga','em_rota','cancelado')
    when 'em_carga'             then _novo_status in ('em_rota','cancelado')
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
grant execute on function public.avancar_pedido(uuid, text) to authenticated;

-- itens não podem mudar depois da conferência
create or replace function public.trg_itens_pos_conferencia()
returns trigger language plpgsql security definer set search_path = public as $$
declare st text; pid uuid;
begin
  pid := coalesce(new.pedido_id, old.pedido_id);
  select status into st from public.pedidos where id = pid;
  if st in ('conferido','faturado','nf_emitida','em_carga','em_rota','entregue') then
    if public.sync_status_ativo() then return coalesce(new, old); end if;
    raise exception 'Pedido já conferido/faturado: os itens não podem ser alterados';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_pedido_itens_pos_conferencia on public.pedido_itens;
create trigger trg_pedido_itens_pos_conferencia
before insert or delete or update of quantidade, preco_unitario, produto_id on public.pedido_itens
for each row execute function public.trg_itens_pos_conferencia();

-- -------------------------------------------------------------
-- 9. RPCs de carga
-- -------------------------------------------------------------
create or replace function public.criar_carga(
  _rota_id uuid, _data date default current_date, _centro_id uuid default null,
  _responsavel text default null, _motorista text default null, _placa text default null,
  _transportadora_id uuid default null, _observacoes text default null)
returns public.cargas language plpgsql security definer set search_path = public as $$
declare c public.cargas;
begin
  if not public.can_ship(auth.uid()) then
    raise exception 'Sem permissão para gerar cargas';
  end if;
  if _rota_id is null then raise exception 'Selecione a rota da carga'; end if;

  insert into public.cargas (rota_id, data, centro_id, responsavel, motorista, placa,
                             transportadora_id, observacoes, created_by)
  values (_rota_id, coalesce(_data, current_date), _centro_id, nullif(_responsavel,''),
          nullif(_motorista,''), nullif(_placa,''), _transportadora_id,
          nullif(_observacoes,''), auth.uid())
  returning * into c;
  return c;
end $$;
grant execute on function public.criar_carga(uuid, date, uuid, text, text, text, uuid, text) to authenticated;

create or replace function public.recalcular_carga(_carga_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.cargas c
     set valor_total = coalesce(t.valor, 0),
         peso_kg = coalesce(t.peso, 0)
    from (select cp.carga_id,
                 sum(p.total_liquido) as valor,
                 sum(public.peso_pedido(p.id)) as peso
            from public.carga_pedidos cp
            join public.pedidos p on p.id = cp.pedido_id
           where cp.carga_id = _carga_id
           group by cp.carga_id) t
   where c.id = _carga_id and t.carga_id = c.id;

  update public.cargas set valor_total = 0, peso_kg = 0
   where id = _carga_id
     and not exists (select 1 from public.carga_pedidos where carga_id = _carga_id);
end $$;

create or replace function public.adicionar_pedido_carga(_carga_id uuid, _pedido_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c record; ped record; msg text;
  exige boolean := coalesce((select valor from public.parametros where chave='exigir_nf_boleto'), 'true') = 'true';
begin
  if not public.can_ship(auth.uid()) then
    raise exception 'Sem permissão para montar cargas';
  end if;
  select * into c from public.cargas where id = _carga_id for update;
  if c.id is null then raise exception 'Carga não encontrada'; end if;
  if c.status not in ('aberta','em_preparacao') then
    raise exception 'A carga já foi fechada';
  end if;

  select * into ped from public.pedidos where id = _pedido_id;
  if ped.id is null then raise exception 'Pedido não encontrado'; end if;

  msg := public.bloqueio_faturamento(_pedido_id);
  if msg is not null then
    raise exception 'Pedido % não pode entrar na carga: %', ped.numero, msg;
  end if;
  if ped.status not in ('faturado','nf_emitida') then
    raise exception 'Somente pedidos faturados e liberados podem entrar na carga (status: %)', ped.status;
  end if;
  if exige and not exists (select 1 from public.notas_saida
      where pedido_id = _pedido_id and status in ('autorizada','emitida')) then
    raise exception 'Pedido % está sem nota fiscal autorizada', ped.numero;
  end if;
  if c.rota_id is not null and ped.rota_id is distinct from c.rota_id then
    raise exception 'O pedido % é de outra rota', ped.numero;
  end if;
  if exists (select 1 from public.carga_pedidos cp join public.cargas cg on cg.id = cp.carga_id
              where cp.pedido_id = _pedido_id and cg.status <> 'cancelada' and cg.id <> _carga_id) then
    raise exception 'Pedido % já está em outra carga', ped.numero;
  end if;

  insert into public.carga_pedidos (carga_id, pedido_id, created_by)
  values (_carga_id, _pedido_id, auth.uid())
  on conflict (carga_id, pedido_id) do nothing;

  update public.pedidos set status = 'em_carga' where id = _pedido_id and status in ('faturado','nf_emitida');
  update public.expedicoes set carga_id = _carga_id, rota_id = coalesce(rota_id, c.rota_id)
   where pedido_id = _pedido_id and status not in ('entregue','cancelada');

  perform public.recalcular_carga(_carga_id);
end $$;
grant execute on function public.adicionar_pedido_carga(uuid, uuid) to authenticated;

create or replace function public.remover_pedido_carga(_carga_id uuid, _pedido_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c record; nf record;
begin
  if not public.can_ship(auth.uid()) then
    raise exception 'Sem permissão para montar cargas';
  end if;
  select * into c from public.cargas where id = _carga_id;
  if c.id is null then raise exception 'Carga não encontrada'; end if;
  if c.status in ('em_rota','entregando','concluida') then
    raise exception 'A carga já saiu para entrega';
  end if;

  delete from public.carga_pedidos where carga_id = _carga_id and pedido_id = _pedido_id;
  update public.expedicoes set carga_id = null where pedido_id = _pedido_id and carga_id = _carga_id;

  select * into nf from public.notas_saida
   where pedido_id = _pedido_id and status in ('autorizada','emitida') limit 1;
  update public.pedidos
     set status = case when nf.id is not null then 'nf_emitida' else 'faturado' end
   where id = _pedido_id and status = 'em_carga';

  perform public.recalcular_carga(_carga_id);
end $$;
grant execute on function public.remover_pedido_carga(uuid, uuid) to authenticated;

create or replace function public.avancar_carga(_carga_id uuid, _status text, _data date default current_date)
returns void language plpgsql security definer set search_path = public as $$
declare c record; r record;
begin
  if not public.can_ship(auth.uid()) then
    raise exception 'Sem permissão para movimentar cargas';
  end if;
  select * into c from public.cargas where id = _carga_id for update;
  if c.id is null then raise exception 'Carga não encontrada'; end if;
  if _status not in ('aberta','em_preparacao','fechada','em_rota','entregando','concluida','cancelada') then
    raise exception 'Status de carga inválido';
  end if;
  if c.status = 'concluida' then raise exception 'Carga já concluída'; end if;
  if _status in ('fechada','em_rota') and not exists (
      select 1 from public.carga_pedidos where carga_id = _carga_id) then
    raise exception 'Inclua pedidos antes de fechar a carga';
  end if;

  update public.cargas set status = _status where id = _carga_id;

  if _status = 'em_rota' then
    for r in select pedido_id from public.carga_pedidos where carga_id = _carga_id loop
      update public.pedidos set status = 'em_rota'
       where id = r.pedido_id and status in ('em_carga','faturado','nf_emitida');
      update public.expedicoes set status = 'em_rota', data_saida = coalesce(_data, current_date)
       where pedido_id = r.pedido_id and status not in ('entregue','cancelada');
    end loop;
  elsif _status = 'concluida' then
    for r in select pedido_id from public.carga_pedidos where carga_id = _carga_id loop
      update public.pedidos set status = 'entregue' where id = r.pedido_id and status = 'em_rota';
      update public.expedicoes set status = 'entregue', data_entrega = coalesce(_data, current_date)
       where pedido_id = r.pedido_id and status not in ('entregue','cancelada');
    end loop;
  end if;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('cargas', _carga_id, 'carga_' || _status,
          jsonb_build_object('numero', c.numero, 'de', c.status), auth.uid());
end $$;
grant execute on function public.avancar_carga(uuid, text, date) to authenticated;

-- -------------------------------------------------------------
-- 10. Sincronização pedido <-> expedição com os novos status
-- -------------------------------------------------------------
create or replace function public.sync_expedicao_do_pedido()
returns trigger language plpgsql security definer set search_path = public as $$
declare destino text;
begin
  if public.sync_status_ativo() then return new; end if;
  if new.status is not distinct from old.status then return new; end if;

  destino := case new.status
    when 'separacao' then 'separacao'
    when 'separado'  then 'separacao'
    when 'conferido' then 'separado'
    when 'faturado'  then 'aguardando_entrega'
    when 'nf_emitida' then 'aguardando_entrega'
    when 'em_carga'  then 'aguardando_entrega'
    when 'em_rota'   then 'em_rota'
    when 'entregue'  then 'entregue'
    when 'cancelado' then 'cancelada'
    else null end;
  if destino is null then return new; end if;

  perform set_config('app.sync_status', 'on', true);
  update public.expedicoes e
     set status = destino,
         data_saida = case when destino = 'em_rota' then coalesce(e.data_saida, current_date) else e.data_saida end,
         data_entrega = case when destino = 'entregue' then coalesce(e.data_entrega, current_date) else e.data_entrega end
   where e.pedido_id = new.id
     and e.status is distinct from destino
     and (e.status not in ('entregue','cancelada') or destino = 'cancelada');
  perform set_config('app.sync_status', 'off', true);
  return new;
end $$;

create or replace function public.sync_pedido_da_expedicao()
returns trigger language plpgsql security definer set search_path = public as $$
declare destino text; atual text;
begin
  if public.sync_status_ativo() then return new; end if;
  if new.status is not distinct from old.status or new.pedido_id is null then return new; end if;

  destino := case new.status
    when 'separacao' then 'separacao'
    when 'em_rota'   then 'em_rota'
    when 'entregue'  then 'entregue'
    when 'cancelada' then 'cancelado'
    else null end;
  if destino is null then return new; end if;

  select status into atual from public.pedidos where id = new.pedido_id;
  if atual is null or atual = destino then return new; end if;
  if atual in ('cancelado','devolvido','entregue') and destino <> 'cancelado' then return new; end if;
  -- não puxa o pedido para trás no fluxo comercial/fiscal
  if destino = 'separacao' and atual in ('separado','conferido','faturado','nf_emitida','em_carga','em_rota') then
    return new;
  end if;
  if destino = 'em_rota' and atual not in ('faturado','nf_emitida','em_carga') then return new; end if;
  if destino = 'entregue' and atual not in ('em_rota') then return new; end if;

  perform set_config('app.sync_status', 'on', true);
  update public.pedidos set status = destino where id = new.pedido_id;
  perform set_config('app.sync_status', 'off', true);
  return new;
end $$;

-- -------------------------------------------------------------
-- 11. Views de apoio (separação, carga e painel do fluxo)
-- -------------------------------------------------------------
drop view if exists public.vw_separacao;
create or replace view public.vw_separacao as
select p.id as pedido_id, p.numero, p.status, p.centro_id, c.nome as centro,
       cli.razao_social as cliente, p.onda_id, p.rota_id,
       rep.nome as representante,
       pi.id as item_id,
       pr.id as produto_id, pr.codigo as produto_codigo, pr.descricao as produto,
       pi.quantidade as quantidade, pi.quantidade_separada, pi.divergencia_acao, pi.divergencia_obs,
       pi.conferido, pr.estoque_atual,
       r.nome as rota, r.sequencia as rota_sequencia,
       cli.sequencia_entrega as sequencia_entrega,
       e.numero as romaneio_numero, e.status as expedicao_status,
       s.status as separacao_status, s.separador_id, s.conferente_id,
       s.separada_em, s.conferida_em,
       p.observacoes
  from public.pedidos p
  join public.pedido_itens pi on pi.pedido_id = p.id
  join public.produtos pr on pr.id = pi.produto_id
  left join public.clientes cli on cli.id = p.cliente_id
  left join public.centros c on c.id = p.centro_id
  left join public.rotas r on r.id = p.rota_id
  left join public.representantes rep on rep.id = p.representante_id
  left join public.expedicoes e on e.pedido_id = p.id
  left join public.pedido_separacoes s on s.pedido_id = p.id
 where p.status in ('aprovado','confirmado','separacao','separado','conferido','faturado','nf_emitida','em_carga','em_rota');
grant select on public.vw_separacao to authenticated;
alter view public.vw_separacao set (security_invoker = on);

create or replace view public.vw_cargas as
select c.id, c.numero, c.data, c.status, c.rota_id, r.nome as rota, c.centro_id,
       c.responsavel, c.motorista, c.placa, c.transportadora_id, c.observacoes,
       c.valor_total, c.peso_kg,
       count(cp.pedido_id) as pedidos,
       count(distinct p.cliente_id) as clientes
  from public.cargas c
  left join public.rotas r on r.id = c.rota_id
  left join public.carga_pedidos cp on cp.carga_id = c.id
  left join public.pedidos p on p.id = cp.pedido_id
 group by c.id, r.nome;
grant select on public.vw_cargas to authenticated;
alter view public.vw_cargas set (security_invoker = on);

create or replace view public.vw_carga_pedidos as
select cp.carga_id, cp.pedido_id, p.numero, p.status, p.total_liquido, p.centro_id,
       cli.razao_social as cliente, r.nome as rota,
       n.nf_numero, n.status as nf_status,
       public.peso_pedido(p.id) as peso_kg
  from public.carga_pedidos cp
  join public.pedidos p on p.id = cp.pedido_id
  left join public.clientes cli on cli.id = p.cliente_id
  left join public.rotas r on r.id = p.rota_id
  left join public.notas_saida n on n.pedido_id = p.id and n.status in ('autorizada','emitida','pendente');
grant select on public.vw_carga_pedidos to authenticated;
alter view public.vw_carga_pedidos set (security_invoker = on);

-- pedidos prontos para carga
create or replace view public.vw_pedidos_para_carga as
select p.id as pedido_id, p.numero, p.status, p.rota_id, r.nome as rota, p.centro_id,
       cli.razao_social as cliente, p.total_liquido, public.peso_pedido(p.id) as peso_kg,
       n.nf_numero, n.status as nf_status
  from public.pedidos p
  left join public.rotas r on r.id = p.rota_id
  left join public.clientes cli on cli.id = p.cliente_id
  left join public.notas_saida n on n.pedido_id = p.id and n.status in ('autorizada','emitida')
 where p.status in ('faturado','nf_emitida')
   and not exists (select 1 from public.carga_pedidos cp join public.cargas cg on cg.id = cp.carga_id
                    where cp.pedido_id = p.id and cg.status <> 'cancelada');
grant select on public.vw_pedidos_para_carga to authenticated;
alter view public.vw_pedidos_para_carga set (security_invoker = on);

-- painel do fluxo operacional
create or replace view public.vw_fluxo_operacional as
select
  count(*) filter (where p.status = 'aguardando_aprovacao') as aguardando_aprovacao,
  count(*) filter (where p.status in ('aprovado','confirmado')) as aprovados,
  count(*) filter (where p.status = 'separacao') as em_separacao,
  count(*) filter (where p.status = 'separado') as separados,
  count(*) filter (where s.status = 'divergente') as com_divergencia,
  count(*) filter (where p.status = 'conferido') as prontos_faturamento,
  count(*) filter (where p.status = 'faturado') as faturados,
  count(*) filter (where p.status = 'nf_emitida') as nf_emitidas,
  count(*) filter (where p.status = 'em_carga') as em_carga,
  count(*) filter (where p.status = 'em_rota') as em_rota,
  count(*) filter (where p.status = 'entregue') as entregues
  from public.pedidos p
  left join public.pedido_separacoes s on s.pedido_id = p.id;
grant select on public.vw_fluxo_operacional to authenticated;
alter view public.vw_fluxo_operacional set (security_invoker = on);

-- rastreabilidade: uma linha por pedido com todos os elos do fluxo
create or replace view public.vw_rastreabilidade_pedido as
select p.id as pedido_id, p.numero, p.status, p.data_pedido, p.centro_id,
       cli.razao_social as cliente, rep.nome as representante, r.nome as rota,
       s.status as separacao_status, s.separada_em, s.conferida_em,
       n.id as nota_id, n.nf_numero, n.status as nf_status, n.chave_acesso,
       (select count(*) from public.contas_receber cr where cr.pedido_id = p.id) as parcelas,
       (select count(*) from public.boletos b where b.pedido_id = p.id and b.status <> 'cancelado') as boletos,
       cg.numero as carga_numero, cg.status as carga_status,
       e.numero as romaneio, e.status as expedicao_status, e.data_entrega
  from public.pedidos p
  left join public.clientes cli on cli.id = p.cliente_id
  left join public.representantes rep on rep.id = p.representante_id
  left join public.rotas r on r.id = p.rota_id
  left join public.pedido_separacoes s on s.pedido_id = p.id
  left join public.notas_saida n on n.pedido_id = p.id and n.status <> 'cancelada'
  left join public.carga_pedidos cp on cp.pedido_id = p.id
  left join public.cargas cg on cg.id = cp.carga_id
  left join public.expedicoes e on e.pedido_id = p.id and e.status <> 'cancelada';
grant select on public.vw_rastreabilidade_pedido to authenticated;
alter view public.vw_rastreabilidade_pedido set (security_invoker = on);

-- -------------------------------------------------------------
-- 12. Migração segura dos registros existentes
-- -------------------------------------------------------------
-- pedidos já faturados/entregues ganham separação conferida retroativa,
-- para não travarem no novo fluxo
insert into public.pedido_separacoes (pedido_id, status, separada_em, conferida_em)
select p.id, 'conferida', p.updated_at, p.updated_at
  from public.pedidos p
 where p.status in ('faturado','nf_emitida','em_carga','em_rota','entregue','parcial','devolvido','nao_entregue')
   and not exists (select 1 from public.pedido_separacoes s where s.pedido_id = p.id)
on conflict (pedido_id) do nothing;

update public.pedido_itens pi
   set quantidade_separada = pi.quantidade, conferido = true
  from public.pedidos p
 where p.id = pi.pedido_id
   and pi.quantidade_separada is null
   and p.status in ('faturado','nf_emitida','em_carga','em_rota','entregue','parcial','devolvido','nao_entregue');

-- notas já existentes passam a ser 'autorizada' quando têm número
update public.notas_saida set status = 'autorizada', autorizada_em = coalesce(autorizada_em, updated_at)
 where status = 'emitida' and coalesce(nf_numero,'') <> '';

-- boletos antigos ganham o vínculo com o pedido
update public.boletos b
   set pedido_id = cr.pedido_id
  from public.contas_receber cr
 where cr.id = b.conta_receber_id and b.pedido_id is null and cr.pedido_id is not null;
