-- Fase225: reserva não substitui a política de estoque negativo do produto.
-- Não altera saldos, permissões de produtos, pedidos ou recebíveis.
begin;
do $$ begin
  if to_regprocedure('public.validar_disponivel_212()') is null or
    to_regprocedure('public.validar_estoque_negativo()') is null then
    raise exception 'Aplique as fases55 e212 antes da fase225';
  end if;
end $$;
create or replace function public.validar_disponivel_212()
returns trigger language plpgsql security definer set search_path=public as $$
declare saldo numeric; reservado numeric; delta numeric; produto text; centro text;
begin
  delta:=case when new.tipo='entrada' then abs(new.quantidade) when new.tipo='saida' then -abs(new.quantidade) else new.quantidade end;
  if delta<0 and new.centro_id is not null then
    -- Mesma linha de saldo usada na aprovação e na baixa: serializa saídas e reservas.
    insert into public.estoque_saldos(produto_id,centro_id) values(new.produto_id,new.centro_id) on conflict do nothing;
    select quantidade into saldo from public.estoque_saldos where produto_id=new.produto_id and centro_id=new.centro_id for update;
    select coalesce(sum(r.quantidade),0) into reservado from public.estoque_reservas r
      where r.produto_id=new.produto_id and r.centro_id=new.centro_id
        and (new.origem is distinct from 'pedido' or new.documento_id is null or r.pedido_id is distinct from new.documento_id);
    -- Só protege reservas REAIS de outros pedidos. Sem reserva, a fase55 decide
    -- se o saldo pode ficar negativo conforme permite_estoque_negativo.
    if reservado>0 and coalesce(saldo,0)+delta<reservado then
      select descricao into produto from public.produtos where id=new.produto_id;
      select nome into centro from public.centros where id=new.centro_id;
      raise exception 'Saída de % compromete mercadoria reservada no centro % (saldo %, saída %, reservado %).',
        coalesce(produto,new.produto_id::text),coalesce(centro,new.centro_id::text),coalesce(saldo,0),abs(delta),reservado;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.validar_disponivel_212() from public,anon,authenticated;
-- O saldo contábil do depósito principal pode ficar negativo para produtos
-- expressamente autorizados. A contagem física de inventário continua >=0.
create or replace function public.validar_negativo_deposito_225()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.quantidade<0 then
    if tg_op='UPDATE' then
      if new.produto_id=old.produto_id and new.deposito_id=old.deposito_id and new.quantidade>=old.quantidade then return new; end if;
    end if;
    if not exists(select 1 from public.produtos where id=new.produto_id and permite_estoque_negativo) then
      raise exception 'Produto nao permite saldo negativo no deposito';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.validar_negativo_deposito_225() from public,anon,authenticated;
do $migration$
begin
  if to_regprocedure('public.depositar_movimento_213()') is not null then
    alter table public.deposito_saldos drop constraint if exists deposito_saldos_quantidade_check;
    drop trigger if exists validar_negativo_deposito_225 on public.deposito_saldos;
    create trigger validar_negativo_deposito_225 before insert or update on public.deposito_saldos
      for each row execute function public.validar_negativo_deposito_225();
    execute $ddl$
create or replace function public.depositar_movimento_213()
returns trigger language plpgsql security definer set search_path=public as $body$
declare d record; delta numeric; restante numeric; retirar numeric; alvo uuid; permite boolean; total_depositos numeric; saldo_centro numeric;
begin
  delta:=case when new.tipo='entrada' then abs(new.quantidade) when new.tipo='saida' then -abs(new.quantidade) else new.quantidade end;
  if new.origem='inventario' then
    select deposito_id into alvo from public.inventarios where id=new.documento_id;
  else
    select id into alvo from public.depositos where centro_id=new.centro_id and padrao;
  end if;
  if alvo is null then
    insert into public.depositos(centro_id,nome,padrao) values(new.centro_id,'Principal',true) returning id into alvo;
  end if;
  if delta>0 then
    insert into public.deposito_saldos(deposito_id,produto_id,quantidade) values(alvo,new.produto_id,delta)
      on conflict(deposito_id,produto_id) do update set quantidade=deposito_saldos.quantidade+excluded.quantidade;
    insert into public.deposito_movimentos(deposito_id,produto_id,quantidade,origem,documento_id)
      values(alvo,new.produto_id,delta,coalesce(new.origem,'interno'),new.id);
  else
    restante:=-delta;
    for d in select s.* from public.deposito_saldos s join public.depositos p on p.id=s.deposito_id
      where p.centro_id=new.centro_id and s.produto_id=new.produto_id and s.quantidade>0
        and (new.origem is distinct from 'inventario' or s.deposito_id=alvo)
      order by p.padrao desc,p.id for update of s loop
      retirar:=least(d.quantidade,restante);
      update public.deposito_saldos set quantidade=quantidade-retirar where deposito_id=d.deposito_id and produto_id=new.produto_id;
      insert into public.deposito_movimentos(deposito_id,produto_id,quantidade,origem,documento_id)
        values(d.deposito_id,new.produto_id,-retirar,coalesce(new.origem,'interno'),new.id);
      restante:=restante-retirar;exit when restante=0;
    end loop;
    if restante>0 then
      select permite_estoque_negativo into permite from public.produtos where id=new.produto_id;
      if not coalesce(permite,false) or new.origem='inventario' or new.tipo<>'saida' then
        raise exception 'Saldo físico por depósito insuficiente; confira o inventário';
      end if;
      -- Não mascara diferenças já existentes entre o centro e os depósitos.
      select quantidade into saldo_centro from public.estoque_saldos where centro_id=new.centro_id and produto_id=new.produto_id;
      select coalesce(sum(s.quantidade),0) into total_depositos from public.deposito_saldos s join public.depositos p on p.id=s.deposito_id
        where p.centro_id=new.centro_id and s.produto_id=new.produto_id;
      if total_depositos-restante is distinct from saldo_centro then
        raise exception 'Saldo do centro e depósitos divergem. Confira o inventário antes de confirmar';
      end if;
      insert into public.deposito_saldos(deposito_id,produto_id,quantidade) values(alvo,new.produto_id,-restante)
        on conflict(deposito_id,produto_id) do update set quantidade=deposito_saldos.quantidade+excluded.quantidade;
      insert into public.deposito_movimentos(deposito_id,produto_id,quantidade,origem,documento_id)
        values(alvo,new.produto_id,-restante,coalesce(new.origem,'interno'),new.id);
    end if;
  end if;
  return new;
end $body$;
$ddl$;
    revoke all on function public.depositar_movimento_213() from public,anon,authenticated;
  end if;
end $migration$;

notify pgrst,'reload schema';
commit;
