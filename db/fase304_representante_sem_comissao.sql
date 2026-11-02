begin;
-- Opt-in padrão preserva todos os cadastros e comissões históricas.
alter table public.pessoas add column if not exists recebe_comissao boolean not null default true;
alter table public.representantes add column if not exists recebe_comissao boolean not null default true;
alter table public.pedidos add column if not exists comissao_habilitada boolean not null default true;
create or replace function public.proteger_recebe_comissao_304() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if ((tg_op='INSERT' and not new.recebe_comissao) or (tg_op='UPDATE' and new.recebe_comissao is distinct from old.recebe_comissao)) and auth.uid() is not null and (not public.usuario_ativo() or not public.has_role(auth.uid(),'admin')) then raise exception 'Somente administrador define se o representante recebe comissão';end if;
 return new;
end $$;
revoke all on function public.proteger_recebe_comissao_304() from public,anon,authenticated;
drop trigger if exists proteger_recebe_comissao_304 on public.pessoas;
create trigger proteger_recebe_comissao_304 before insert or update on public.pessoas for each row execute function public.proteger_recebe_comissao_304();
drop trigger if exists proteger_recebe_comissao_304 on public.representantes;
create trigger proteger_recebe_comissao_304 before insert or update on public.representantes for each row execute function public.proteger_recebe_comissao_304();
create or replace function public.sincronizar_recebe_comissao_304() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if tg_table_name='pessoas' then
  update public.representantes set recebe_comissao=new.recebe_comissao where pessoa_id=new.id and recebe_comissao is distinct from new.recebe_comissao;
 else
  update public.pessoas set recebe_comissao=new.recebe_comissao where id=new.pessoa_id and recebe_comissao is distinct from new.recebe_comissao;
 end if;
 if tg_op='UPDATE' and new.recebe_comissao is distinct from old.recebe_comissao then
  insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values(tg_table_name,new.id,'recebe_comissao_304',auth.uid(),jsonb_build_object('antes',old.recebe_comissao,'depois',new.recebe_comissao,'historico_aprovado_preservado',true));
 end if;return new;
end $$;
revoke all on function public.sincronizar_recebe_comissao_304() from public,anon,authenticated;
drop trigger if exists zz_recebe_comissao_304 on public.pessoas;
create trigger zz_recebe_comissao_304 after insert or update on public.pessoas for each row execute function public.sincronizar_recebe_comissao_304();
drop trigger if exists zz_recebe_comissao_304 on public.representantes;
create trigger zz_recebe_comissao_304 after insert or update on public.representantes for each row execute function public.sincronizar_recebe_comissao_304();
-- Congela a escolha na aprovação; trocar o cadastro não altera vendas anteriores.
create or replace function public.snapshot_comissao_304() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if tg_op='INSERT' or old.status in('rascunho','digitacao','aguardando_aprovacao') or new.status in('rascunho','digitacao','aguardando_aprovacao') then
  select coalesce((select recebe_comissao from public.representantes where id=new.representante_id),true) into new.comissao_habilitada;
 else new.comissao_habilitada:=old.comissao_habilitada;end if;
 if not new.comissao_habilitada then new.comissao_valor:=0;new.comissao_percentual:=0;end if;
 return new;
end $$;
revoke all on function public.snapshot_comissao_304() from public,anon,authenticated;
drop trigger if exists a_snapshot_comissao_304 on public.pedidos;
create trigger a_snapshot_comissao_304 before insert or update on public.pedidos for each row execute function public.snapshot_comissao_304();
do $$declare d text;begin
 select pg_get_functiondef('public.calcular_comissao_itens_215(uuid)'::regprocedure) into d;
 if position('recebe_comissao_304' in d)=0 then
  if position('if p.representante_id is null then return 0; end if;' in d)=0 then raise exception 'Cálculo de comissão incompatível';end if;
  d:=replace(d,'if p.representante_id is null then return 0; end if;', E'if p.representante_id is null then return 0; end if;\n -- recebe_comissao_304\n if not (case when p.status in(''rascunho'',''digitacao'',''aguardando_aprovacao'') then coalesce((select recebe_comissao from public.representantes where id=p.representante_id),true) else p.comissao_habilitada end) then return 0;end if;');execute d;
 end if;
 select pg_get_functiondef('public.apurar_comissao_pedido(uuid)'::regprocedure) into d;
 if position('recebe_comissao_304' in d)=0 then
  d:=replace(d,'select * into c from public.comissoes where pedido_id=p.id for update;', E'-- recebe_comissao_304\n if not p.comissao_habilitada then update public.comissoes set status=''cancelada'',valor=0 where pedido_id=p.id and status=''prevista'';return;end if;\n select * into c from public.comissoes where pedido_id=p.id for update;');
  if position('recebe_comissao_304' in d)=0 then raise exception 'Apuração incompatível';end if;execute d;
 end if;
end $$;
-- Uma comissão sem direito no pedido não pode ser reativada por escrita direta.
create or replace function public.proteger_comissao_elegivel_302() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if new.status in('prevista','liberada','paga') and not exists(select 1 from public.pedidos p where p.id=new.pedido_id and p.comissao_habilitada and public.status_comissao_valido_302(p.tipo_documento,p.status)) then raise exception 'Comissão exige pedido aprovado e representante com comissão habilitada';end if;
 return new;
end $$;
revoke all on function public.proteger_comissao_elegivel_302() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
