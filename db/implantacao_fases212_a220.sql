-- Implantação das fases212–220. Pré-requisito: fase211 aplicada.
-- Execute o arquivo inteiro no SQL Editor do Supabase, papel postgres.
-- Mantenha RLS ativado. Não execute partes selecionadas.
begin;

-- Fonte: fase212_reservas_estoque.sql
-- Fase212: reserva física na aprovação; não baixa estoque duas vezes.

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

-- Fonte: fase213_depositos_inventario.sql
-- Fase213: depósitos, endereços, transferências internas e inventário conferido.

create table if not exists public.depositos (
 id uuid primary key default gen_random_uuid(),centro_id uuid not null references public.centros(id),nome text not null,
 padrao boolean not null default false,ativo boolean not null default true,unique(centro_id,nome)
);
create unique index if not exists deposito_padrao_213 on public.depositos(centro_id) where padrao;
create table if not exists public.deposito_saldos (
 deposito_id uuid not null references public.depositos(id),produto_id uuid not null references public.produtos(id),
 quantidade numeric(14,3) not null default 0 check(quantidade>=0),endereco text,
 primary key(deposito_id,produto_id)
);
create table if not exists public.deposito_movimentos (
 id uuid primary key default gen_random_uuid(),deposito_id uuid not null references public.depositos(id),produto_id uuid not null references public.produtos(id),
 quantidade numeric(14,3) not null check(quantidade<>0),origem text not null,documento_id uuid,created_by uuid default auth.uid(),created_at timestamptz not null default now()
);
create table if not exists public.inventarios (
 id uuid primary key default gen_random_uuid(),deposito_id uuid not null references public.depositos(id),
 status text not null default 'contagem' check(status in ('contagem','conferido','cancelado')),
 criado_por uuid not null default auth.uid(),conferido_por uuid,created_at timestamptz not null default now(),conferido_em timestamptz
);
create table if not exists public.inventario_itens (
 inventario_id uuid not null references public.inventarios(id),produto_id uuid not null references public.produtos(id),
 esperado numeric(14,3) not null,contado numeric(14,3) check(contado>=0),primary key(inventario_id,produto_id)
);
insert into public.depositos(centro_id,nome,padrao) select id,'Principal',true from public.centros on conflict do nothing;
-- Uma única carga inicial; reaplicação não restaura saldos já transferidos.
do $$ begin
 if not exists(select 1 from public.permissoes where codigo='deposito_operar') then
  if exists(select 1 from public.estoque_saldos where quantidade<0) then raise exception 'Regularize saldos negativos antes de implantar depósitos'; end if;
  insert into public.deposito_saldos(deposito_id,produto_id,quantidade)
  select d.id,s.produto_id,s.quantidade from public.estoque_saldos s join public.depositos d on d.centro_id=s.centro_id and d.padrao on conflict do nothing;
 end if;
end $$;
insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values
 ('deposito_operar','Gerenciar depósitos, endereços e transferências','Estoque',120,'/estoque'),
 ('inventario_contar','Abrir inventário e registrar contagem','Estoque',121,'/estoque'),
 ('inventario_conferir','Conferir inventário e aplicar diferenças','Estoque',122,'/estoque') on conflict do nothing;
insert into public.role_permissoes(role,permissao)
select p.codigo,a from public.papeis p cross join unnest(array['deposito_operar','inventario_contar','inventario_conferir']) a
where p.codigo='estoque' and not exists(select 1 from public.role_permissoes r where r.role=p.codigo and r.permissao=a) and not exists(select 1 from public.auditoria where tabela='fase213' and acao='instalada') on conflict do nothing;
insert into public.auditoria(tabela,acao,detalhe) select 'fase213','instalada','{}'::jsonb where not exists(select 1 from public.auditoria where tabela='fase213' and acao='instalada');

do $$ declare t text; begin
 foreach t in array array['depositos','deposito_saldos','deposito_movimentos','inventarios','inventario_itens'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('drop policy if exists deposito_leitura_213 on public.%I',t);
 end loop;
end $$;
create policy deposito_leitura_213 on public.depositos for select to authenticated using(public.usuario_ativo() and public.usuario_pode_acessar_centro(centro_id));
create policy deposito_leitura_213 on public.deposito_saldos for select to authenticated using(exists(select 1 from public.depositos where id=deposito_id));
create policy deposito_leitura_213 on public.deposito_movimentos for select to authenticated using(exists(select 1 from public.depositos where id=deposito_id) and (public.can_manage(auth.uid()) or public.has_role(auth.uid(),'estoque')));
create policy deposito_leitura_213 on public.inventarios for select to authenticated using(exists(select 1 from public.depositos where id=deposito_id) and (public.can_manage(auth.uid()) or public.has_role(auth.uid(),'estoque')));
create policy deposito_leitura_213 on public.inventario_itens for select to authenticated using(exists(select 1 from public.inventarios where id=inventario_id));

create or replace function public.depositar_movimento_213()
returns trigger language plpgsql security definer set search_path=public as $$
declare d record; delta numeric; restante numeric; retirar numeric; alvo uuid;
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
  insert into public.deposito_saldos(deposito_id,produto_id,quantidade) values(alvo,new.produto_id,delta) on conflict(deposito_id,produto_id) do update set quantidade=deposito_saldos.quantidade+excluded.quantidade;
  insert into public.deposito_movimentos(deposito_id,produto_id,quantidade,origem,documento_id) values(alvo,new.produto_id,delta,new.origem,new.id);
 else
  restante:=-delta;
  for d in select s.* from public.deposito_saldos s join public.depositos p on p.id=s.deposito_id where p.centro_id=new.centro_id and s.produto_id=new.produto_id and s.quantidade>0 and (new.origem<>'inventario' or s.deposito_id=alvo) order by p.padrao desc,p.id for update of s loop
   retirar:=least(d.quantidade,restante);
   update public.deposito_saldos set quantidade=quantidade-retirar where deposito_id=d.deposito_id and produto_id=new.produto_id;
   insert into public.deposito_movimentos(deposito_id,produto_id,quantidade,origem,documento_id) values(d.deposito_id,new.produto_id,-retirar,new.origem,new.id);
   restante:=restante-retirar;exit when restante=0;
  end loop;
  if restante>0 then raise exception 'Saldo físico por depósito insuficiente; confira o inventário'; end if;
 end if;
 return new;
end $$;
drop trigger if exists z_depositar_movimento_213 on public.estoque_movimentos;
create trigger z_depositar_movimento_213 after insert on public.estoque_movimentos for each row execute function public.depositar_movimento_213();

create or replace function public.gerenciar_deposito_213(_centro uuid,_nome text,_deposito uuid default null,_produto uuid default null,_endereco text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare d uuid;
begin
 if not public.pode_rotina('deposito_operar') or not (public.can_manage(auth.uid()) or public.has_role(auth.uid(),'estoque')) or not public.usuario_pode_acessar_centro(_centro) then raise exception 'Sem acesso a depósitos'; end if;
 if _deposito is null then
  if nullif(trim(_nome),'') is null or length(_nome)>120 then raise exception 'Informe nome válido'; end if;
  insert into public.depositos(centro_id,nome) values(_centro,trim(_nome)) returning id into d;
 else
  select id into d from public.depositos where id=_deposito and centro_id=_centro and ativo;
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
 select a.centro_id into c from public.depositos a join public.depositos b on b.id=_destino and b.centro_id=a.centro_id and b.ativo where a.id=_origem and a.ativo;
 if c is null or not public.usuario_pode_acessar_centro(c) or _origem=_destino or _quantidade is null or _quantidade<=0 or _quantidade::text in ('NaN','Infinity','-Infinity') or _chave is null then raise exception 'Transferência inválida'; end if;
 perform pg_advisory_xact_lock(hashtextextended('deposito:'||_chave,0));
 if exists(select 1 from public.deposito_movimentos where origem='transferencia' and documento_id=_chave) then
  if exists(select 1 from public.deposito_movimentos where documento_id=_chave and deposito_id=_origem and produto_id=_produto and quantidade=-_quantidade) and exists(select 1 from public.deposito_movimentos where documento_id=_chave and deposito_id=_destino and produto_id=_produto and quantidade=_quantidade) then return; end if;
  raise exception 'Chave já usada por outra transferência';
 end if;
 perform 1 from public.estoque_saldos where centro_id=c and produto_id=_produto for update;
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
 if not public.pode_rotina('inventario_contar') or not (public.can_manage(auth.uid()) or public.has_role(auth.uid(),'estoque')) or not public.usuario_pode_acessar_centro(c) then raise exception 'Sem acesso ao inventário'; end if;
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
 if not public.pode_rotina('inventario_contar') or not (public.can_manage(auth.uid()) or public.has_role(auth.uid(),'estoque')) or not public.usuario_pode_acessar_centro(c) then raise exception 'Sem acesso à contagem'; end if;
 if i.status<>'contagem' or _contado is null or _contado<0 or _contado::text in ('NaN','Infinity','-Infinity') then raise exception 'Contagem inválida'; end if;
 insert into public.inventario_itens(inventario_id,produto_id,esperado,contado) select i.id,_produto,coalesce((select quantidade from public.deposito_saldos where deposito_id=i.deposito_id and produto_id=_produto),0),_contado on conflict(inventario_id,produto_id) do update set contado=excluded.contado;
end $$;
create or replace function public.conferir_inventario_213(_inventario uuid)
returns void language plpgsql security definer set search_path=public as $$
declare i public.inventarios; c uuid; r record; atual numeric; principal uuid; diferenca numeric;
begin
 select * into i from public.inventarios where id=_inventario for update;
 select centro_id into c from public.depositos where id=i.deposito_id;
 if not public.pode_rotina('inventario_conferir') or not (public.can_manage(auth.uid()) or public.has_role(auth.uid(),'estoque')) or not public.usuario_pode_acessar_centro(c) then raise exception 'Sem acesso à conferência'; end if;
 if i.status='conferido' then return; end if;
 if i.status<>'contagem' or not exists(select 1 from public.inventario_itens where inventario_id=i.id) or exists(select 1 from public.inventario_itens where inventario_id=i.id and contado is null) then raise exception 'Conte todos os itens antes de conferir'; end if;
 select id into principal from public.depositos where centro_id=c and padrao;
 for r in select * from public.inventario_itens where inventario_id=i.id order by produto_id loop
  perform 1 from public.estoque_saldos where centro_id=c and produto_id=r.produto_id for update;
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
revoke all on function public.depositar_movimento_213() from public,anon,authenticated;
revoke all on function public.gerenciar_deposito_213(uuid,text,uuid,uuid,text),public.transferir_deposito_213(uuid,uuid,uuid,numeric,uuid),public.abrir_inventario_213(uuid),public.contar_inventario_213(uuid,uuid,numeric),public.conferir_inventario_213(uuid) from public,anon;
grant execute on function public.gerenciar_deposito_213(uuid,text,uuid,uuid,text),public.transferir_deposito_213(uuid,uuid,uuid,numeric,uuid),public.abrir_inventario_213(uuid),public.contar_inventario_213(uuid,uuid,numeric),public.conferir_inventario_213(uuid) to authenticated;
notify pgrst,'reload schema';

-- Fonte: fase214_entregas_parciais.sql
-- Fase214: entregas por item, recusas com devolução pendente e comprovantes privados.

alter table public.entrega_registros add column if not exists arquivo_path text;
create table if not exists public.entrega_itens (
 registro_id uuid not null references public.entrega_registros(id),pedido_item_id uuid not null references public.pedido_itens(id),
 entregue numeric(14,3) not null default 0 check(entregue>=0),recusado numeric(14,3) not null default 0 check(recusado>=0),
 devolucao_id uuid references public.devolucoes(id),check(entregue+recusado>0),primary key(registro_id,pedido_item_id)
);
create index if not exists entrega_item_saldo_214 on public.entrega_itens(pedido_item_id);
create index if not exists entrega_devolucao_214 on public.entrega_itens(devolucao_id) where devolucao_id is not null;
alter table public.entrega_itens enable row level security;
revoke all on public.entrega_itens from public,anon,authenticated;
grant select on public.entrega_itens to authenticated;
drop policy if exists entrega_itens_leitura_214 on public.entrega_itens;
create policy entrega_itens_leitura_214 on public.entrega_itens for select to authenticated using(exists(select 1 from public.entrega_registros where id=registro_id));
alter table public.entrega_registros add column if not exists chave_operacao uuid;
create unique index if not exists entrega_chave_214 on public.entrega_registros(chave_operacao) where chave_operacao is not null;
insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values('entrega_parcial_operar','Registrar entregas parciais e recusas por item','Entregas',123,'/expedicao') on conflict do nothing;
do $$ begin
 if not exists(select 1 from public.auditoria where tabela='fase214' and acao='instalada') then
  insert into public.role_permissoes(role,permissao) select codigo,'entrega_parcial_operar' from public.papeis where codigo='expedicao' on conflict do nothing;
  insert into public.auditoria(tabela,acao,detalhe) values('fase214','instalada','{}');
 end if;
end $$;
-- Sem emissão fiscal neste projeto: preserva faturamento comercial/conferência.
update public.parametros set valor='false' where chave in ('exigir_nf_carga','exigir_nf_boleto');

create or replace function public.registrar_parcial_214(_expedicao uuid,_itens jsonb,_recebedor text,_motivo text,_arquivo text,_chave uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare e public.expedicoes; p public.pedidos; r record; i public.pedido_itens; feito numeric; reg uuid; dev uuid; restantes numeric;
begin
 if not public.pode_rotina('entrega_parcial_operar') or not public.pode_rotina('entrega_registrar') or not public.can_ship(auth.uid()) then raise exception 'Sem acesso à entrega por item'; end if;
 select * into e from public.expedicoes where id=_expedicao for update;
 select * into p from public.pedidos where id=e.pedido_id for update;
 if e.id is null or not public.usuario_pode_acessar_centro(e.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',p.id)) then raise exception 'Expedição sem acesso'; end if;
 if p.status in ('rascunho','digitacao','aguardando_aprovacao','aprovado','cancelado','recusado') then raise exception 'Pedido não está no ciclo de entrega'; end if;
 if _chave is null or _itens is null or jsonb_typeof(_itens)<>'array' or jsonb_array_length(_itens) not between 1 and 300 or nullif(trim(_recebedor),'') is null or length(_recebedor)>120 or length(coalesce(_motivo,''))>4000 or length(coalesce(_arquivo,''))>1000 then raise exception 'Dados da entrega inválidos'; end if;
 select id into reg from public.entrega_registros where chave_operacao=_chave and expedicao_id=e.id;
 if reg is not null then
  if not exists(select 1 from public.entrega_registros where id=reg and recebedor=trim(_recebedor) and coalesce(observacao,'')=coalesce(_motivo,'') and arquivo_path=_arquivo) or
   (select jsonb_agg(jsonb_build_object('item_id',x.item_id,'entregue',x.entregue,'recusado',x.recusado) order by x.item_id) from jsonb_to_recordset(_itens) x(item_id uuid,entregue numeric,recusado numeric)) is distinct from
   (select jsonb_agg(jsonb_build_object('item_id',pedido_item_id,'entregue',entregue,'recusado',recusado) order by pedido_item_id) from public.entrega_itens where registro_id=reg)
  then raise exception 'Chave de entrega já usada com dados diferentes'; end if;
  return reg;
 end if;
 if e.status<>'em_rota' then raise exception 'Expedição deve estar em rota'; end if;
 if _arquivo is null or _arquivo not like e.id::text||'/%' or not exists(select 1 from storage.objects where bucket_id='entrega-comprovantes' and name=_arquivo) then raise exception 'Envie o comprovante privado antes de registrar'; end if;
 if exists(select 1 from jsonb_to_recordset(_itens) x(item_id uuid,entregue numeric,recusado numeric) group by item_id having count(*)>1) then raise exception 'Item duplicado'; end if;
 insert into public.entrega_registros(expedicao_id,pedido_id,centro_id,tipo,recebedor,comprovante,observacao,arquivo_path,chave_operacao)
 values(e.id,p.id,e.centro_id,'ocorrencia',trim(_recebedor),_arquivo,_motivo,_arquivo,_chave) returning id into reg;
 for r in select * from jsonb_to_recordset(_itens) x(item_id uuid,entregue numeric,recusado numeric) loop
  select * into i from public.pedido_itens where id=r.item_id and pedido_id=p.id for update;
  if i.id is null or r.entregue is null or r.recusado is null or r.entregue<0 or r.recusado<0 or r.entregue+r.recusado<=0 or r.entregue::text in ('NaN','Infinity','-Infinity') or r.recusado::text in ('NaN','Infinity','-Infinity') then raise exception 'Quantidade ou item inválido'; end if;
  select coalesce(sum(t.entregue+t.recusado),0) into feito from public.entrega_itens t where t.pedido_item_id=i.id;
  if feito+r.entregue+r.recusado>i.quantidade then raise exception 'Quantidade excede saldo do item'; end if;
  if r.recusado>0 then
   if nullif(trim(_motivo),'') is null then raise exception 'Informe motivo da recusa'; end if;
   if dev is null then
    insert into public.devolucoes(pedido_id,cliente_id,centro_id,motivo,created_by) values(p.id,p.cliente_id,p.centro_id,'Recusa na entrega: '||_motivo,auth.uid()) returning id into dev;
   end if;
   insert into public.devolucao_itens(devolucao_id,produto_id,quantidade,preco_unitario,condicao) values(dev,i.produto_id,r.recusado,i.preco_unitario,'revenda');
  end if;
  insert into public.entrega_itens(registro_id,pedido_item_id,entregue,recusado,devolucao_id) values(reg,i.id,r.entregue,r.recusado,case when r.recusado>0 then dev end);
 end loop;
 select sum(li.quantidade-coalesce(t.qtd,0)) into restantes from public.pedido_itens li left join lateral(select sum(entregue+recusado) qtd from public.entrega_itens where pedido_item_id=li.id) t on true where li.pedido_id=p.id;
 if restantes>0 or dev is not null then update public.pedidos set status='parcial' where id=p.id and status<>'parcial'; end if;
 if restantes=0 and dev is null and not exists(select 1 from public.entrega_itens t join public.entrega_registros er on er.id=t.registro_id join public.devolucoes d on d.id=t.devolucao_id where er.pedido_id=p.id and d.status is distinct from 'confirmada') then
  update public.entrega_registros set tipo='entrega' where id=reg;
  perform public.avancar_expedicao(e.id,'entregue',current_date);
 end if;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('entrega_registros',reg,'entrega_itens',auth.uid(),jsonb_build_object('itens',_itens,'devolucao_pendente',dev));
 return reg;
end $$;
-- Expedição concluída atualiza o pedido; não deixa o ciclo comercial em rota.
create or replace function public.sincronizar_entrega_214()
returns trigger language plpgsql security definer set search_path=public as $$
declare destino text;
begin
 if new.status='entregue' and old.status is distinct from new.status then
  destino:=case when exists(select 1 from public.entrega_itens t join public.entrega_registros r on r.id=t.registro_id where r.pedido_id=new.pedido_id)
   and not exists(select 1 from public.entrega_itens t join public.entrega_registros r on r.id=t.registro_id where r.pedido_id=new.pedido_id and t.entregue>0) then 'devolvido' else 'entregue' end;
  update public.pedidos set status=destino where id=new.pedido_id and status is distinct from destino;
 end if;
 return new;
end $$;
drop trigger if exists sincronizar_entrega_214 on public.expedicoes;
create trigger sincronizar_entrega_214 after update of status on public.expedicoes for each row execute function public.sincronizar_entrega_214();
revoke all on function public.sincronizar_entrega_214() from public,anon,authenticated;

-- Recusas geram rascunho: a gestão confere o retorno físico antes de repor estoque/gerar crédito.
-- Mantém os papéis financeiros existentes, sem permitir que expedição faça créditos sozinha.
create or replace function public.permitir_rascunho_recusa_214()
returns trigger language plpgsql set search_path=public as $$
begin
 if tg_op='INSERT' then
  if tg_table_name='devolucoes' then
   if new.status='rascunho' and new.created_by=auth.uid() and public.can_ship(auth.uid()) and public.pode_rotina('entrega_parcial_operar') then return new; end if;
  elsif tg_table_name='devolucao_itens' then
   if public.can_ship(auth.uid()) and public.pode_rotina('entrega_parcial_operar') and exists(select 1 from public.devolucoes d where d.id=new.devolucao_id and d.status='rascunho' and d.created_by=auth.uid() and d.motivo like 'Recusa na entrega:%') then return new; end if;
  end if;
 end if;
 -- O total do rascunho é recalculado pelo trigger dos itens inseridos pelo RPC.
 -- Isso não libera alteração de status, cliente, centro, motivo ou quantidade.
 if tg_op='UPDATE' and tg_table_name='devolucoes' then
  if pg_trigger_depth()>1 and old.status='rascunho' and new.status='rascunho' and old.created_by=auth.uid()
   and old.motivo like 'Recusa na entrega:%' and public.can_ship(auth.uid()) and public.pode_rotina('entrega_parcial_operar')
   and (to_jsonb(new)-'valor_total'-'updated_at')=(to_jsonb(old)-'valor_total'-'updated_at') then return new; end if;
 end if;
 if not public.pode_rotina('devolucao_operar') then raise exception 'Devolução não liberada para seu perfil'; end if;
 return coalesce(new,old);
end $$;
-- Retorno recusado pode ser conferido quando o pedido ainda está em rota/carga.
-- A exceção exige vínculo com a entrega; demais devoluções mantêm os estados originais.
do $$ declare d text; trecho text:='if ped.status not in (''confirmado'',''faturado'',''entregue'',''parcial'',''nao_entregue'',''devolvido'') then'; begin
 select pg_get_functiondef('public.confirmar_devolucao(uuid)'::regprocedure) into d;
 if position('recusa_rota_214' in d)=0 then
  if position(trecho in d)=0 then raise exception 'Confirmação de devolução incompatível com fase214'; end if;
  d:=replace(d,trecho,'if ped.status not in (''confirmado'',''faturado'',''entregue'',''parcial'',''nao_entregue'',''devolvido'') and not (ped.status in (''em_rota'',''em_carga'') and exists(select 1 from public.entrega_itens where devolucao_id=dev.id)) then -- recusa_rota_214');
  execute d;
 end if;
end $$;
-- O RPC SECURITY DEFINER cria rascunhos; escritas diretas continuam sob RLS existente.
drop trigger if exists operacao_acesso_211 on public.devolucoes;
create trigger operacao_acesso_211 before insert or update or delete on public.devolucoes for each row execute function public.permitir_rascunho_recusa_214();
drop trigger if exists operacao_acesso_211 on public.devolucao_itens;
create trigger operacao_acesso_211 before insert or update or delete on public.devolucao_itens for each row execute function public.permitir_rascunho_recusa_214();

create or replace function public.finalizar_recusa_214()
returns trigger language plpgsql security definer set search_path=public as $$
declare e public.expedicoes; reg uuid;
begin
 if new.status='confirmada' and old.status is distinct from new.status and exists(select 1 from public.entrega_itens where devolucao_id=new.id) then
  select * into e from public.expedicoes where pedido_id=new.pedido_id and status='em_rota' for update;
  if e.id is not null and not exists(select 1 from public.pedido_itens i where i.pedido_id=new.pedido_id and i.quantidade>coalesce((select sum(t.entregue+t.recusado) from public.entrega_itens t where t.pedido_item_id=i.id),0)) and
   not exists(select 1 from public.entrega_itens t join public.entrega_registros r on r.id=t.registro_id join public.devolucoes d on d.id=t.devolucao_id where r.pedido_id=new.pedido_id and d.status is distinct from 'confirmada') then
   select id into reg from public.entrega_registros where expedicao_id=e.id and chave_operacao is not null order by created_at desc limit 1;
   update public.entrega_registros set tipo='entrega' where id=reg;
   perform public.avancar_expedicao(e.id,'entregue',current_date);
  end if;
 end if;
 return new;
end $$;
drop trigger if exists finalizar_recusa_214 on public.devolucoes;
create trigger finalizar_recusa_214 after update of status on public.devolucoes for each row execute function public.finalizar_recusa_214();
revoke all on function public.finalizar_recusa_214() from public,anon,authenticated;

create or replace function public.proteger_saldo_entrega_214()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='entregue' and old.status is distinct from new.status and exists(select 1 from public.entrega_registros r join public.entrega_itens t on t.registro_id=r.id where r.expedicao_id=new.id) then
  if exists(select 1 from public.pedido_itens i where i.pedido_id=new.pedido_id and i.quantidade>coalesce((select sum(entregue+recusado) from public.entrega_itens where pedido_item_id=i.id),0)) or exists(select 1 from public.entrega_registros r join public.entrega_itens t on t.registro_id=r.id join public.devolucoes d on d.id=t.devolucao_id where r.expedicao_id=new.id and d.status is distinct from 'confirmada') then raise exception 'Resolva saldo e devoluções da entrega parcial antes de concluir'; end if;
 end if;
 return new;
end $$;
drop trigger if exists saldo_entrega_214 on public.expedicoes;
create trigger saldo_entrega_214 before update of status on public.expedicoes for each row execute function public.proteger_saldo_entrega_214();
revoke all on function public.proteger_saldo_entrega_214() from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('entrega-comprovantes','entrega-comprovantes',false,5242880,array['image/jpeg','image/png','application/pdf']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists comprovante_ler_214 on storage.objects;
create policy comprovante_ler_214 on storage.objects for select to authenticated using(bucket_id='entrega-comprovantes' and public.pode_rotina('entrega_registrar') and exists(select 1 from public.expedicoes e where e.id::text=split_part(name,'/',1)));
drop policy if exists comprovante_enviar_214 on storage.objects;
create policy comprovante_enviar_214 on storage.objects for insert to authenticated with check(bucket_id='entrega-comprovantes' and public.pode_rotina('entrega_parcial_operar') and public.can_ship(auth.uid()) and exists(select 1 from public.expedicoes e where e.id::text=split_part(name,'/',1) and e.status='em_rota'));
revoke all on function public.registrar_parcial_214(uuid,jsonb,text,text,text,uuid) from public,anon;
grant execute on function public.registrar_parcial_214(uuid,jsonb,text,text,text,uuid) to authenticated;
revoke all on function public.permitir_rascunho_recusa_214() from public,anon,authenticated;
notify pgrst,'reload schema';

-- Fonte: fase215_comissoes_e_rentabilidade.sql
-- Fase215: comissão por produto, faixas determinísticas e faturamento comercial sem NF.

alter table public.produtos add column if not exists comissao_fixa_unidade numeric(14,4) check(comissao_fixa_unidade>=0);
alter table public.comissao_faixas add column if not exists progressiva boolean not null default false;
alter table public.pedidos add column if not exists faturado_em timestamptz;
alter table public.pedidos add column if not exists tributos_estimados numeric(14,2) not null default 0 check(tributos_estimados>=0);
alter table public.pedidos add column if not exists despesas_variaveis numeric(14,2) not null default 0 check(despesas_variaveis>=0);
-- Serializa alterações do catálogo e impede faixas ativas ambíguas.
create or replace function public.validar_faixa_215()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('catalogo_comissao_215',0));
 if new.valor_min is null or new.valor_min<0 or new.valor_min::text in ('NaN','Infinity','-Infinity') or
 (new.valor_max is not null and (new.valor_max<=new.valor_min or new.valor_max::text in ('NaN','Infinity','-Infinity'))) or
 new.percentual is null or new.percentual<0 or new.percentual>100 or new.percentual::text in ('NaN','Infinity','-Infinity') then
 raise exception 'Faixa inválida: confira limites e percentual entre 0 e 100'; end if;
 if new.ativo and exists(select 1 from public.comissao_faixas f where f.id is distinct from new.id and f.ativo and f.representante_id is not distinct from new.representante_id
 and ((f.periodo,f.base_calculo,f.progressiva) is distinct from (new.periodo,new.base_calculo,new.progressiva)
 or (f.valor_min<coalesce(new.valor_max,'Infinity'::numeric) and new.valor_min<coalesce(f.valor_max,'Infinity'::numeric)))) then
 raise exception 'Faixas ativas incompatíveis ou sobrepostas para este representante'; end if;
 return new;
end $$;
drop trigger if exists validar_faixa_215 on public.comissao_faixas;
create trigger validar_faixa_215 before insert or update on public.comissao_faixas for each row execute function public.validar_faixa_215();
revoke all on function public.validar_faixa_215() from public,anon,authenticated;

create or replace function public.marcar_faturamento_215()
returns trigger language plpgsql set search_path=public as $$
begin
 if new.status='faturado' and old.status is distinct from new.status then new.faturado_em:=coalesce(old.faturado_em,now()); end if;
 return new;
end $$;
drop trigger if exists faturamento_comercial_215 on public.pedidos;
create trigger faturamento_comercial_215 before update of status on public.pedidos for each row execute function public.marcar_faturamento_215();

create or replace function public.percentual_faixa_215(_pedido uuid)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare p public.pedidos; f record; r record; rep uuid; periodos int; base numeric; atual numeric; ini date; fim date; acumulado numeric; valor numeric:=0; anterior numeric:=0;
begin
 select * into p from public.pedidos where id=_pedido;
 if p.representante_id is null then return null; end if;
 rep:=case when exists(select 1 from public.comissao_faixas where ativo and representante_id=p.representante_id) then p.representante_id else null end;
 select count(distinct (periodo,base_calculo,progressiva)) into periodos from public.comissao_faixas where ativo and representante_id is not distinct from rep;
 if periodos=0 then return null; end if;
 if periodos>1 then raise exception 'Use uma única apuração, base e modalidade nas faixas ativas de cada representante'; end if;
 select * into f from public.comissao_faixas where ativo and representante_id is not distinct from rep order by valor_min limit 1;
 atual:=case f.base_calculo when 'bruto' then p.total_itens when 'liquido' then p.total_liquido else greatest(p.total_itens-p.desconto_valor,0) end;
 ini:=case when f.periodo='semanal' then date_trunc('week',p.data_pedido)::date else date_trunc('month',p.data_pedido)::date end;
 fim:=case when f.periodo='semanal' then ini+7 else (ini+interval '1 month')::date end;
 if f.periodo='pedido' then anterior:=0;
 elsif f.periodo='recebimento' then
  select coalesce(sum(m.valor),0) into anterior from public.movimentos_financeiros m join public.contas_receber t on t.id=m.conta_receber_id join public.pedidos q on q.id=t.pedido_id
  where q.representante_id=p.representante_id and q.id<>p.id and m.tipo='entrada' and m.status='ativo' and m.data>=ini and m.data<fim;
 else
  select coalesce(sum(case f.base_calculo when 'bruto' then q.total_itens when 'liquido' then q.total_liquido else greatest(q.total_itens-q.desconto_valor,0) end),0) into anterior from public.pedidos q
  where q.representante_id=p.representante_id and q.id<>p.id and q.status not in ('rascunho','digitacao','aguardando_aprovacao','aprovado','cancelado','recusado')
  and (case when f.periodo='faturamento' then (q.faturado_em at time zone 'America/Sao_Paulo')::date else q.data_pedido end)>=ini
  and (case when f.periodo='faturamento' then (q.faturado_em at time zone 'America/Sao_Paulo')::date else q.data_pedido end)<fim;
 end if;
 base:=anterior+coalesce(atual,0);
 if not f.progressiva then
  select percentual into valor from public.comissao_faixas where ativo and representante_id is not distinct from rep and base>=valor_min and (valor_max is null or base<=valor_max) order by valor_min desc limit 1;
  return valor;
 end if;
 if atual<=0 then return 0; end if;
 for r in select * from public.comissao_faixas where ativo and representante_id is not distinct from rep order by valor_min loop
  valor:=valor+greatest(least(base,coalesce(r.valor_max,base))-greatest(anterior,r.valor_min),0)*r.percentual/100;
 end loop;
 return round(valor/atual*100,4);
end $$;

create or replace function public.calcular_comissao_itens_215(_pedido uuid)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare p public.pedidos; i record; regra numeric; faixa numeric; total numeric:=0; base numeric; pct numeric;
begin
 select * into p from public.pedidos where id=_pedido;
 if p.representante_id is null then return 0; end if;
 faixa:=public.percentual_faixa_215(p.id);
 for i in select it.*,pr.comissao_fixa_unidade,pr.comissao_percentual as pct_produto from public.pedido_itens it join public.produtos pr on pr.id=it.produto_id where it.pedido_id=p.id loop
  if i.comissao_fixa_unidade is not null then total:=total+i.quantidade*i.comissao_fixa_unidade;
  else
   select r.percentual into regra from public.regras_comissao r join public.clientes c on c.id=p.cliente_id where r.ativo
   and (r.representante_id is null or r.representante_id=p.representante_id) and (r.cliente_id is null or r.cliente_id=p.cliente_id)
   and (r.produto_id is null or r.produto_id=i.produto_id) and (r.uf is null or r.uf=c.uf)
   and (r.vigencia_inicio is null or r.vigencia_inicio<=p.data_pedido) and (r.vigencia_fim is null or r.vigencia_fim>=p.data_pedido)
   order by r.prioridade desc,(r.produto_id is not null) desc,(r.cliente_id is not null) desc,(r.representante_id is not null) desc,r.created_at desc limit 1;
   pct:=coalesce(nullif(i.pct_produto,0),regra,faixa,(select comissao_percentual from public.representantes where id=p.representante_id),0);
   base:=case when p.total_itens>0 then i.total*greatest(p.total_itens-p.desconto_valor,0)/p.total_itens else 0 end;
   total:=total+base*pct/100;
  end if;
 end loop;
 return round(total,2);
end $$;
-- Preserva guardas atuais e troca apenas o cálculo da comissão do pedido.
do $$ declare d text; begin
 select pg_get_functiondef('public.recalcular_pedido(uuid)'::regprocedure) into d;
 if position('calcular_comissao_itens_215' in d)=0 then
  -- O percentual provisório preserva a comissão anterior até calcular itens com totais atualizados.
  -- Não consulta o antigo resolver por notas fiscais durante o recálculo.
  d:=replace(d,'pct := public.resolver_comissao(ped.representante_id, ped.cliente_id, ped.data_pedido, null, base);','pct := coalesce(ped.comissao_percentual,0);');
  d:=replace(d,'perform public.apurar_comissao_pedido(_pedido_id);','update public.pedidos set comissao_valor=public.calcular_comissao_itens_215(_pedido_id), comissao_percentual=case when base>0 then least(999.99,round(public.calcular_comissao_itens_215(_pedido_id)/base*100,2)) else 0 end where id=_pedido_id; perform public.apurar_comissao_pedido(_pedido_id);');
  if position('calcular_comissao_itens_215' in d)=0 then raise exception 'Recalcular pedido incompatível; comissão não foi alterada'; end if;
  execute d;
 end if;
end $$;
-- Não reescreve comissões históricas. Novos pedidos/cálculos passam a usar as regras.
create or replace function public.margem_inadequada_215(_pedido uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.pedidos p join lateral (
  select sum(i.quantidade*coalesce(i.custo_unitario_base,nullif(pr.custo_medio,0),nullif(pr.preco_custo,0),nullif(pr.ultimo_custo,0),0)) custo,
  bool_or(coalesce(i.custo_unitario_base,nullif(pr.custo_medio,0),nullif(pr.preco_custo,0),nullif(pr.ultimo_custo,0),0)<=0) sem_custo
  from public.pedido_itens i join public.produtos pr on pr.id=i.produto_id where i.pedido_id=p.id
 ) x on true where p.id=_pedido and (
  coalesce(x.sem_custo,true) or p.total_liquido<=0 or
  (p.total_liquido-coalesce(x.custo,0)-p.comissao_valor-p.custo_frete-p.tributos_estimados-p.despesas_variaveis)/nullif(p.total_liquido,0)*100<coalesce((select nullif(valor,'')::numeric from public.parametros where chave='margem_liquida_minima'),0)
 ));
$$;
revoke all on function public.margem_inadequada_215(uuid) from public,anon,authenticated;
-- Validação não depende da permissão de visualizar margem; custos continuam privados.
do $bloco$
declare d text; antigo text := $trecho$if exists(select 1 from public.vw_margem_pedido_209 m where m.pedido_id=_pedido_id and (m.sem_custo>0 or m.margem<coalesce((select nullif(valor,'')::numeric from public.parametros where chave='margem_liquida_minima'),0))) then$trecho$;
begin
 select pg_get_functiondef('public.validar_pedido(uuid)'::regprocedure) into d;
 if position('margem_inadequada_215' in d)=0 then
  if position(antigo in d)=0 then raise exception 'Validação de margem incompatível com fase215'; end if;
  d:=replace(d,antigo,'if public.margem_inadequada_215(_pedido_id) then');execute d;
 end if;
end $bloco$;

insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values('rentabilidade_editar','Informar tributos estimados e despesas variáveis','Pedidos',124,'/pedidos') on conflict do nothing;
create or replace function public.definir_rentabilidade_215(_pedido uuid,_tributos numeric,_despesas numeric)
returns void language plpgsql security definer set search_path=public as $$
declare p public.pedidos;
begin
 select * into p from public.pedidos where id=_pedido for update;
 if not public.pode_rotina('rentabilidade_editar') or not public.can_manage(auth.uid()) or not public.usuario_pode_acessar_centro(p.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',p.id)) then raise exception 'Sem acesso à rentabilidade'; end if;
 if p.status not in ('rascunho','digitacao','aguardando_aprovacao','aprovado') or _tributos is null or _despesas is null or _tributos<0 or _despesas<0 or _tributos::text in ('NaN','Infinity','-Infinity') or _despesas::text in ('NaN','Infinity','-Infinity') then raise exception 'Valores inválidos ou pedido já confirmado'; end if;
 update public.pedidos set tributos_estimados=_tributos,despesas_variaveis=_despesas where id=p.id;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',p.id,'rentabilidade',auth.uid(),jsonb_build_object('antes',jsonb_build_object('tributos',p.tributos_estimados,'despesas',p.despesas_variaveis),'depois',jsonb_build_object('tributos',_tributos,'despesas',_despesas)));
end $$;
create or replace view public.vw_resultado_estimado_215 with(security_invoker=on) as
select m.*,p.tributos_estimados,p.despesas_variaveis,m.resultado-p.tributos_estimados-p.despesas_variaveis resultado_estimado from public.vw_margem_pedido_209 m join public.pedidos p on p.id=m.pedido_id;
grant select on public.vw_resultado_estimado_215 to authenticated;
revoke all on function public.marcar_faturamento_215(),public.percentual_faixa_215(uuid),public.calcular_comissao_itens_215(uuid) from public,anon,authenticated;
revoke all on function public.definir_rentabilidade_215(uuid,numeric,numeric) from public,anon;
grant execute on function public.definir_rentabilidade_215(uuid,numeric,numeric) to authenticated;
notify pgrst,'reload schema';

-- Fonte: fase216_renegociacao.sql
-- Fase216: acordo gera novas parcelas, preservando baixas e origem.

create table if not exists public.renegociacoes (
 id uuid primary key default gen_random_uuid(),cliente_id uuid not null references public.clientes(id),centro_id uuid not null references public.centros(id),
 motivo text not null,valor_original numeric(14,2) not null,valor_acordo numeric(14,2) not null,
 dados jsonb not null, chave uuid not null unique,created_by uuid not null default auth.uid(),created_at timestamptz not null default now()
);
create table if not exists public.renegociacao_origens (
 acordo_id uuid not null references public.renegociacoes(id),titulo_id uuid not null references public.contas_receber(id),
 saldo_original numeric(14,2) not null,primary key(acordo_id,titulo_id),unique(titulo_id)
);
alter table public.contas_receber add column if not exists acordo_id uuid references public.renegociacoes(id);
create index if not exists titulo_acordo_216 on public.contas_receber(acordo_id) where acordo_id is not null;
insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values('receber_renegociar','Renegociar títulos e gerar parcelas de acordo','Cobrança',125,'/receber') on conflict do nothing;
do $$ begin
 if not exists(select 1 from public.auditoria where tabela='fase216' and acao='instalada') then
  insert into public.role_permissoes(role,permissao) select codigo,'receber_renegociar' from public.papeis where codigo='financeiro' on conflict do nothing;
  insert into public.auditoria(tabela,acao,detalhe) values('fase216','instalada','{}');
 end if;
end $$;
alter table public.renegociacoes enable row level security;
alter table public.renegociacao_origens enable row level security;
revoke all on public.renegociacoes,public.renegociacao_origens from public,anon,authenticated;
grant select on public.renegociacoes,public.renegociacao_origens to authenticated;
drop policy if exists acordo_leitura_216 on public.renegociacoes;
create policy acordo_leitura_216 on public.renegociacoes for select to authenticated using(public.usuario_ativo() and public.usuario_pode_acessar_centro(centro_id) and (not public.escopo_representante() or public.cliente_na_minha_carteira(cliente_id)));
drop policy if exists acordo_origem_leitura_216 on public.renegociacao_origens;
create policy acordo_origem_leitura_216 on public.renegociacao_origens for select to authenticated using(exists(select 1 from public.renegociacoes where id=acordo_id));
create or replace function public.renegociar_titulo_216(_titulo uuid,_parcelas int,_primeiro date,_intervalo int,_acrescimo numeric,_desconto numeric,_motivo text,_chave uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare t public.contas_receber; saldo numeric; total numeric; valor numeric; restante numeric; acordo uuid; n int; payload jsonb;
begin
 if not public.pode_rotina('receber_renegociar') or not public.can_finance(auth.uid()) then raise exception 'Sem permissão para renegociar'; end if;
 select * into t from public.contas_receber where id=_titulo for update;
 if t.id is null or not public.usuario_pode_acessar_centro(t.centro_id) or (public.escopo_representante() and not public.cliente_na_minha_carteira(t.cliente_id)) then raise exception 'Título sem acesso'; end if;
 if _chave is null or _parcelas is null or _parcelas not between 1 and 24 or _primeiro is null or _primeiro<current_date or _intervalo is null or _intervalo not between 1 and 90 or _acrescimo is null or _desconto is null or _acrescimo<0 or _desconto<0 or _acrescimo::text in ('NaN','Infinity','-Infinity') or _desconto::text in ('NaN','Infinity','-Infinity') or nullif(trim(_motivo),'') is null or length(_motivo)>2000 then raise exception 'Dados do acordo inválidos'; end if;
 payload:=jsonb_build_object('titulo',_titulo,'parcelas',_parcelas,'primeiro',_primeiro,'intervalo',_intervalo,'acrescimo',_acrescimo,'desconto',_desconto,'motivo',trim(_motivo));
 select id into acordo from public.renegociacoes where chave=_chave;
 if acordo is not null then
  if not exists(select 1 from public.renegociacoes where id=acordo and dados=payload) then raise exception 'Chave já usada com condições diferentes'; end if;
  if not exists(select 1 from public.renegociacao_origens where acordo_id=acordo and titulo_id=t.id) then raise exception 'Chave pertence a outro acordo'; end if;
  return acordo;
 end if;
 if t.status in ('pago','cancelado') or exists(select 1 from public.renegociacao_origens where titulo_id=t.id) then raise exception 'Título já encerrado ou renegociado'; end if;
 if exists(select 1 from public.boletos where conta_receber_id=t.id and coalesce(status,'') not in ('cancelado','baixado','liquidado','pago')) then raise exception 'Confirme a baixa/cancelamento do boleto no banco antes de renegociar'; end if;
 saldo:=round(t.valor+coalesce(t.juros,0)+coalesce(t.multa,0)+coalesce(t.acrescimo,0)-coalesce(t.desconto,0)-coalesce(t.valor_pago,0),2);
 total:=saldo+_acrescimo-_desconto;
 if saldo<=0 or total<=0 or total<_parcelas*0.01 then raise exception 'Saldo ou valor de acordo inválido'; end if;
 insert into public.renegociacoes(cliente_id,centro_id,motivo,valor_original,valor_acordo,dados,chave) values(t.cliente_id,t.centro_id,trim(_motivo),saldo,total,payload,_chave) returning id into acordo;
 insert into public.renegociacao_origens(acordo_id,titulo_id,saldo_original) values(acordo,t.id,saldo);
 update public.contas_receber set status='cancelado' where id=t.id;
 restante:=total;
 for n in 1.._parcelas loop
  valor:=case when n=_parcelas then restante else round(total/_parcelas,2) end;
  insert into public.contas_receber(cliente_id,pedido_id,centro_id,documento,parcela,data_emissao,vencimento,valor,status,acordo_id,descricao)
  values(t.cliente_id,t.pedido_id,t.centro_id,'AC-'||left(acordo::text,8),n,current_date,_primeiro+(n-1)*_intervalo,valor,'aberto',acordo,'Acordo: '||trim(_motivo));
  restante:=restante-valor;
 end loop;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('contas_receber',t.id,'renegociar',auth.uid(),jsonb_build_object('acordo',acordo,'saldo',saldo,'valor_pago_preservado',t.valor_pago,'novo_total',total,'parcelas',_parcelas));
 return acordo;
end $$;
-- Baixas anteriores de títulos renegociados contam na quitação do pedido.
do $$ declare d text; begin
 select pg_get_functiondef('public.apurar_comissao_pedido(uuid)'::regprocedure) into d;
 if position('renegociacao_origens' in d)=0 then
  d:=replace(d,'t.status<>''cancelado''','(t.status<>''cancelado'' or exists(select 1 from public.renegociacao_origens ro where ro.titulo_id=t.id))');execute d;
 end if;
 select pg_get_functiondef('public.regra_comissao_209()'::regprocedure) into d;
 if position('renegociacao_origens' in d)=0 then
  d:=replace(d,'t.status<>''cancelado''','(t.status<>''cancelado'' or exists(select 1 from public.renegociacao_origens ro where ro.titulo_id=t.id))');execute d;
 end if;
end $$;
revoke all on function public.renegociar_titulo_216(uuid,int,date,int,numeric,numeric,text,uuid) from public,anon;
grant execute on function public.renegociar_titulo_216(uuid,int,date,int,numeric,numeric,text,uuid) to authenticated;
notify pgrst,'reload schema';

-- Fonte: fase217_comissao_proporcional.sql
-- Fase217: agendamento proporcional ao recebimento, com títulos a pagar rastreáveis.

create table if not exists public.comissao_parcelas (
 id uuid primary key default gen_random_uuid(),comissao_id uuid not null references public.comissoes(id),
 conta_pagar_id uuid not null references public.contas_pagar(id),valor numeric(14,2) not null check(valor>0),
 chave uuid not null unique,created_by uuid not null default auth.uid(),created_at timestamptz not null default now()
);
create index if not exists comissao_parcela_comissao_217 on public.comissao_parcelas(comissao_id);
alter table public.comissao_parcelas enable row level security;
revoke all on public.comissao_parcelas from public,anon,authenticated;
grant select on public.comissao_parcelas to authenticated;
drop policy if exists comissao_parcela_leitura_217 on public.comissao_parcelas;
create policy comissao_parcela_leitura_217 on public.comissao_parcelas for select to authenticated using(exists(select 1 from public.comissoes c where c.id=comissao_id));
insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values('comissao_proporcional_operar','Agendar e estornar comissão proporcional ao recebimento','Comissões',126,'/comissoes') on conflict do nothing;
do $$ begin
 if not exists(select 1 from public.auditoria where tabela='fase217' and acao='instalada') then
  insert into public.role_permissoes(role,permissao) select codigo,'comissao_proporcional_operar' from public.papeis where codigo='financeiro' on conflict do nothing;
  insert into public.auditoria(tabela,acao,detalhe) values('fase217','instalada','{}');
 end if;
end $$;
create or replace function public.comissao_disponivel_217(_comissao uuid)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare c public.comissoes; p public.pedidos; recebido numeric; comprometido numeric;
begin
 select * into c from public.comissoes where id=_comissao;
 select * into p from public.pedidos where id=c.pedido_id;
 if not public.pode_rotina('comissao_ajustes_ver') or not public.usuario_pode_acessar_centro(p.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',p.id)) then return 0; end if;
 if c.status in ('paga','cancelada') or p.status not in ('faturado','em_carga','em_rota','entregue','parcial','nao_entregue','devolvido') or p.total_liquido<=0 then return 0; end if;
 select coalesce(sum(least(t.valor,coalesce(t.valor_pago,0))),0) into recebido from public.contas_receber t where t.pedido_id=p.id and (t.status<>'cancelado' or exists(select 1 from public.renegociacao_origens where titulo_id=t.id));
 recebido:=recebido+coalesce((select sum(valor) from public.creditos_clientes_aplicacoes where pedido_id=p.id and status='aplicado'),0);
 select coalesce(sum(cp.valor),0) into comprometido from public.comissao_parcelas cp join public.contas_pagar t on t.id=cp.conta_pagar_id where cp.comissao_id=c.id and t.status<>'cancelado';
 return greatest(round(c.valor*least(recebido/p.total_liquido,1),2)-comprometido,0);
end $$;
create or replace view public.vw_comissao_proporcional_217 with(security_invoker=on) as
select c.id,c.pedido_id,c.representante_id,c.centro_id,c.valor,c.status,p.numero pedido_numero,
 public.comissao_disponivel_217(c.id) disponivel,
 coalesce((select sum(cp.valor) from public.comissao_parcelas cp join public.contas_pagar t on t.id=cp.conta_pagar_id where cp.comissao_id=c.id and t.status<>'cancelado'),0) agendado
from public.comissoes c join public.pedidos p on p.id=c.pedido_id
where public.pode_rotina('comissao_ajustes_ver');
grant select on public.vw_comissao_proporcional_217 to authenticated;
create or replace function public.agendar_comissao_217(_comissao uuid,_valor numeric,_vencimento date,_chave uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare c public.comissoes; conta uuid; parcela uuid; limite numeric;
begin
 if not public.pode_rotina('comissao_proporcional_operar') or not public.can_finance(auth.uid()) then raise exception 'Sem acesso à comissão proporcional'; end if;
 select * into c from public.comissoes where id=_comissao for update;
 if c.id is null or not public.usuario_pode_acessar_centro(c.centro_id) or (public.escopo_representante() and c.representante_id is distinct from public.meu_representante_id()) then raise exception 'Comissão sem acesso'; end if;
 if _valor is null or _valor<=0 or _valor::text in ('NaN','Infinity','-Infinity') or _vencimento is null or _chave is null then raise exception 'Valor, vencimento e chave obrigatórios'; end if;
 select cp.id into parcela from public.comissao_parcelas cp join public.contas_pagar t on t.id=cp.conta_pagar_id where cp.chave=_chave and cp.comissao_id=c.id and cp.valor=round(_valor,2) and t.vencimento=_vencimento;
 if parcela is not null then return parcela; end if;
 if exists(select 1 from public.comissao_parcelas where chave=_chave) then raise exception 'Chave já usada com dados diferentes'; end if;
 limite:=public.comissao_disponivel_217(c.id);
 if round(_valor,2)>limite then raise exception 'Valor excede comissão disponível após recebimentos (%).',limite; end if;
 insert into public.contas_pagar(centro_id,documento,parcela,valor,vencimento,data_emissao,status,descricao)
 values(c.centro_id,'CP-'||left(_chave::text,8),1,round(_valor,2),_vencimento,current_date,'aberto','Comissão proporcional do pedido '||c.pedido_id) returning id into conta;
 insert into public.comissao_parcelas(comissao_id,conta_pagar_id,valor,chave) values(c.id,conta,round(_valor,2),_chave) returning id into parcela;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('comissoes',c.id,'agendar_proporcional',auth.uid(),jsonb_build_object('conta_pagar',conta,'valor',_valor));
 return parcela;
end $$;
create or replace function public.estornar_comissao_217(_parcela uuid,_motivo text)
returns void language plpgsql security definer set search_path=public as $$
declare cp public.comissao_parcelas; c public.comissoes; t public.contas_pagar;
begin
 select * into cp from public.comissao_parcelas where id=_parcela;
 select * into c from public.comissoes where id=cp.comissao_id for update;
 if not public.pode_rotina('comissao_proporcional_operar') or not public.can_finance(auth.uid()) or not public.usuario_pode_acessar_centro(c.centro_id) or (public.escopo_representante() and c.representante_id is distinct from public.meu_representante_id()) then raise exception 'Sem acesso ao estorno'; end if;
 select * into t from public.contas_pagar where id=cp.conta_pagar_id for update;
 if t.id is null or nullif(trim(_motivo),'') is null or length(_motivo)>2000 then raise exception 'Parcela ou motivo inválido'; end if;
 if coalesce(t.valor_pago,0)>0 then raise exception 'Estorne a baixa financeira antes de cancelar o agendamento'; end if;
 update public.contas_pagar set status='cancelado' where id=t.id;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('comissao_parcelas',cp.id,'estornar',auth.uid(),jsonb_build_object('motivo',_motivo));
end $$;
-- Quem já iniciou pagamento proporcional não pode pagar novamente o valor integral.
do $$ declare d text; begin
 select pg_get_functiondef('public.pagar_comissoes(uuid,uuid[],date,uuid,uuid,uuid,text)'::regprocedure) into d;
 if position('proporcional_217' in d)=0 then
  d:=regexp_replace(d,'\mBEGIN\M',E'BEGIN\n -- proporcional_217\n if not public.usuario_ativo() or not public.can_finance(auth.uid()) then raise exception ''Sem acesso a comissões''; end if;\n perform 1 from public.comissoes where id=any(_comissao_ids) order by id for update;\n if exists(select 1 from public.comissao_parcelas cp join public.contas_pagar t on t.id=cp.conta_pagar_id where cp.comissao_id=any(_comissao_ids) and t.status<>''cancelado'') then raise exception ''Use pagamento proporcional para comissões com parcelas já agendadas''; end if;','i');execute d;
 end if;
end $$;
create or replace function public.ajuste_parcial_devolucao_217()
returns trigger language plpgsql security definer set search_path=public as $$
declare c public.comissoes; pago numeric;
begin
 if new.status in ('confirmada','cancelada') and old.status is distinct from new.status then
  select * into c from public.comissoes where pedido_id=new.pedido_id;
  select coalesce(sum(cp.valor),0) into pago from public.comissao_parcelas cp join public.contas_pagar t on t.id=cp.conta_pagar_id where cp.comissao_id=c.id and t.status<>'cancelado';
  if pago>c.valor then
   insert into public.comissao_ajustes(comissao_id,pedido_id,representante_id,centro_id,valor) values(c.id,c.pedido_id,c.representante_id,c.centro_id,pago-c.valor)
   on conflict(comissao_id) do update set valor=excluded.valor,status='pendente',resolucao=null;
  end if;
 end if;
 return new;
end $$;
drop trigger if exists z_ajuste_parcial_217 on public.devolucoes;
create trigger z_ajuste_parcial_217 after update of status on public.devolucoes for each row execute function public.ajuste_parcial_devolucao_217();
revoke all on function public.ajuste_parcial_devolucao_217() from public,anon,authenticated;
revoke all on function public.comissao_disponivel_217(uuid),public.agendar_comissao_217(uuid,numeric,date,uuid),public.estornar_comissao_217(uuid,text) from public,anon;
grant execute on function public.comissao_disponivel_217(uuid),public.agendar_comissao_217(uuid,numeric,date,uuid),public.estornar_comissao_217(uuid,text) to authenticated;
notify pgrst,'reload schema';

-- Fonte: fase218_compras_xml.sql
-- Fase218: importação conferida de XML de compra; não emite documento fiscal.

insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values('compra_xml_importar','Importar XML conferido de compra','Compras',127,'/compras') on conflict do nothing;
do $$ begin
 if not exists(select 1 from public.auditoria where tabela='fase218' and acao='instalada') then
  insert into public.role_permissoes(role,permissao) select codigo,'compra_xml_importar' from public.papeis where codigo in ('estoque','financeiro') on conflict do nothing;
  insert into public.auditoria(tabela,acao,detalhe) values('fase218','instalada','{}');
 end if;
end $$;
create or replace function public.importar_compra_xml_218(_fornecedor uuid,_centro uuid,_dados jsonb,_itens jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare c public.compras; r record; chave text; soma numeric;
begin
 if not public.pode_rotina('compra_xml_importar') or not (public.can_stock(auth.uid()) or public.can_finance(auth.uid())) or not public.usuario_pode_acessar_centro(_centro) then raise exception 'Sem acesso à importação de compras'; end if;
 chave:=_dados->>'chave';
 if chave is null or chave!~'^[0-9]{44}$' or _itens is null or jsonb_typeof(_itens)<>'array' or jsonb_array_length(_itens) not between 1 and 500 or (_dados->>'conferido') is distinct from 'true' then raise exception 'Confira fornecedor, produtos e unidades antes de importar'; end if;
 if not exists(select 1 from public.fornecedores where id=_fornecedor and regexp_replace(coalesce(cnpj_cpf,''),'[^0-9A-Za-z]','','g')=regexp_replace(coalesce(_dados->>'documento_emitente',''),'[^0-9A-Za-z]','','g')) then raise exception 'Documento do fornecedor não corresponde ao XML'; end if;
 perform pg_advisory_xact_lock(hashtextextended('compra_xml:'||chave,0));
 select * into c from public.compras where chave_acesso=chave;
 if c.id is not null then
  if c.centro_id<>_centro or c.fornecedor_id<>_fornecedor then raise exception 'XML já usado em outro centro/fornecedor'; end if;
  return c.id;
 end if;
 if coalesce((_dados->>'frete')::numeric,-1)<0 or coalesce((_dados->>'desconto')::numeric,-1)<0 or coalesce((_dados->>'total')::numeric,-1)<=0 or (_dados->>'frete')::numeric::text in ('NaN','Infinity','-Infinity') or (_dados->>'desconto')::numeric::text in ('NaN','Infinity','-Infinity') or (_dados->>'total')::numeric::text in ('NaN','Infinity','-Infinity') then raise exception 'Totais inválidos'; end if;
 select * into c from public.criar_compra_rascunho(_fornecedor,_centro,(_dados->>'data')::date,'Importação XML conferida',_dados->>'numero',chave,0);
 for r in select * from jsonb_to_recordset(_itens) x(produto_id uuid,quantidade numeric,custo_unitario numeric) loop
  if r.produto_id is null or r.quantidade is null or r.quantidade<=0 or r.custo_unitario is null or r.custo_unitario<0 or r.quantidade::text in ('NaN','Infinity','-Infinity') or r.custo_unitario::text in ('NaN','Infinity','-Infinity') then raise exception 'Item inválido'; end if;
  perform public.adicionar_item_compra(c.id,r.produto_id,r.quantidade,r.custo_unitario,null,null);
 end loop;
 perform public.atualizar_compra_comercial(c.id,null,(_dados->>'frete')::numeric,(_dados->>'desconto')::numeric);
 select total_liquido into soma from public.compras where id=c.id;
 if abs(soma-(_dados->>'total')::numeric)>0.02 then raise exception 'Total importado (%) difere do XML (%); confira conversões e custos',soma,_dados->>'total'; end if;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('compras',c.id,'importar_xml',auth.uid(),jsonb_build_object('chave',chave,'total',soma,'itens',jsonb_array_length(_itens)));
 return c.id;
end $$;
-- O custo de aquisição inclui frete e desconto proporcionais na entrada, sem
-- alterar os preços do documento nem reprocessar compras históricas.
do $$ declare d text; begin
 select pg_get_functiondef('public.receber_compra(uuid)'::regprocedure) into d;
 if position('aquisicao_218' in d)=0 then
  d:=replace(d,'item.qtd, item.custo,','item.qtd, item.custo * case when cmp.total_itens>0 then cmp.total_liquido/cmp.total_itens else 1 end, -- aquisicao_218'||chr(10));
  if position('aquisicao_218' in d)=0 then raise exception 'Recebimento de compra incompatível para custo de aquisição'; end if;
  execute d;
 end if;
end $$;
revoke all on function public.importar_compra_xml_218(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.importar_compra_xml_218(uuid,uuid,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';

-- Fonte: fase219_pix_por_chave.sql
-- Fase219: Pix por chave, sem boleto híbrido ou confirmação bancária automática.

alter table public.contas_financeiras add column if not exists chave_pix text;
alter table public.contas_financeiras add column if not exists pix_beneficiario text;
alter table public.contas_financeiras add column if not exists pix_cidade text;
insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values('pix_gerar','Gerar Pix por chave para título sem boleto ativo','Pix',128,'/receber') on conflict do nothing;
do $$ begin
 if not exists(select 1 from public.auditoria where tabela='fase219' and acao='instalada') then
  insert into public.role_permissoes(role,permissao) select codigo,'pix_gerar' from public.papeis where codigo='financeiro' on conflict do nothing;
  insert into public.auditoria(tabela,acao,detalhe) values('fase219','instalada','{}');
 end if;
end $$;
create or replace function public.dados_pix_219(_titulo uuid,_conta uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.contas_receber; c public.contas_financeiras; saldo numeric;
begin
 if not public.pode_rotina('pix_gerar') or not public.can_finance(auth.uid()) then raise exception 'Sem acesso ao Pix'; end if;
 select * into t from public.contas_receber where id=_titulo;
 select * into c from public.contas_financeiras where id=_conta;
 if t.id is null or not public.usuario_pode_acessar_centro(t.centro_id) or (public.escopo_representante() and not public.cliente_na_minha_carteira(t.cliente_id)) or c.id is null or not public.usuario_pode_acessar_conta_financeira(c.id) or (c.centro_id is not null and c.centro_id<>t.centro_id) then raise exception 'Título ou conta sem acesso'; end if;
 if not c.ativo or (coalesce(c.banco_codigo,'')<>'748' and coalesce(c.banco,'') not ilike '%sicredi%') then raise exception 'Selecione conta Sicredi ativa'; end if;
 if nullif(trim(c.chave_pix),'') is null or nullif(trim(c.pix_beneficiario),'') is null or nullif(trim(c.pix_cidade),'') is null then raise exception 'Configure chave, beneficiário e cidade em Caixa e bancos'; end if;
 if exists(select 1 from public.boletos where conta_receber_id=t.id and coalesce(status,'') not in ('cancelado','baixado','liquidado','pago')) then raise exception 'Confirme baixa/cancelamento do boleto antes de gerar Pix independente'; end if;
 saldo:=round(t.valor+coalesce(t.juros,0)+coalesce(t.multa,0)+coalesce(t.acrescimo,0)-coalesce(t.desconto,0)-coalesce(t.valor_pago,0),2);
 if t.status in ('pago','cancelado') or saldo<=0 then raise exception 'Título sem saldo para Pix'; end if;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('contas_receber',t.id,'gerar_pix_chave',auth.uid(),jsonb_build_object('conta',c.id,'valor',saldo));
 return jsonb_build_object('chave',c.chave_pix,'beneficiario',c.pix_beneficiario,'cidade',c.pix_cidade,'valor',saldo,'txid',left(replace(t.id::text,'-',''),25));
end $$;
revoke all on function public.dados_pix_219(uuid,uuid) from public,anon;
grant execute on function public.dados_pix_219(uuid,uuid) to authenticated;
notify pgrst,'reload schema';

-- Fonte: fase220_indicadores_auditoria.sql
-- Fase220: comparativo por centro agregado no banco e auditoria ampliada sem segredos.

insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values('indicadores_comparar','Consultar comparativo de períodos e centros','Relatórios',129,'/relatorios') on conflict do nothing;
create or replace function public.comparativo_centros_220(_inicio date,_fim date)
returns table(centro_id uuid,centro text,periodo text,pedidos bigint,vendas numeric,contribuicao numeric,resultado_estimado numeric)
language plpgsql stable security invoker set search_path=public as $$
declare dias int;
begin
 if not public.pode_rotina('indicadores_comparar') or not public.can_manage(auth.uid()) then raise exception 'Comparativo restrito à gestão'; end if;
 if _inicio is null or _fim is null or _fim<_inicio or _fim-_inicio>366 then raise exception 'Selecione intervalo de até 367 dias'; end if;
 dias:=_fim-_inicio+1;
 return query
 select p.centro_id,c.nome,case when p.data_pedido>=_inicio then 'atual'::text else 'anterior'::text end,
 count(*),sum(p.total_liquido),sum(m.resultado),sum(m.resultado-p.tributos_estimados-p.despesas_variaveis)
 from public.pedidos p join public.centros c on c.id=p.centro_id join public.vw_margem_pedido_209 m on m.pedido_id=p.id
 where p.data_pedido>=_inicio-dias and p.data_pedido<=_fim and p.status in ('confirmado','separacao','separado','conferido','faturado','em_carga','em_rota','entregue','parcial','nao_entregue','devolvido')
 group by p.centro_id,c.nome,case when p.data_pedido>=_inicio then 'atual'::text else 'anterior'::text end;
end $$;
revoke all on function public.comparativo_centros_220(date,date) from public,anon;
grant execute on function public.comparativo_centros_220(date,date) to authenticated;
-- Lista explícita de tabelas de negócio. Campos secretos e grandes payloads não entram.
do $$ declare t text; campos text; begin
 foreach t in array array['pedidos','pedido_itens','produtos','clientes','pessoas','compras','compra_itens','contas_receber','contas_pagar','devolucoes','devolucao_itens','cargas','expedicoes','comissoes','regras_comissao','comissao_faixas','depositos','inventarios','profiles'] loop
  if to_regclass('public.'||t) is not null then
   select string_agg(quote_literal(attname),',' order by attnum) into campos from pg_attribute
   where attrelid=to_regclass('public.'||t) and attnum>0 and not attisdropped
   and attname !~* '(senha|password|token|secret|api|certificado|private|chave|qrcode|created_at|updated_at)';
   execute format('drop trigger if exists auditar_campos_209 on public.%I',t);
   execute format('create trigger auditar_campos_209 after insert or update or delete on public.%I for each row execute function public.auditar_campos_209(%s)',t,campos);
  end if;
 end loop;
end $$;
-- Acessos autenticados são auditados pelo servidor, uma vez por sessão (sem JWT).
create table if not exists public.acessos_sessoes (
 user_id uuid not null references public.profiles(id),sessao uuid not null,created_at timestamptz not null default now(),primary key(user_id,sessao)
);
alter table public.acessos_sessoes enable row level security;
revoke all on public.acessos_sessoes from public,anon,authenticated;
grant select on public.acessos_sessoes to authenticated;
drop policy if exists acessos_gestao_220 on public.acessos_sessoes;
create policy acessos_gestao_220 on public.acessos_sessoes for select to authenticated using(public.usuario_ativo() and public.can_manage(auth.uid()));
create or replace function public.registrar_acesso_220(_sessao uuid)
returns void language plpgsql security definer set search_path=public as $$
declare n int;
begin
 if not public.usuario_ativo() or _sessao is null or _sessao::text is distinct from (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id') then raise exception 'Sessão inválida'; end if;
 insert into public.acessos_sessoes(user_id,sessao) values(auth.uid(),_sessao) on conflict do nothing;
 get diagnostics n=row_count;
 if n=1 then insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('profiles',auth.uid(),'acesso_sessao',auth.uid(),jsonb_build_object('sessao',_sessao)); end if;
end $$;
revoke all on function public.registrar_acesso_220(uuid) from public,anon;
grant execute on function public.registrar_acesso_220(uuid) to authenticated;
-- Diagnóstico de integridade consultivo; não corrige dados automaticamente.
insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values('integridade_ver','Consultar diagnóstico de integridade','Configurações',130,'/configuracoes') on conflict do nothing;
create or replace function public.diagnostico_integridade_220()
returns table(verificacao text,pendencias bigint)
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.pode_rotina('integridade_ver') or not public.can_manage(auth.uid()) then raise exception 'Diagnóstico restrito à gestão'; end if;
 return query
 select 'Saldos negativos'::text,count(*) from public.estoque_saldos s where public.usuario_pode_acessar_centro(s.centro_id) and s.quantidade<0
 union all
 select 'Reservas acima do estoque'::text,count(*) from public.estoque_saldos s where public.usuario_pode_acessar_centro(s.centro_id) and s.quantidade<coalesce((select sum(r.quantidade) from public.estoque_reservas r where r.produto_id=s.produto_id and r.centro_id=s.centro_id),0)
 union all
 select 'Saldo do centro diferente dos depósitos'::text,count(*) from public.estoque_saldos s where public.usuario_pode_acessar_centro(s.centro_id) and s.quantidade<>coalesce((select sum(ds.quantidade) from public.deposito_saldos ds join public.depositos d on d.id=ds.deposito_id where d.centro_id=s.centro_id and ds.produto_id=s.produto_id),0)
 union all
 select 'Contagens abertas'::text,count(*) from public.inventarios i join public.depositos d on d.id=i.deposito_id where i.status='contagem' and public.usuario_pode_acessar_centro(d.centro_id)
 union all
 select 'Recusas aguardando retorno conferido'::text,count(distinct d.id) from public.devolucoes d join public.entrega_itens t on t.devolucao_id=d.id where d.status is distinct from 'confirmada' and public.usuario_pode_acessar_centro(d.centro_id) and (not public.escopo_representante() or public.documento_na_minha_carteira('devolucoes',d.id));
end $$;
revoke all on function public.diagnostico_integridade_220() from public,anon;
grant execute on function public.diagnostico_integridade_220() to authenticated;
notify pgrst,'reload schema';

commit;
