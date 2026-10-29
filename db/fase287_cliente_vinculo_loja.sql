-- Distingue cliente sem loja de compartilhado sem recategorizar cadastros existentes.
begin;
alter table public.pessoas add column if not exists loja_pendente boolean not null default false;
alter table public.clientes add column if not exists loja_pendente boolean not null default false;
do $$begin
 if not exists(select 1 from pg_constraint where conrelid='public.pessoas'::regclass and conname='pessoas_loja_pendente_287') then
  alter table public.pessoas add constraint pessoas_loja_pendente_287 check(not loja_pendente or centro_id is null);
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.clientes'::regclass and conname='clientes_loja_pendente_287') then
  alter table public.clientes add constraint clientes_loja_pendente_287 check(not loja_pendente or centro_id is null);
 end if;
end $$;
create index if not exists clientes_sem_loja_287 on public.clientes(id) where loja_pendente;

create or replace function public.validar_vinculo_loja_cliente_287() returns trigger
language plpgsql security definer set search_path=public as $$
declare pendente boolean;
begin
 if tg_table_name='pessoas' then
  if not coalesce(new.is_cliente,false) then new.loja_pendente:=false;end if;
 else
  if new.pessoa_id is not null then
   select p.loja_pendente into pendente from public.pessoas p where p.id=new.pessoa_id;
   if found then
    if tg_op='UPDATE' and new.loja_pendente is distinct from old.loja_pendente and pg_trigger_depth()=1 and auth.uid() is not null then raise exception 'Altere o vínculo de loja no Cadastro unificado';end if;
    new.loja_pendente:=pendente;
   end if;
  end if;
 end if;
 if new.loja_pendente and new.centro_id is not null then raise exception 'Cliente sem loja não pode ter uma loja específica selecionada';end if;
 if auth.uid() is not null and ((tg_op='INSERT' and new.loja_pendente) or (tg_op='UPDATE' and new.loja_pendente is distinct from old.loja_pendente)) and pg_trigger_depth()=1 then
  if public.usuario_ativo() is not true or public.can_manage(auth.uid()) is not true then raise exception 'Sem permissão para definir o vínculo de loja do cliente' using errcode='42501';end if;
 end if;
 return new;
end $$;
revoke all on function public.validar_vinculo_loja_cliente_287() from public,anon,authenticated,service_role;
drop trigger if exists zz_vinculo_loja_287 on public.pessoas;
create trigger zz_vinculo_loja_287 before insert or update on public.pessoas for each row execute function public.validar_vinculo_loja_cliente_287();
drop trigger if exists zz_vinculo_loja_287 on public.clientes;
create trigger zz_vinculo_loja_287 before insert or update on public.clientes for each row execute function public.validar_vinculo_loja_cliente_287();

-- O espelho comercial recebe também alterações apenas deste novo campo.
create or replace function public.sincronizar_vinculo_loja_cliente_287() returns trigger
language plpgsql security definer set search_path=public as $$begin
 update public.clientes set loja_pendente=new.loja_pendente where pessoa_id=new.id and loja_pendente is distinct from new.loja_pendente;
 return new;
end $$;
revoke all on function public.sincronizar_vinculo_loja_cliente_287() from public,anon,authenticated,service_role;
drop trigger if exists zzzz_vinculo_loja_287 on public.pessoas;
create trigger zzzz_vinculo_loja_287 after insert or update of loja_pendente on public.pessoas for each row execute function public.sincronizar_vinculo_loja_cliente_287();

-- Cadastro sem loja fica disponível para regularização; não inicia uma nova venda.
create or replace function public.pedido_cliente_sem_loja_287() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if coalesce(new.tipo_documento,'pedido')<>'pedido' then return new;end if;
 if tg_op='INSERT' or new.cliente_id is distinct from old.cliente_id or new.centro_id is distinct from old.centro_id or
 (new.status is distinct from old.status and new.status in('aguardando_aprovacao','aprovado','confirmado') and old.status in('rascunho','digitacao','aguardando_aprovacao','aprovado')) then
  if exists(select 1 from public.clientes where id=new.cliente_id and loja_pendente) then raise exception 'Cliente sem loja. Defina uma loja ou o compartilhamento no Cadastro unificado antes de iniciar ou confirmar o pedido';end if;
 end if;
 return new;
end $$;
revoke all on function public.pedido_cliente_sem_loja_287() from public,anon,authenticated,service_role;
drop trigger if exists cliente_sem_loja_287 on public.pedidos;
create trigger cliente_sem_loja_287 before insert or update on public.pedidos for each row execute function public.pedido_cliente_sem_loja_287();
notify pgrst,'reload schema';
commit;
