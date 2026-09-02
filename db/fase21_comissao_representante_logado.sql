-- Fase 21: comissao ligada ao cadastro unificado e ao usuario logado
-- Idempotente.

-- 1. sincroniza o login (profile) do representante a partir do cadastro unificado
create or replace function public.sincronizar_profile_representante()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.representantes r
     set profile_id = p.profile_id
    from public.pessoas p
   where r.pessoa_id = p.id
     and p.profile_id is not null
     and coalesce(r.profile_id, '00000000-0000-0000-0000-000000000000') <> p.profile_id;

  -- fallback por e-mail quando o cadastro ainda nao tem profile vinculado
  update public.representantes r
     set profile_id = pr.id
    from public.profiles pr
   where r.profile_id is null
     and pr.email is not null
     and lower(pr.email) = lower(coalesce(r.email, ''));
end $$;

select public.sincronizar_profile_representante();

create or replace function public.trg_sincronizar_profile_representante()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.profile_id is not null then
    update public.representantes set profile_id = new.profile_id
     where pessoa_id = new.id and coalesce(profile_id, '00000000-0000-0000-0000-000000000000') <> new.profile_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_pessoa_profile_representante on public.pessoas;
create trigger trg_pessoa_profile_representante
after insert or update of profile_id, is_representante on public.pessoas
for each row execute function public.trg_sincronizar_profile_representante();

-- 2. todo pedido criado por um representante logado fica vinculado a ele
create or replace function public.preencher_representante_pedido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rep uuid;
begin
  if new.representante_id is null then
    rep := public.meu_representante_id();
    if rep is null and new.cliente_id is not null then
      select representante_id into rep from public.clientes where id = new.cliente_id;
    end if;
    new.representante_id := rep;
  end if;
  return new;
end $$;

drop trigger if exists trg_representante_pedido on public.pedidos;
create trigger trg_representante_pedido
before insert on public.pedidos
for each row execute function public.preencher_representante_pedido();

-- 3. recalculo do pedido usa regra -> faixa escalonada -> percentual do cadastro
create or replace function public.recalcular_pedido(_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  soma numeric(14,2);
  base numeric(14,2);
  pct numeric(5,2);
  ped record;
begin
  select coalesce(sum(total), 0) into soma from public.pedido_itens where pedido_id = _pedido_id;
  select * into ped from public.pedidos where id = _pedido_id;
  if ped is null then return; end if;

  base := greatest(soma - coalesce(ped.desconto_valor, 0), 0);
  pct := public.resolver_comissao(ped.representante_id, ped.cliente_id, ped.data_pedido, null, base);

  update public.pedidos
     set total_itens = soma,
         total_liquido = greatest(soma - coalesce(desconto_valor,0) + coalesce(frete_valor,0), 0),
         comissao_percentual = pct,
         comissao_valor = round(base * pct / 100, 2)
   where id = _pedido_id;

  perform public.apurar_comissao_pedido(_pedido_id);
end $$;

-- 4. apuracao da comissao por pedido
create or replace function public.apurar_comissao_pedido(_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ped record;
  base numeric(14,2);
  st text;
begin
  select * into ped from public.pedidos where id = _pedido_id;
  if ped is null then return; end if;

  if ped.representante_id is null then
    delete from public.comissoes where pedido_id = _pedido_id and status in ('prevista','cancelada');
    return;
  end if;

  base := greatest(coalesce(ped.total_itens,0) - coalesce(ped.desconto_valor,0), 0);
  st := case
          when ped.status in ('cancelado','recusado','devolvido') then 'cancelada'
          when ped.status in ('faturado','em_rota','entregue') then 'liberada'
          else 'prevista'
        end;

  if exists (select 1 from public.comissoes where pedido_id = _pedido_id) then
    update public.comissoes
       set representante_id = ped.representante_id,
           base_calculo = base,
           percentual = coalesce(ped.comissao_percentual, 0),
           valor = round(base * coalesce(ped.comissao_percentual, 0) / 100, 2),
           status = case when status = 'paga' then 'paga' else st end,
           centro_id = coalesce(centro_id, ped.centro_id)
     where pedido_id = _pedido_id;
  else
    insert into public.comissoes (representante_id, pedido_id, base_calculo, percentual, valor, status, centro_id)
    values (ped.representante_id, ped.id, base, coalesce(ped.comissao_percentual, 0),
            round(base * coalesce(ped.comissao_percentual, 0) / 100, 2), st, ped.centro_id);
  end if;
end $$;

grant execute on function public.apurar_comissao_pedido(uuid) to authenticated;

create or replace function public.trg_apurar_comissao_pedido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.apurar_comissao_pedido(new.id);
  return new;
end $$;

drop trigger if exists trg_comissao_pedido on public.pedidos;
create trigger trg_comissao_pedido
after insert or update of status, representante_id, total_itens, desconto_valor, comissao_percentual
on public.pedidos
for each row execute function public.trg_apurar_comissao_pedido();

-- 5. alinha os pedidos existentes
do $$
declare p record;
begin
  for p in select id from public.pedidos loop
    perform public.apurar_comissao_pedido(p.id);
  end loop;
end $$;

-- 6. representante logado enxerga seus pedidos/comissoes (RLS ja existente reforcada)
drop policy if exists "pedidos_select_escopo" on public.pedidos;
create policy "pedidos_select_escopo" on public.pedidos
for select to authenticated
using (not public.escopo_representante() or representante_id = public.meu_representante_id());
