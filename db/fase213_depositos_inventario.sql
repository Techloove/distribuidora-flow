-- Fase213: depósitos, endereços, transferências internas e inventário conferido.
begin;
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
commit;
