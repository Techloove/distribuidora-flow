-- Estoque próprio por loja, atribuído pela categoria cadastrada na fase246.
-- Executar manualmente no Supabase. Não altera nomes das lojas ou documentos.
begin;
do $$begin
 if to_regprocedure('public.produto_categoria_loja_246(uuid,uuid)') is null or to_regclass('public.estoque_compartilhado_226') is null then raise exception 'Confira as fases226 e246 antes da fase271';end if;
end $$;
lock table public.produtos,public.centros,public.cad_categorias,public.depositos,public.deposito_saldos,public.deposito_movimentos,public.estoque_saldos,public.estoque_movimentos,public.estoque_reservas,public.inventarios,public.inventario_itens in share row exclusive mode;
create table if not exists public.estoque_por_loja_271(unico boolean primary key default true check(unico),ativado_em timestamptz not null default now());
create table if not exists public.estoque_retrato_271(tipo text not null,chave text not null,antes jsonb not null,created_at timestamptz not null default now(),primary key(tipo,chave));
alter table public.estoque_por_loja_271 enable row level security;
alter table public.estoque_retrato_271 enable row level security;
revoke all on public.estoque_por_loja_271,public.estoque_retrato_271 from public,anon,authenticated,service_role;
create or replace function public.loja_produto_estoque_271(_produto uuid) returns uuid
language sql stable security definer set search_path=public as $$
 select case when count(*)=1 then (array_agg(c.id))[1] end from public.produtos p join public.cad_categorias k on k.nome_norm=public.norm_txt(p.categoria) join public.centros c on c.categoria_produtos_id=k.id and c.ativo where p.id=_produto
$$;
revoke all on function public.loja_produto_estoque_271(uuid) from public,anon,authenticated,service_role;
do $$declare item record;op uuid:=gen_random_uuid();begin
 if exists(select 1 from public.estoque_por_loja_271) then return;end if;
 if exists(select 1 from public.produtos p where coalesce(p.estoque_atual,0)<>coalesce((select sum(s.quantidade) from public.deposito_saldos s where s.produto_id=p.id),0)) then raise exception 'Saldo físico diverge dos depósitos. Confira antes da fase271';end if;
 if exists(select 1 from public.produtos p where (coalesce(p.estoque_atual,0)<>0 or exists(select 1 from public.estoque_reservas r where r.produto_id=p.id)) and public.loja_produto_estoque_271(p.id) is null) then raise exception 'Há produto com saldo/reserva sem categoria vinculada a uma única loja ativa. Confira Categorias dos produtos e a categoria configurada em Lojas';end if;
 if exists(select 1 from public.estoque_reservas r where r.centro_id is distinct from public.loja_produto_estoque_271(r.produto_id)) then raise exception 'Há reserva de produto na loja incorreta para sua categoria. Regularize a reserva antes da fase271';end if;
 if exists(select 1 from public.produtos where estoque_atual::text in ('NaN','Infinity','-Infinity')) or exists(select 1 from public.deposito_saldos where quantidade::text in ('NaN','Infinity','-Infinity')) then raise exception 'Saldo inválido. Nenhuma migração aplicada';end if;
 insert into public.estoque_retrato_271 select 'depositos',id::text,to_jsonb(t),now() from public.depositos t;
 insert into public.estoque_retrato_271 select 'deposito_saldos',deposito_id::text||'/'||produto_id::text,to_jsonb(t),now() from public.deposito_saldos t;
 insert into public.estoque_retrato_271 select 'estoque_saldos',centro_id::text||'/'||produto_id::text,to_jsonb(t),now() from public.estoque_saldos t;
 for item in select id from public.centros where ativo order by id loop
  if not exists(select 1 from public.depositos where centro_id=item.id and padrao) then
   insert into public.depositos(centro_id,nome,padrao,ativo) values(item.id,'Principal',true,true) on conflict(centro_id,nome) do update set padrao=true,ativo=true;
  end if;
 end loop;
 -- Contagens abertas têm base anterior à redistribuição. Preserva os itens contados.
 for item in update public.inventarios set status='cancelado' where status='contagem' returning id loop
  insert into public.auditoria(tabela,registro_id,acao,detalhe) values('inventarios',item.id,'cancelado_estoque_loja_271','{"motivo":"Abra nova contagem no depósito da loja após a redistribuição por categoria"}');
 end loop;
 -- Um movimento interno de saída/entrada por posição alterada, sem compra/venda.
 insert into public.deposito_movimentos(deposito_id,produto_id,quantidade,origem,documento_id)
 select s.deposito_id,s.produto_id,-s.quantidade,'redistribuicao_categoria_271',op from public.deposito_saldos s where s.quantidade<>0 and not exists(select 1 from public.depositos d where d.id=s.deposito_id and d.padrao and d.centro_id=public.loja_produto_estoque_271(s.produto_id));
 insert into public.deposito_movimentos(deposito_id,produto_id,quantidade,origem,documento_id)
 select d.id,s.produto_id,sum(s.quantidade),'redistribuicao_categoria_271',op from public.deposito_saldos s join public.depositos d on d.padrao and d.centro_id=public.loja_produto_estoque_271(s.produto_id) where s.deposito_id<>d.id group by d.id,s.produto_id having sum(s.quantidade)<>0;
 update public.deposito_saldos set quantidade=0;
 insert into public.deposito_saldos(deposito_id,produto_id,quantidade)
 select d.id,p.id,coalesce(p.estoque_atual,0) from public.produtos p join public.depositos d on d.padrao and d.centro_id=public.loja_produto_estoque_271(p.id)
 on conflict(deposito_id,produto_id) do update set quantidade=excluded.quantidade;
 update public.estoque_saldos set quantidade=0;
 insert into public.estoque_saldos(produto_id,centro_id,quantidade,custo_medio)
 select p.id,public.loja_produto_estoque_271(p.id),coalesce(p.estoque_atual,0),coalesce(p.custo_medio,0) from public.produtos p where public.loja_produto_estoque_271(p.id) is not null
 on conflict(produto_id,centro_id) do update set quantidade=excluded.quantidade;
 update public.depositos set ativo=padrao and exists(select 1 from public.centros c where c.id=depositos.centro_id and c.ativo);
 if exists(select 1 from public.produtos p where coalesce(p.estoque_atual,0)<>coalesce((select sum(s.quantidade) from public.deposito_saldos s where s.produto_id=p.id),0)) then raise exception 'Conferência final falhou. Migração revertida';end if;
 insert into public.estoque_por_loja_271 values(true,now());
 insert into public.auditoria(tabela,acao,detalhe) values('fase271','instalada',jsonb_build_object('operacao',op,'regra','estoque próprio por categoria da loja','estoque_total_preservado',true,'reservas_preservadas',true));
end $$;
create unique index if not exists categoria_unica_loja_271 on public.centros(categoria_produtos_id) where ativo and categoria_produtos_id is not null;
create or replace function public.validar_disponivel_212()
returns trigger language plpgsql security definer set search_path=public as $$
declare saldo numeric; reservado numeric; delta numeric;
begin
 -- A mesma linha serializa reservas, entradas, saídas, transferências e inventários.
 perform 1 from public.produtos where id=new.produto_id for update; select coalesce((select quantidade from public.estoque_saldos where produto_id=new.produto_id and centro_id=new.centro_id),0) into saldo;
 delta:=case when new.tipo='entrada' then abs(new.quantidade) when new.tipo='saida' then -abs(new.quantidade) else new.quantidade end;
 if delta<0 then
  select coalesce(sum(r.quantidade),0) into reservado from public.estoque_reservas r
   where r.produto_id=new.produto_id and r.centro_id=new.centro_id and
    (new.origem is distinct from 'pedido' or new.documento_id is null or r.pedido_id is distinct from new.documento_id);
  if reservado>0 and saldo+delta<reservado then
   raise exception 'Saída compromete estoque reservado desta loja (saldo %, saída %, reservado %)',saldo,abs(delta),reservado;
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

  perform 1 from public.produtos where id=new.produto_id for update;
  perform 1 from public.centros where id=new.centro_id for share;
  perform 1 from public.cad_categorias where id=(select categoria_produtos_id from public.centros where id=new.centro_id) for share;
  if new.centro_id is null or new.centro_id is distinct from public.loja_produto_estoque_271(new.produto_id) then raise exception 'Produto pertence a outra loja ou não possui vínculo único de categoria';end if;
  if delta >= 0 then return new; end if;

  select descricao, coalesce(permite_estoque_negativo, false)
    into descricao_produto, permite
    from public.produtos
   where id = new.produto_id;

  select coalesce((select quantidade from public.estoque_saldos where produto_id=new.produto_id and centro_id=new.centro_id),0) into saldo;

  if coalesce(permite, false) = false and coalesce(saldo, 0) + delta < 0 then
    raise exception 'Estoque insuficiente para % no estoque desta loja (saldo %, saída %). Habilite "permite estoque negativo" no cadastro do produto para liberar.',
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
   perform 1 from public.produtos where id=i.produto_id for update;
   perform 1 from public.centros where id=new.centro_id for share;
   perform 1 from public.cad_categorias where id=(select categoria_produtos_id from public.centros where id=new.centro_id) for share;
   if new.centro_id is distinct from public.loja_produto_estoque_271(i.produto_id) then raise exception 'Produto não pertence ao estoque desta loja';end if;
   select coalesce((select quantidade from public.estoque_saldos where produto_id=i.produto_id and centro_id=new.centro_id),0) into saldo;
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
create or replace function public.depositar_movimento_213()
returns trigger language plpgsql security definer set search_path=public as $$
declare d record; delta numeric; restante numeric; retirar numeric; alvo uuid; permite boolean; total_depositos numeric; saldo_centro numeric;
begin
  delta:=case when new.tipo='entrada' then abs(new.quantidade) when new.tipo='saida' then -abs(new.quantidade) else new.quantidade end;
  if new.origem='inventario' then
    select deposito_id into alvo from public.inventarios where id=new.documento_id;
  else
    select id into alvo from public.depositos where centro_id=new.centro_id and padrao and ativo;
  end if;
  if alvo is null or not exists(select 1 from public.depositos where id=alvo and ativo and centro_id=new.centro_id) then
    raise exception 'Depósito principal da loja indisponível; confira a configuração';
  end if;
  if delta>0 then
    insert into public.deposito_saldos(deposito_id,produto_id,quantidade) values(alvo,new.produto_id,delta)
      on conflict(deposito_id,produto_id) do update set quantidade=deposito_saldos.quantidade+excluded.quantidade;
    insert into public.deposito_movimentos(deposito_id,produto_id,quantidade,origem,documento_id)
      values(alvo,new.produto_id,delta,coalesce(new.origem,'interno'),new.id);
  else
    restante:=-delta;
    for d in select s.* from public.deposito_saldos s join public.depositos p on p.id=s.deposito_id
      where s.produto_id=new.produto_id and p.centro_id=new.centro_id and p.ativo and s.quantidade>0
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
      select quantidade into saldo_centro from public.estoque_saldos where produto_id=new.produto_id and centro_id=new.centro_id;
      select coalesce(sum(s.quantidade),0) into total_depositos from public.deposito_saldos s join public.depositos p on p.id=s.deposito_id
        where s.produto_id=new.produto_id and p.centro_id=new.centro_id;
      if total_depositos-restante is distinct from saldo_centro then
        raise exception 'Estoque da loja e depósito divergem. Confira o inventário antes de confirmar';
      end if;
      insert into public.deposito_saldos(deposito_id,produto_id,quantidade) values(alvo,new.produto_id,-restante)
        on conflict(deposito_id,produto_id) do update set quantidade=deposito_saldos.quantidade+excluded.quantidade;
      insert into public.deposito_movimentos(deposito_id,produto_id,quantidade,origem,documento_id)
        values(alvo,new.produto_id,-restante,coalesce(new.origem,'interno'),new.id);
    end if;
  end if;
  return new;
end $$;
create or replace function public.abrir_inventario_213(_deposito uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare i uuid; c uuid;
begin
 select centro_id into c from public.depositos where id=_deposito and ativo;
 if c is null or not public.pode_rotina('inventario_contar') or not (public.can_manage(auth.uid()) or public.has_role(auth.uid(),'estoque')) or not public.usuario_ativo() or not public.usuario_pode_acessar_centro(c) then raise exception 'Sem acesso ao inventário'; end if;
 insert into public.inventarios(deposito_id) values(_deposito) returning id into i;
 insert into public.inventario_itens(inventario_id,produto_id,esperado) select i,produto_id,quantidade from public.deposito_saldos where deposito_id=_deposito and public.loja_produto_estoque_271(produto_id)=c;
 return i;
end $$;
create or replace function public.contar_inventario_213(_inventario uuid,_produto uuid,_contado numeric)
returns void language plpgsql security definer set search_path=public as $$
declare i public.inventarios; c uuid;
begin
 select * into i from public.inventarios where id=_inventario for update;
 select centro_id into c from public.depositos where id=i.deposito_id;
 if c is null or not public.pode_rotina('inventario_contar') or not (public.can_manage(auth.uid()) or public.has_role(auth.uid(),'estoque')) or not public.usuario_ativo() or not public.usuario_pode_acessar_centro(c) then raise exception 'Sem acesso à contagem'; end if;
 if c is distinct from public.loja_produto_estoque_271(_produto) then raise exception 'Produto não pertence ao depósito desta loja';end if;
 if i.status<>'contagem' or _contado is null or _contado<0 or _contado::text in ('NaN','Infinity','-Infinity') then raise exception 'Contagem inválida'; end if;
 insert into public.inventario_itens(inventario_id,produto_id,esperado,contado) select i.id,_produto,coalesce((select quantidade from public.deposito_saldos where deposito_id=i.deposito_id and produto_id=_produto),0),_contado on conflict(inventario_id,produto_id) do update set contado=excluded.contado;
end $$;
create or replace function public.conferir_inventario_213(_inventario uuid)
returns void language plpgsql security definer set search_path=public as $$
declare i public.inventarios; c uuid; r record; atual numeric; principal uuid; diferenca numeric;
begin
 select * into i from public.inventarios where id=_inventario for update;
 select centro_id into c from public.depositos where id=i.deposito_id;
 if c is null or not public.pode_rotina('inventario_conferir') or not (public.can_manage(auth.uid()) or public.has_role(auth.uid(),'estoque')) or not public.usuario_ativo() or not public.usuario_pode_acessar_centro(c) then raise exception 'Sem acesso à conferência'; end if;
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

create or replace function public.total_reservado_212(_produto uuid,_centro uuid) returns numeric
language sql stable security definer set search_path=public as $$select case when public.usuario_ativo() and public.usuario_pode_acessar_centro(_centro) then coalesce((select sum(quantidade) from public.estoque_reservas where produto_id=_produto and centro_id=_centro),0) else 0 end$$;
create or replace function public.saldos_estoque_loja_271(_centro uuid)
returns table(produto_id uuid,fisico numeric,reservado numeric,disponivel numeric,custo_medio numeric)
language plpgsql stable security definer set search_path=public as $$begin
 if not coalesce(public.usuario_ativo(),false) or _centro is null or not coalesce(public.usuario_pode_acessar_centro(_centro),false) then raise exception 'Loja sem acesso para consultar estoque';end if;
 return query select p.id,coalesce(s.quantidade,0),public.total_reservado_212(p.id,_centro),coalesce(s.quantidade,0)-public.total_reservado_212(p.id,_centro),coalesce(s.custo_medio,p.custo_medio,0) from public.produtos p left join public.estoque_saldos s on s.produto_id=p.id and s.centro_id=_centro where public.loja_produto_estoque_271(p.id)=_centro;
end $$;
revoke all on function public.saldos_estoque_loja_271(uuid) from public,anon,service_role;
grant execute on function public.saldos_estoque_loja_271(uuid) to authenticated;
-- Guardas impedem mudar a propriedade de mercadoria com saldo ou reservas.
create or replace function public.proteger_categoria_estoque_271() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if tg_table_name='produtos' then
  if public.norm_txt(new.categoria) is distinct from public.norm_txt(old.categoria) and (coalesce(old.estoque_atual,0)<>0 or exists(select 1 from public.estoque_reservas where produto_id=old.id)) then raise exception 'Produto com estoque/reserva: não altere sua categoria para outra loja';end if;
 elsif tg_table_name='centros' then
  if (new.categoria_produtos_id is distinct from old.categoria_produtos_id or new.ativo is distinct from old.ativo) and exists(select 1 from public.produtos p where public.loja_produto_estoque_271(p.id)=old.id and (coalesce(p.estoque_atual,0)<>0 or exists(select 1 from public.estoque_reservas where produto_id=p.id))) then raise exception 'Loja com estoque/reserva: preserve a categoria e a situação ativa';end if;
 else
  if new.nome_norm is distinct from old.nome_norm and exists(select 1 from public.centros c join public.produtos p on public.norm_txt(p.categoria)=old.nome_norm where c.categoria_produtos_id=old.id and (coalesce(p.estoque_atual,0)<>0 or exists(select 1 from public.estoque_reservas where produto_id=p.id))) then raise exception 'Categoria vinculada a estoque/reserva não pode ser reclassificada';end if;
 end if;return new;
end $$;
revoke all on function public.proteger_categoria_estoque_271() from public,anon,authenticated,service_role;
drop trigger if exists proteger_categoria_estoque_271 on public.produtos;
create trigger proteger_categoria_estoque_271 before update of categoria on public.produtos for each row execute function public.proteger_categoria_estoque_271();
drop trigger if exists proteger_categoria_estoque_271 on public.centros;
create trigger proteger_categoria_estoque_271 before update of categoria_produtos_id,ativo on public.centros for each row execute function public.proteger_categoria_estoque_271();
drop trigger if exists proteger_categoria_estoque_271 on public.cad_categorias;
create trigger proteger_categoria_estoque_271 before update of nome_norm on public.cad_categorias for each row execute function public.proteger_categoria_estoque_271();
-- Arquivos antigos ficam preservados. Um único depósito ativo por loja.
create or replace function public.proteger_deposito_loja_271() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if new.ativo and not new.padrao then raise exception 'Use o depósito principal vinculado automaticamente à loja';end if;
 if tg_op='UPDATE' and old.padrao and (new.centro_id is distinct from old.centro_id or not new.ativo or not new.padrao) then raise exception 'Preserve o depósito principal e seu vínculo com a loja';end if;
 return new;
end $$;
revoke all on function public.proteger_deposito_loja_271() from public,anon,authenticated,service_role;
drop trigger if exists proteger_deposito_loja_271 on public.depositos;
create trigger proteger_deposito_loja_271 before insert or update on public.depositos for each row execute function public.proteger_deposito_loja_271();
-- Depósitos não recebem uma transferência que contorne a categoria da loja.
create or replace function public.transferir_deposito_213(_origem uuid,_destino uuid,_produto uuid,_quantidade numeric,_chave uuid)
returns void language plpgsql security definer set search_path=public as $$begin raise exception 'Cada loja usa seu depósito principal. Não transfira produtos entre lojas por esta rotina';end$$;
create or replace function public.gerenciar_deposito_213(_centro uuid,_nome text,_deposito uuid default null,_produto uuid default null,_endereco text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare d uuid;
begin
 if not public.pode_rotina('deposito_operar') or not (public.can_manage(auth.uid()) or public.has_role(auth.uid(),'estoque')) or not public.acesso_estoque_compartilhado_226() or not public.usuario_pode_acessar_centro(_centro) then raise exception 'Sem acesso a depósitos'; end if;
 if _deposito is null then
  raise exception 'O depósito principal já é vinculado à loja. Não crie outro depósito';
 else
  select id into d from public.depositos where id=_deposito and ativo and padrao and centro_id=_centro;
  if d is null or _produto is null or _centro is distinct from public.loja_produto_estoque_271(_produto) or length(coalesce(_endereco,''))>120 then raise exception 'Depósito, produto ou endereço inválido'; end if;
  insert into public.deposito_saldos(deposito_id,produto_id,endereco) values(d,_produto,nullif(trim(_endereco),'')) on conflict(deposito_id,produto_id) do update set endereco=excluded.endereco;
 end if;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('depositos',d,'configurar',auth.uid(),jsonb_build_object('produto',_produto,'endereco',_endereco));
 return d;
end $$;

-- Relatórios antigos passam a expor posições por loja acessível, sem saldo global duplicado.
create or replace view public.vw_estoque_disponivel_212 with(security_invoker=on) as
 select e.produto_id,c.id centro_id,e.fisico::numeric(14,3) fisico,e.reservado,e.disponivel from public.centros c cross join lateral public.saldos_estoque_loja_271(c.id) e where c.ativo and public.usuario_pode_acessar_centro(c.id);
grant select on public.vw_estoque_disponivel_212 to authenticated;
-- O catálogo já filtra a categoria da loja. Reforça a exclusividade de vínculo.
do $$declare d text;begin
 if to_regprocedure('public.listar_catalogo_loja_244(uuid,text,boolean)') is not null then
  select pg_get_functiondef('public.listar_catalogo_loja_244(uuid,text,boolean)'::regprocedure) into d;
  if position('loja_produto_estoque_271' in d)=0 then
   if position('where l.centro_id=_loja and' in d)>0 then d:=replace(d,'where l.centro_id=_loja and','where public.loja_produto_estoque_271(p.id)=_loja and l.centro_id=_loja and');
   elsif position('where public.produto_categoria_loja_246(_loja,p.id) and l.centro_id=_loja and' in d)>0 then d:=replace(d,'where public.produto_categoria_loja_246(_loja,p.id) and l.centro_id=_loja and','where public.loja_produto_estoque_271(p.id)=_loja and public.produto_categoria_loja_246(_loja,p.id) and l.centro_id=_loja and');
   else raise exception 'Catálogo incompatível. Nenhuma migração aplicada';end if;execute d;
  end if;
 end if;
end $$;
drop policy if exists deposito_leitura_213 on public.depositos;
create policy deposito_leitura_213 on public.depositos for select to authenticated using(public.usuario_ativo() and public.usuario_pode_acessar_centro(centro_id));
revoke all on function public.validar_disponivel_212(),public.validar_estoque_negativo(),public.reservar_pedido_212(),public.depositar_movimento_213() from public,anon,authenticated;
revoke all on function public.gerenciar_deposito_213(uuid,text,uuid,uuid,text),public.transferir_deposito_213(uuid,uuid,uuid,numeric,uuid),public.abrir_inventario_213(uuid),public.contar_inventario_213(uuid,uuid,numeric),public.conferir_inventario_213(uuid) from public,anon;
grant execute on function public.gerenciar_deposito_213(uuid,text,uuid,uuid,text),public.transferir_deposito_213(uuid,uuid,uuid,numeric,uuid),public.abrir_inventario_213(uuid),public.contar_inventario_213(uuid,uuid,numeric),public.conferir_inventario_213(uuid) to authenticated;
create or replace view public.vw_sugestao_compras_centro
with (security_invoker = on) as
with centros_acessiveis as (
  select c.id, c.nome
    from public.centros c
   where c.ativo
     and public.usuario_pode_acessar_centro(c.id)
),
vendas as (
  select pi.produto_id, ped.centro_id,
    sum(case when ped.data_pedido >= current_date - interval '30 days' then pi.quantidade else 0 end) as v30,
    sum(case when ped.data_pedido >= current_date - interval '60 days' then pi.quantidade else 0 end) as v60,
    sum(case when ped.data_pedido >= current_date - interval '90 days' then pi.quantidade else 0 end) as v90
  from public.pedido_itens pi
  join public.pedidos ped on ped.id = pi.pedido_id
  where ped.centro_id is not null
    and ped.status not in ('cancelado','rascunho','digitacao','recusado')
  group by pi.produto_id, ped.centro_id
),
pendentes as (
  select pi.produto_id, ped.centro_id, sum(pi.quantidade) as qtd
    from public.pedido_itens pi
    join public.pedidos ped on ped.id = pi.pedido_id
   where ped.centro_id is not null
     and ped.status in ('rascunho','digitacao','aguardando_aprovacao','aprovado')
   group by pi.produto_id, ped.centro_id
),
transito as (
  select ci.produto_id, cp.centro_id, sum(ci.quantidade) as qtd
    from public.compra_itens ci
    join public.compras cp on cp.id = ci.compra_id
   where cp.centro_id is not null
     and cp.status in ('comprado')
   group by ci.produto_id, cp.centro_id
)
select
  p.id as produto_id,
  p.codigo,
  p.descricao,
  p.unidade,
  c.id as centro_id,
  c.nome as centro,
  coalesce(s.quantidade, 0)::numeric(14,3) as estoque_atual,
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
      - coalesce(s.quantidade,0)
      - coalesce(t.qtd,0),
      2
    ),
    0
  ) as sugestao
from public.produtos p
cross join centros_acessiveis c
left join public.estoque_saldos s
  on s.produto_id = p.id and s.centro_id = c.id
left join vendas v
  on v.produto_id = p.id and v.centro_id = c.id
left join pendentes pe
  on pe.produto_id = p.id and pe.centro_id = c.id
left join transito t
  on t.produto_id = p.id and t.centro_id = c.id
where p.ativo and exists(select 1 from public.centros cx join public.cad_categorias k on k.id=cx.categoria_produtos_id where cx.id=c.id and k.nome_norm=public.norm_txt(p.categoria));

-- Novas lojas também recebem seu depósito principal, sem depender do nome.
create or replace function public.criar_deposito_loja_271() returns trigger
language plpgsql security definer set search_path=public as $$begin
 insert into public.depositos(centro_id,nome,padrao,ativo) values(new.id,'Principal',true,new.ativo) on conflict do nothing;return new;
end$$;
revoke all on function public.criar_deposito_loja_271() from public,anon,authenticated,service_role;
drop trigger if exists criar_deposito_loja_271 on public.centros;
create trigger criar_deposito_loja_271 after insert on public.centros for each row execute function public.criar_deposito_loja_271();
-- Compatibilidade: consultas agregadas antigas não incluem reservas de outras lojas.
create or replace function public.total_reservado_226(_produto uuid) returns numeric
language sql stable security definer set search_path=public as $$select case when public.usuario_ativo() then coalesce((select sum(r.quantidade) from public.estoque_reservas r where r.produto_id=_produto and public.usuario_pode_acessar_centro(r.centro_id)),0) else 0 end$$;
create or replace view public.vw_estoque_compartilhado_226 with(security_invoker=on) as
 select p.id produto_id,coalesce(p.estoque_atual,0)::numeric(14,3) fisico,r.quantidade reservado,coalesce(p.estoque_atual,0)-r.quantidade disponivel,p.custo_medio
 from public.produtos p join public.cad_categorias k on k.nome_norm=public.norm_txt(p.categoria) join public.centros c on c.categoria_produtos_id=k.id and c.ativo cross join lateral(select public.total_reservado_226(p.id) quantidade) r
 where public.usuario_ativo() and public.usuario_pode_acessar_centro(c.id);
-- Alertas de estoque do dashboard seguem a loja selecionada e o acesso atual.
do $$declare d text;trecho text:='where coalesce(p.ativo,true)';begin
 if to_regprocedure('public.dashboard_resumo(uuid)') is not null then
  select pg_get_functiondef('public.dashboard_resumo(uuid)'::regprocedure) into d;
  if position('-- estoque_dashboard_271' in d)=0 then
   if position(trecho in d)=0 then raise exception 'Dashboard incompatível com a fase271';end if;
   d:=replace(d,trecho,trecho||' -- estoque_dashboard_271
   and exists(select 1 from public.centros cx join public.cad_categorias k on k.id=cx.categoria_produtos_id where cx.ativo and k.nome_norm=public.norm_txt(p.categoria) and public.usuario_pode_acessar_centro(cx.id) and (_centro_id is null or cx.id=_centro_id))');execute d;
  end if;
 end if;
end$$;
-- Assinaturas legadas de transferência não podem sugerir o antigo fluxo compartilhado.
do $legado$ declare r record;begin
 for r in select pg_get_function_arguments(p.oid) argumentos from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='transferir_estoque' loop
  execute 'create or replace function public.transferir_estoque('||r.argumentos||') returns uuid language plpgsql security definer set search_path=public as $body$begin raise exception ''Estoque próprio por loja. Transferência interlojas exige um procedimento específico de conciliação'';end$body$';
 end loop;
end$legado$;
notify pgrst,'reload schema';
commit;
