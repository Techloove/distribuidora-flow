-- Fase222: o gatilho compartilhado só lê campos da tabela correta.
-- Preserva a verificação de centro dos documentos vinculados e os demais controles.
begin;
create or replace function public.validar_escopo_titulo_financeiro()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_centro uuid;
begin
 if auth.uid() is null then return new; end if;
 if tg_table_name='contas_receber' then
  if new.pedido_id is null then return new; end if;
  select centro_id into v_centro from public.pedidos where id=new.pedido_id;
 elsif tg_table_name='contas_pagar' then
  if new.compra_id is null then return new; end if;
  select centro_id into v_centro from public.compras where id=new.compra_id;
 else
  return new;
 end if;
 if v_centro is null then raise exception 'Documento financeiro sem centro valido'; end if;
 if not public.usuario_pode_acessar_centro(v_centro) then
  raise exception 'Documento financeiro pertence a outro centro';
 end if;
 return new;
end $$;
revoke all on function public.validar_escopo_titulo_financeiro() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
