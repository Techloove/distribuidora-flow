-- Fase212: reserva física na aprovação; não baixa estoque duas vezes.
begin;
create table if not exists public.estoque_reservas (
 pedido_id uuid not null references public.pedidos(id),produto_id uuid not null references public.produtos(id),
 centro_id uuid not null references public.centros(id),quantidade numeric(14,3) not null check(quantidade>0),
 created_at timestamptz not null default now(),primary key(pedido_id,produto_id)
);
alter table public.estoque_reservas enable row level security;
revoke all on public.estoque_reservas from public,anon,authenticated;
grant select on public.estoque_reservas to authenticated;
drop policy if exists reservas_leitura on public.estoque_reservas;
create policy reservas_leitura on public.estoque_reservas for select to authenticated using(
 public.usuario_ativo() and public.usuario_pode_acessar_centro(centro_id) and
 (not public.escopo_representante() or public.documento_na_minha_carteira('pedidos',pedido_id)));
create index if not exists reservas_saldo on public.estoque_reservas(centro_id,produto_id);

create or replace function public.reservar_pedido_212()
returns trigger language plpgsql security definer set search_path=public as $$
declare i record; saldo numeric; reservado numeric;
begin
 if new.status='aprovado' and old.status is distinct from new.status then
  if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.usuario_pode_acessar_centro(new.centro_id) or
   (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',new.id)) then raise exception 'Sem acesso para reservar pedido'; end if;
  if new.centro_id is null or not exists(select 1 from public.pedido_itens where pedido_id=new.id) then raise exception 'Centro e itens obrigatórios para reservar'; end if;
  for i in select produto_id,sum(quantidade) qtd from public.pedido_itens where pedido_id=new.id group by produto_id order by produto_id loop
   insert into public.estoque_saldos(produto_id,centro_id) values(i.produto_id,new.centro_id) on conflict do nothing;
   select quantidade into saldo from public.estoque_saldos where produto_id=i.produto_id and centro_id=new.centro_id for update;
   select coalesce(sum(quantidade),0) into reservado from public.estoque_reservas where produto_id=i.produto_id and centro_id=new.centro_id and pedido_id<>new.id;
   if i.qtd<=0 or i.qtd::text in ('NaN','Infinity','-Infinity') or saldo-reservado<i.qtd then raise exception 'Estoque disponível insuficiente para reservar produto % (disponível %)',i.produto_id,saldo-reservado; end if;
   insert into public.estoque_reservas(pedido_id,produto_id,centro_id,quantidade) values(new.id,i.produto_id,new.centro_id,i.qtd)
   on conflict(pedido_id,produto_id) do update set quantidade=excluded.quantidade,centro_id=excluded.centro_id;
  end loop;
 elsif new.status<>'aprovado' and old.status='aprovado' then
  delete from public.estoque_reservas where pedido_id=new.id;
 end if;
 return new;
end $$;
drop trigger if exists reserva_pedido_212 on public.pedidos;
-- AFTER: confirmação já consumiu a própria reserva pela saída, então libera a reserva.
create trigger reserva_pedido_212 after update of status on public.pedidos for each row execute function public.reservar_pedido_212();

create or replace function public.proteger_reserva_212()
returns trigger language plpgsql security definer set search_path=public as $$
declare p uuid;
begin
 if tg_table_name='pedidos' then
  if old.status='aprovado' and (new.centro_id is distinct from old.centro_id or new.cliente_id is distinct from old.cliente_id) then raise exception 'Retorne o pedido à digitação antes de alterar centro ou cliente'; end if;
 else
  p:=case when tg_op='DELETE' then old.pedido_id else new.pedido_id end;
  if exists(select 1 from public.estoque_reservas where pedido_id=p) and
   (tg_op<>'UPDATE' or new.quantidade is distinct from old.quantidade or new.produto_id is distinct from old.produto_id or new.pedido_id is distinct from old.pedido_id) then raise exception 'Retorne o pedido à digitação antes de alterar itens reservados'; end if;
  if tg_op='UPDATE' and new.pedido_id is distinct from old.pedido_id and exists(select 1 from public.estoque_reservas where pedido_id=old.pedido_id) then raise exception 'Item pertence a pedido reservado'; end if;
 end if;
 return coalesce(new,old);
end $$;
drop trigger if exists proteger_reserva_212 on public.pedido_itens;
create trigger proteger_reserva_212 before insert or update or delete on public.pedido_itens for each row execute function public.proteger_reserva_212();
drop trigger if exists proteger_centro_reserva_212 on public.pedidos;
create trigger proteger_centro_reserva_212 before update on public.pedidos for each row execute function public.proteger_reserva_212();

create or replace function public.validar_disponivel_212()
returns trigger language plpgsql security definer set search_path=public as $$
declare saldo numeric; reservado numeric; delta numeric;
begin
 delta:=case when new.tipo='entrada' then abs(new.quantidade) when new.tipo='saida' then -abs(new.quantidade) else new.quantidade end;
 if delta<0 then
  select quantidade into saldo from public.estoque_saldos where produto_id=new.produto_id and centro_id=new.centro_id for update;
  select coalesce(sum(quantidade),0) into reservado from public.estoque_reservas where produto_id=new.produto_id and centro_id=new.centro_id and
    not (new.origem='pedido' and new.documento_id is not null and pedido_id=new.documento_id);
  if coalesce(saldo,0)+delta<reservado then raise exception 'Saída compromete mercadoria reservada (saldo %, reservado %)',coalesce(saldo,0),reservado; end if;
 end if;
 return new;
end $$;
drop trigger if exists a_disponivel_212 on public.estoque_movimentos;
create trigger a_disponivel_212 before insert on public.estoque_movimentos for each row execute function public.validar_disponivel_212();
-- Aprovações anteriores passam a reservar também; inconsistências abortam a fase.
do $$ begin
 if not exists(select 1 from public.auditoria where tabela='fase212' and acao='instalada') then
  if exists(select 1 from public.pedidos where status='aprovado' and centro_id is null) then raise exception 'Há pedido aprovado sem centro; regularize antes da fase212'; end if;
  insert into public.estoque_reservas(pedido_id,produto_id,centro_id,quantidade)
  select p.id,i.produto_id,p.centro_id,sum(i.quantidade) from public.pedidos p join public.pedido_itens i on i.pedido_id=p.id where p.status='aprovado' group by p.id,i.produto_id,p.centro_id on conflict do nothing;
  if exists(select 1 from public.estoque_reservas r left join public.estoque_saldos s on s.produto_id=r.produto_id and s.centro_id=r.centro_id group by r.produto_id,r.centro_id,s.quantidade having sum(r.quantidade)>coalesce(s.quantidade,0)) then raise exception 'Pedidos aprovados excedem estoque físico; regularize antes de reservar'; end if;
  insert into public.auditoria(tabela,acao,detalhe) values('fase212','instalada','{}');
 end if;
end $$;

create or replace function public.total_reservado_212(_produto uuid,_centro uuid)
returns numeric language sql stable security definer set search_path=public as $$
 select case when public.usuario_ativo() and public.usuario_pode_acessar_centro(_centro)
 then (select coalesce(sum(quantidade),0) from public.estoque_reservas where produto_id=_produto and centro_id=_centro) else 0 end;
$$;
revoke all on function public.total_reservado_212(uuid,uuid) from public,anon;
grant execute on function public.total_reservado_212(uuid,uuid) to authenticated;
create or replace view public.vw_estoque_disponivel_212 with(security_invoker=on) as
select s.produto_id,s.centro_id,s.quantidade fisico,coalesce(r.quantidade,0) reservado,s.quantidade-coalesce(r.quantidade,0) disponivel
from public.estoque_saldos s left join lateral(
 -- Total de reservas do centro, sem revelar pedidos de outras carteiras.
 select public.total_reservado_212(s.produto_id,s.centro_id) quantidade
) r on true;
grant select on public.vw_estoque_disponivel_212 to authenticated;
revoke all on function public.reservar_pedido_212(),public.proteger_reserva_212(),public.validar_disponivel_212() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
