-- Fase226: estoque único compartilhado; centros identificam a operação comercial.
-- Execute APÓS225. Migração transacional e reaplicável; não soma o cadastro aos depósitos.
begin;
lock table public.produtos,public.estoque_movimentos,public.estoque_reservas,
 public.deposito_saldos,public.deposito_movimentos in share row exclusive mode;
do $$ begin
 if to_regprocedure('public.validar_negativo_deposito_225()') is null then
  raise exception 'Aplique a fase225 antes da fase226';
 end if;
end $$;
create table if not exists public.estoque_compartilhado_226 (
 unico boolean primary key default true check(unico),
 deposito_entrada uuid not null references public.depositos(id)
);
alter table public.estoque_compartilhado_226 enable row level security;
revoke all on public.estoque_compartilhado_226 from public,anon,authenticated;
-- Configuração interna: o centro do depósito é apenas um vínculo cadastral legado.
do $$ declare c uuid; d uuid; p record; total numeric; begin
 if not exists(select 1 from public.estoque_compartilhado_226) then
  select id into c from public.centros where ativo order by id limit 1;
  if c is null then raise exception 'Cadastre um centro ativo antes de compartilhar o estoque'; end if;
  insert into public.depositos(centro_id,nome,padrao)
   values(c,'Estoque compartilhado',false) on conflict(centro_id,nome) do update set ativo=true returning id into d;
  insert into public.estoque_compartilhado_226(deposito_entrada) values(d);
  for p in select * from public.produtos order by id loop
   select coalesce(sum(quantidade),0) into total from public.deposito_saldos where produto_id=p.id;
   if total is distinct from coalesce(p.estoque_atual,0) then
    -- Somente saldo legado ainda sem distribuição física pode ser inicializado.
    -- Distribuição/histórico existente divergente exige conferência, nunca soma cega.
    if exists(select 1 from public.deposito_saldos where produto_id=p.id and quantidade<>0)
       or exists(select 1 from public.deposito_movimentos where produto_id=p.id) then
     raise exception 'Produto %: cadastro (%) diverge dos depósitos (%). Confira os saldos antes da fase226.',p.descricao,p.estoque_atual,total;
    end if;
    insert into public.deposito_saldos(deposito_id,produto_id,quantidade)
     values(d,p.id,coalesce(p.estoque_atual,0))
     on conflict(deposito_id,produto_id) do update set quantidade=excluded.quantidade;
    insert into public.auditoria(tabela,registro_id,acao,detalhe)
     values('produtos',p.id,'distribuicao_legado_226',jsonb_build_object('saldo_preservado',p.estoque_atual,'deposito',d));
   end if;
   if exists(select 1 from public.estoque_reservas where produto_id=p.id) and coalesce(p.estoque_atual,0)<(select coalesce(sum(quantidade),0) from public.estoque_reservas where produto_id=p.id) then
    raise exception 'Reservas existentes excedem estoque compartilhado de %',p.descricao;
   end if;
  end loop;
  insert into public.auditoria(tabela,acao,detalhe) values('fase226','instalada','{"estoque":"compartilhado"}');
 end if;
end $$;

create or replace function public.acesso_estoque_compartilhado_226()
returns boolean language sql stable security definer set search_path=public as $$
 select public.usuario_ativo() and exists(select 1 from public.centros where public.usuario_pode_acessar_centro(id));
$$;
revoke all on function public.acesso_estoque_compartilhado_226() from public,anon;
grant execute on function public.acesso_estoque_compartilhado_226() to authenticated;

create or replace function public.validar_disponivel_212()
returns trigger language plpgsql security definer set search_path=public as $$
declare saldo numeric; reservado numeric; delta numeric;
begin
 -- A mesma linha serializa reservas, entradas, saídas, transferências e inventários.
 select coalesce(estoque_atual,0) into saldo from public.produtos where id=new.produto_id for update;
 delta:=case when new.tipo='entrada' then abs(new.quantidade) when new.tipo='saida' then -abs(new.quantidade) else new.quantidade end;
 if delta<0 then
  select coalesce(sum(r.quantidade),0) into reservado from public.estoque_reservas r
   where r.produto_id=new.produto_id and
    (new.origem is distinct from 'pedido' or new.documento_id is null or r.pedido_id is distinct from new.documento_id);
  if reservado>0 and saldo+delta<reservado then
   raise exception 'Saída compromete estoque compartilhado reservado (saldo %, saída %, reservado %)',saldo,abs(delta),reservado;
  end if;
 end if;
 return new;
end $$;
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

  select coalesce(estoque_atual,0) into saldo from public.produtos
   where id=new.produto_id for update;

  if coalesce(permite, false) = false and coalesce(saldo, 0) + delta < 0 then
    raise exception 'Estoque insuficiente para % no estoque compartilhado (saldo %, saída %). Habilite "permite estoque negativo" no cadastro do produto para liberar.',
      coalesce(descricao_produto, 'produto'), coalesce(saldo, 0), abs(delta);
  end if;

  return new;
end;
$$;
create or replace function public.reservar_pedido_212()
returns trigger language plpgsql security definer set search_path=public as $$
declare i record; saldo numeric; reservado numeric;
begin
 if new.status='aprovado' and old.status is distinct from new.status then
  if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.usuario_pode_acessar_centro(new.centro_id) or
   (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',new.id)) then raise exception 'Sem acesso para reservar pedido'; end if;
  if new.centro_id is null or not exists(select 1 from public.pedido_itens where pedido_id=new.id) then raise exception 'Centro e itens obrigatórios para reservar'; end if;
  for i in select produto_id,sum(quantidade) qtd from public.pedido_itens where pedido_id=new.id group by produto_id order by produto_id loop
   select coalesce(estoque_atual,0) into saldo from public.produtos where id=i.produto_id for update;
   select coalesce(sum(quantidade),0) into reservado from public.estoque_reservas where produto_id=i.produto_id and pedido_id<>new.id;
   if i.qtd<=0 or i.qtd::text in ('NaN','Infinity','-Infinity') or saldo-reservado<i.qtd then raise exception 'Estoque disponível insuficiente para reservar produto % (disponível %)',i.produto_id,saldo-reservado; end if;
   insert into public.estoque_reservas(pedido_id,produto_id,centro_id,quantidade) values(new.id,i.produto_id,new.centro_id,i.qtd)
   on conflict(pedido_id,produto_id) do update set quantidade=excluded.quantidade,centro_id=excluded.centro_id;
  end loop;
 elsif new.status<>'aprovado' and old.status='aprovado' then
  delete from public.estoque_reservas where pedido_id=new.id;
 end if;
 return new;
end $$;
-- estoque_saldos permanece como atribuição histórica, não disponibilidade física.
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

  perform 1 from public.produtos where id=new.produto_id for update;
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
create or replace function public.depositar_movimento_213()
returns trigger language plpgsql security definer set search_path=public as $$
declare d record; delta numeric; restante numeric; retirar numeric; alvo uuid; permite boolean; total_depositos numeric; saldo_centro numeric;
begin
  delta:=case when new.tipo='entrada' then abs(new.quantidade) when new.tipo='saida' then -abs(new.quantidade) else new.quantidade end;
  if new.origem='inventario' then
    select deposito_id into alvo from public.inventarios where id=new.documento_id;
  else
    select deposito_entrada into alvo from public.estoque_compartilhado_226;
  end if;
  if alvo is null or not exists(select 1 from public.depositos where id=alvo and ativo) then
    raise exception 'Depósito compartilhado indisponível; confira a configuração';
  end if;
  if delta>0 then
    insert into public.deposito_saldos(deposito_id,produto_id,quantidade) values(alvo,new.produto_id,delta)
      on conflict(deposito_id,produto_id) do update set quantidade=deposito_saldos.quantidade+excluded.quantidade;
    insert into public.deposito_movimentos(deposito_id,produto_id,quantidade,origem,documento_id)
      values(alvo,new.produto_id,delta,coalesce(new.origem,'interno'),new.id);
  else
    restante:=-delta;
    for d in select s.* from public.deposito_saldos s join public.depositos p on p.id=s.deposito_id
      where s.produto_id=new.produto_id and s.quantidade>0
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
      select estoque_atual into saldo_centro from public.produtos where id=new.produto_id;
      select coalesce(sum(s.quantidade),0) into total_depositos from public.deposito_saldos s join public.depositos p on p.id=s.deposito_id
        where s.produto_id=new.produto_id;
      if total_depositos-restante is distinct from saldo_centro then
        raise exception 'Estoque compartilhado e depósitos divergem. Confira o inventário antes de confirmar';
      end if;
      insert into public.deposito_saldos(deposito_id,produto_id,quantidade) values(alvo,new.produto_id,-restante)
        on conflict(deposito_id,produto_id) do update set quantidade=deposito_saldos.quantidade+excluded.quantidade;
      insert into public.deposito_movimentos(deposito_id,produto_id,quantidade,origem,documento_id)
        values(alvo,new.produto_id,-restante,coalesce(new.origem,'interno'),new.id);
    end if;
  end if;
  return new;
end $$;
create or replace function public.gerenciar_deposito_213(_centro uuid,_nome text,_deposito uuid default null,_produto uuid default null,_endereco text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare d uuid;
begin
 if not public.pode_rotina('deposito_operar') or not (public.can_manage(auth.uid()) or public.has_role(auth.uid(),'estoque')) or not public.acesso_estoque_compartilhado_226() or not public.usuario_pode_acessar_centro(_centro) then raise exception 'Sem acesso a depósitos'; end if;
 if _deposito is null then
  if nullif(trim(_nome),'') is null or length(_nome)>120 then raise exception 'Informe nome válido'; end if;
  insert into public.depositos(centro_id,nome) values(_centro,trim(_nome)) returning id into d;
 else
  select id into d from public.depositos where id=_deposito and ativo;
  if d is null or _produto is null or length(coalesce(_endereco,''))>120 then raise exception 'Depósito, produto ou endereço inválido'; end if;
  insert into public.deposito_saldos(deposito_id,produto_id,endereco) values(d,_produto,nullif(trim(_endereco),'')) on conflict(deposito_id,produto_id) do update set endereco=excluded.endereco;
 end if;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('depositos',d,'configurar',auth.uid(),jsonb_build_object('produto',_produto,'endereco',_endereco));
 return d;
end $$;
create or replace function public.transferir_deposito_213(_origem uuid,_destino uuid,_produto uuid,_quantidade numeric,_chave uuid)
returns void language plpgsql security definer set search_path=public as $$
declare c uuid; saldo numeric;
begin
 if not public.pode_rotina('deposito_operar') or not (public.can_manage(auth.uid()) or public.has_role(auth.uid(),'estoque')) then raise exception 'Sem acesso a transferências'; end if;
 select a.centro_id into c from public.depositos a join public.depositos b on b.id=_destino and b.ativo where a.id=_origem and a.ativo;
 if c is null or not public.acesso_estoque_compartilhado_226() or _origem=_destino or _quantidade is null or _quantidade<=0 or _quantidade::text in ('NaN','Infinity','-Infinity') or _chave is null then raise exception 'Transferência inválida'; end if;
 perform pg_advisory_xact_lock(hashtextextended('deposito:'||_chave,0));
 if exists(select 1 from public.deposito_movimentos where origem='transferencia' and documento_id=_chave) then
  if exists(select 1 from public.deposito_movimentos where documento_id=_chave and deposito_id=_origem and produto_id=_produto and quantidade=-_quantidade) and exists(select 1 from public.deposito_movimentos where documento_id=_chave and deposito_id=_destino and produto_id=_produto and quantidade=_quantidade) then return; end if;
  raise exception 'Chave já usada por outra transferência';
 end if;
 perform 1 from public.produtos where id=_produto for update;
 insert into public.deposito_saldos(deposito_id,produto_id) values(_destino,_produto) on conflict do nothing;
 perform 1 from public.deposito_saldos where produto_id=_produto and deposito_id in (_origem,_destino) order by deposito_id for update;
 select quantidade into saldo from public.deposito_saldos where deposito_id=_origem and produto_id=_produto;
 if coalesce(saldo,0)<_quantidade then raise exception 'Saldo insuficiente no depósito de origem'; end if;
 update public.deposito_saldos set quantidade=quantidade-_quantidade where deposito_id=_origem and produto_id=_produto;
 update public.deposito_saldos set quantidade=quantidade+_quantidade where deposito_id=_destino and produto_id=_produto;
 insert into public.deposito_movimentos(deposito_id,produto_id,quantidade,origem,documento_id) values(_origem,_produto,-_quantidade,'transferencia',_chave),(_destino,_produto,_quantidade,'transferencia',_chave);
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('depositos',_origem,'transferir',auth.uid(),jsonb_build_object('destino',_destino,'produto',_produto,'quantidade',_quantidade,'chave',_chave));
end $$;
create or replace function public.abrir_inventario_213(_deposito uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare i uuid; c uuid;
begin
 select centro_id into c from public.depositos where id=_deposito and ativo;
 if c is null or not public.pode_rotina('inventario_contar') or not (public.can_manage(auth.uid()) or public.has_role(auth.uid(),'estoque')) or not public.acesso_estoque_compartilhado_226() then raise exception 'Sem acesso ao inventário'; end if;
 insert into public.inventarios(deposito_id) values(_deposito) returning id into i;
 insert into public.inventario_itens(inventario_id,produto_id,esperado) select i,produto_id,quantidade from public.deposito_saldos where deposito_id=_deposito;
 return i;
end $$;
create or replace function public.contar_inventario_213(_inventario uuid,_produto uuid,_contado numeric)
returns void language plpgsql security definer set search_path=public as $$
declare i public.inventarios; c uuid;
begin
 select * into i from public.inventarios where id=_inventario for update;
 select centro_id into c from public.depositos where id=i.deposito_id;
 if c is null or not public.pode_rotina('inventario_contar') or not (public.can_manage(auth.uid()) or public.has_role(auth.uid(),'estoque')) or not public.acesso_estoque_compartilhado_226() then raise exception 'Sem acesso à contagem'; end if;
 if i.status<>'contagem' or _contado is null or _contado<0 or _contado::text in ('NaN','Infinity','-Infinity') then raise exception 'Contagem inválida'; end if;
 insert into public.inventario_itens(inventario_id,produto_id,esperado,contado) select i.id,_produto,coalesce((select quantidade from public.deposito_saldos where deposito_id=i.deposito_id and produto_id=_produto),0),_contado on conflict(inventario_id,produto_id) do update set contado=excluded.contado;
end $$;
create or replace function public.conferir_inventario_213(_inventario uuid)
returns void language plpgsql security definer set search_path=public as $$
declare i public.inventarios; c uuid; r record; atual numeric; principal uuid; diferenca numeric;
begin
 select * into i from public.inventarios where id=_inventario for update;
 select centro_id into c from public.depositos where id=i.deposito_id;
 if c is null or not public.pode_rotina('inventario_conferir') or not (public.can_manage(auth.uid()) or public.has_role(auth.uid(),'estoque')) or not public.acesso_estoque_compartilhado_226() then raise exception 'Sem acesso à conferência'; end if;
 if i.status='conferido' then return; end if;
 if i.status<>'contagem' or not exists(select 1 from public.inventario_itens where inventario_id=i.id) or exists(select 1 from public.inventario_itens where inventario_id=i.id and contado is null) then raise exception 'Conte todos os itens antes de conferir'; end if;
 select id into principal from public.depositos where centro_id=c and padrao;
 for r in select * from public.inventario_itens where inventario_id=i.id order by produto_id loop
  perform 1 from public.produtos where id=r.produto_id for update;
  select quantidade into atual from public.deposito_saldos where deposito_id=i.deposito_id and produto_id=r.produto_id for update;
  if coalesce(atual,0)<>r.esperado then raise exception 'Saldo mudou após abrir a contagem; abra novo inventário'; end if;
  diferenca:=r.contado-r.esperado;
  if diferenca<>0 then
   -- Motor global também protege as reservas. Reorganiza a distribuição para este depósito.
   perform public.registrar_movimento_estoque_controlado(r.produto_id,c,'ajuste',diferenca,null,'inventario',i.id,'Conferência de inventário');

  end if;
 end loop;
 update public.inventarios set status='conferido',conferido_por=auth.uid(),conferido_em=now() where id=i.id;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('inventarios',i.id,'conferir',auth.uid(),jsonb_build_object('deposito',i.deposito_id));
end $$;

-- Mudar apenas o centro comercial não transfere mercadoria física.
-- Use transferir_deposito_213 para deslocamentos físicos reais.
do $block$ declare r record; begin
 for r in select p.oid::regprocedure assinatura,pg_get_function_arguments(p.oid) argumentos
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='transferir_estoque' loop
  execute 'create or replace function public.transferir_estoque('||r.argumentos||') returns uuid language plpgsql security definer set search_path=public as $body$ begin raise exception ''O estoque é compartilhado entre centros. Use transferência entre depósitos para deslocar mercadoria.''; end $body$';
 end loop;
end $block$;

create or replace function public.total_reservado_226(_produto uuid)
returns numeric language sql stable security definer set search_path=public as $$
 select case when public.acesso_estoque_compartilhado_226() then
 (select coalesce(sum(quantidade),0) from public.estoque_reservas where produto_id=_produto) else 0 end;
$$;
revoke all on function public.total_reservado_226(uuid) from public,anon;
grant execute on function public.total_reservado_226(uuid) to authenticated;
create or replace function public.total_reservado_212(_produto uuid,_centro uuid)
returns numeric language sql stable security definer set search_path=public as $$
 select case when public.usuario_pode_acessar_centro(_centro) then public.total_reservado_226(_produto) else 0 end;
$$;
create or replace view public.vw_estoque_compartilhado_226 with(security_invoker=on) as
 select p.id produto_id,coalesce(p.estoque_atual,0)::numeric(14,3) fisico,r.quantidade reservado,
  coalesce(p.estoque_atual,0)-r.quantidade disponivel,p.custo_medio
 from public.produtos p cross join lateral(select public.total_reservado_226(p.id) quantidade) r
 where public.acesso_estoque_compartilhado_226();
grant select on public.vw_estoque_compartilhado_226 to authenticated;
-- A view legada expõe uma única posição global, sem repetir o saldo para cada centro.
create or replace view public.vw_estoque_disponivel_212 with(security_invoker=on) as
 select produto_id,null::uuid centro_id,fisico,reservado,disponivel from public.vw_estoque_compartilhado_226;
drop policy if exists deposito_leitura_213 on public.depositos;
create policy deposito_leitura_213 on public.depositos for select to authenticated
 using(public.acesso_estoque_compartilhado_226());

-- Impede novas divergências por edição do cadastro. Movimento autorizado atualiza
-- produtos em trigger aninhado; o saldo inicial passa pela rotina de entrada.
create or replace function public.proteger_saldo_produto_226()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='INSERT' then
  if coalesce(new.estoque_atual,0)<>0 then raise exception 'Cadastre o produto com saldo zero e lance a entrada no estoque compartilhado'; end if;
 elsif new.estoque_atual is distinct from old.estoque_atual and pg_trigger_depth()=1 then
  raise exception 'Altere o saldo pela rotina de estoque ou inventário, não pelo cadastro do produto';
 end if;
 return new;
end $$;
drop trigger if exists proteger_saldo_produto_226 on public.produtos;
create trigger proteger_saldo_produto_226 before insert or update of estoque_atual on public.produtos
 for each row execute function public.proteger_saldo_produto_226();
revoke all on function public.proteger_saldo_produto_226(),public.validar_disponivel_212(),public.validar_estoque_negativo(),public.reservar_pedido_212(),public.aplicar_movimento_estoque(),public.depositar_movimento_213() from public,anon,authenticated;
create or replace function public.dashboard_resumo(_centro_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  resultado jsonb;
begin
  if not public.usuario_ativo() then
    raise exception 'Acesso nao autorizado' using errcode = '42501';
  end if;

  if _centro_id is not null and not public.usuario_pode_acessar_centro(_centro_id) then
    raise exception 'Centro nao autorizado' using errcode = '42501';
  end if;

  with pedidos_escopo as (
    select p.*
      from public.pedidos p
     where (_centro_id is null or p.centro_id = _centro_id)
       and public.usuario_pode_acessar_centro(p.centro_id)
  ),
  receber_escopo as (
    select greatest(
      coalesce(cr.valor,0)
      + coalesce(cr.juros,0)
      + coalesce(cr.multa,0)
      + coalesce(cr.acrescimo,0)
      - coalesce(cr.desconto,0)
      - coalesce(cr.valor_pago,0),
      0
    )::numeric as saldo,
    cr.vencimento
      from public.contas_receber cr
     where cr.status in ('aberto','parcial')
       and (_centro_id is null or cr.centro_id = _centro_id)
       and public.usuario_pode_acessar_centro(cr.centro_id)
  ),
  pagar_escopo as (
    select greatest(
      coalesce(cp.valor,0)
      + coalesce(cp.juros,0)
      + coalesce(cp.multa,0)
      + coalesce(cp.acrescimo,0)
      - coalesce(cp.desconto,0)
      - coalesce(cp.valor_pago,0),
      0
    )::numeric as saldo,
    cp.vencimento
      from public.contas_pagar cp
     where cp.status in ('aberto','parcial')
       and (_centro_id is null or cp.centro_id = _centro_id)
       and public.usuario_pode_acessar_centro(cp.centro_id)
  ),
  saldos_produto as (
    select id produto_id,coalesce(estoque_atual,0)::numeric(14,3) quantidade from public.produtos
  ),
  alertas as (
    select p.id, p.descricao,
           coalesce(s.quantidade,0)::numeric(14,3) as estoque_atual,
           coalesce(p.estoque_minimo,0)::numeric as estoque_minimo
      from public.produtos p
      left join saldos_produto s on s.produto_id = p.id
     where coalesce(p.ativo,true)
       and coalesce(s.quantidade,0) <= coalesce(p.estoque_minimo,0)
     order by coalesce(s.quantidade,0) - coalesce(p.estoque_minimo,0), p.id
     limit 8
  )
  select jsonb_build_object(
    'clientes', (
      select count(*)
        from public.clientes c
       where (_centro_id is null or c.centro_id = _centro_id)
         and (c.centro_id is null or public.usuario_pode_acessar_centro(c.centro_id))
    ),
    'produtos', (select count(*) from public.produtos p where coalesce(p.ativo,true)),
    'pedidosAbertos', (
      select count(*) from pedidos_escopo
       where status in ('rascunho','digitacao','aguardando_aprovacao')
    ),
    'vendasConfirmadas', (
      select coalesce(sum(total_liquido),0) from pedidos_escopo
       where status in (
         'confirmado','aprovado','separacao','separado','conferido',
         'faturado','nf_emitida','em_carga','em_rota','entregue',
         'parcial','nao_entregue'
       )
    ),
    'receber', (select coalesce(sum(saldo),0) from receber_escopo),
    'receberVencido', (
      select coalesce(sum(saldo),0) from receber_escopo where vencimento < current_date
    ),
    'pagar', (select coalesce(sum(saldo),0) from pagar_escopo),
    'pagarVencido', (
      select coalesce(sum(saldo),0) from pagar_escopo where vencimento < current_date
    ),
    'comissoes', (
      select coalesce(sum(c.valor),0)
        from public.comissoes c
        join pedidos_escopo p on p.id = c.pedido_id
       where c.status not in ('cancelada','paga')
    ),
    'alertas', (select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from alertas a)
  )
  into resultado;

  return resultado;
end;
$$;
create or replace function public.diagnostico_integridade_220()
returns table(verificacao text,pendencias bigint)
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.pode_rotina('integridade_ver') or not public.can_manage(auth.uid()) then raise exception 'Diagnóstico restrito à gestão'; end if;
 return query
 select 'Estoque compartilhado negativo'::text,count(*) from public.produtos where estoque_atual<0
 union all
 select 'Reservas acima do estoque'::text,count(*) from public.produtos p where coalesce(p.estoque_atual,0)<coalesce((select sum(r.quantidade) from public.estoque_reservas r where r.produto_id=p.id),0)
 union all
 select 'Estoque compartilhado diferente dos depósitos'::text,count(*) from public.produtos p where coalesce(p.estoque_atual,0)<>coalesce((select sum(ds.quantidade) from public.deposito_saldos ds where ds.produto_id=p.id),0)
 union all
 select 'Contagens abertas'::text,count(*) from public.inventarios i join public.depositos d on d.id=i.deposito_id where i.status='contagem'
 union all
 select 'Recusas aguardando retorno conferido'::text,count(distinct d.id) from public.devolucoes d join public.entrega_itens t on t.devolucao_id=d.id where d.status is distinct from 'confirmada' and public.usuario_pode_acessar_centro(d.centro_id) and (not public.escopo_representante() or public.documento_na_minha_carteira('devolucoes',d.id));
end $$;
create or replace view public.vw_sugestao_compras_centro
with (security_invoker = on) as
with centros_acessiveis as (
  select null::uuid id,'Estoque compartilhado'::text nome where public.acesso_estoque_compartilhado_226()
),
vendas as (
  select pi.produto_id, null::uuid centro_id,
    sum(case when ped.data_pedido >= current_date - interval '30 days' then pi.quantidade else 0 end) as v30,
    sum(case when ped.data_pedido >= current_date - interval '60 days' then pi.quantidade else 0 end) as v60,
    sum(case when ped.data_pedido >= current_date - interval '90 days' then pi.quantidade else 0 end) as v90
  from public.pedido_itens pi
  join public.pedidos ped on ped.id = pi.pedido_id
  where ped.centro_id is not null
    and ped.status not in ('cancelado','rascunho','digitacao','recusado')
  group by pi.produto_id
),
pendentes as (
  select pi.produto_id, null::uuid centro_id, sum(pi.quantidade) as qtd
    from public.pedido_itens pi
    join public.pedidos ped on ped.id = pi.pedido_id
   where ped.centro_id is not null
     and ped.status in ('rascunho','digitacao','aguardando_aprovacao','aprovado')
   group by pi.produto_id
),
transito as (
  select ci.produto_id, null::uuid centro_id, sum(ci.quantidade) as qtd
    from public.compra_itens ci
    join public.compras cp on cp.id = ci.compra_id
   where cp.centro_id is not null
     and cp.status in ('comprado')
   group by ci.produto_id
)
select
  p.id as produto_id,
  p.codigo,
  p.descricao,
  p.unidade,
  c.id as centro_id,
  c.nome as centro,
  coalesce(p.estoque_atual, 0)::numeric(14,3) as estoque_atual,
  p.estoque_minimo,
  p.estoque_maximo,
  p.prazo_fornecedor_dias,
  coalesce(v.v30,0)::numeric(14,3) as venda_30,
  coalesce(v.v60,0)::numeric(14,3) as venda_60,
  coalesce(v.v90,0)::numeric(14,3) as venda_90,
  round(coalesce(v.v90,0)/3.0, 2) as media_mensal,
  coalesce(pe.qtd,0)::numeric(14,3) as pedidos_pendentes,
  coalesce(t.qtd,0)::numeric(14,3) as em_transito,
  greatest(
    round(
      greatest(
        coalesce(p.estoque_maximo,0),
        round(coalesce(v.v90,0)/3.0,2) + coalesce(p.estoque_minimo,0)
      )
      + coalesce(pe.qtd,0)
      - coalesce(p.estoque_atual,0)
      - coalesce(t.qtd,0),
      2
    ),
    0
  ) as sugestao
from public.produtos p
cross join centros_acessiveis c
left join vendas v
  on v.produto_id = p.id
left join pendentes pe
  on pe.produto_id = p.id
left join transito t
  on t.produto_id = p.id
where p.ativo;


notify pgrst,'reload schema';
commit;
