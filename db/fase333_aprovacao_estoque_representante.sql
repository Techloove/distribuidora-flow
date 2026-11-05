-- Falta de estoque exige análise comercial; representante sem admin não aprova nem confirma.
begin;
create or replace function public.exigir_estoque_representante_333(_pedido uuid,_acao text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not public.escopo_representante() then return;end if;
 if _acao in('aprovado','recusado') then
  raise exception 'Representante sem administrador pode imprimir e enviar para aprovação; a decisão cabe à gestão' using errcode='42501';
 end if;
 if _acao in('confirmado','separacao') and exists(select 1 from public.alertas_estoque_pedido_332(_pedido) a where a.insuficiente) then
  raise exception 'Estoque insuficiente. Imprima o pedido ou envie para aprovação comercial' using errcode='42501';
 end if;
end $$;
revoke all on function public.exigir_estoque_representante_333(uuid,text) from public,anon,authenticated,service_role;
-- Guarda antes de qualquer saída de estoque, aprovação implícita ou lançamento financeiro.
do $$declare d text;alvo text:='select * into ped from public.pedidos where id = _pedido_id for update;'; assinatura text;acao text;begin
 foreach assinatura in array array['public.confirmar_pedido(uuid)','public.avancar_pedido(uuid,text)'] loop
  select pg_get_functiondef(assinatura::regprocedure) into d;
  if position('estoque_representante_333' in d)=0 then
   if position(alvo in d)=0 then raise exception 'Revise a rotina % antes de instalar a fase333',assinatura;end if;
   acao:=case when assinatura='public.confirmar_pedido(uuid)' then '''confirmado''' else '_novo_status' end;
   execute replace(d,alvo,alvo||E'\n perform public.exigir_estoque_representante_333(_pedido_id,'||acao||'); -- estoque_representante_333');
  end if;
 end loop;
end $$;
-- Também protege aprovação por UPDATE; confirmação deve ser validada antes da baixa pela RPC.
create or replace function public.proteger_aprovacao_representante_333() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if new.status is distinct from old.status and new.status in('aprovado','recusado') then
  perform public.exigir_estoque_representante_333(old.id,new.status);
 end if;
 return new;
end $$;
revoke all on function public.proteger_aprovacao_representante_333() from public,anon,authenticated,service_role;
drop trigger if exists proteger_aprovacao_representante_333 on public.pedidos;
create trigger proteger_aprovacao_representante_333 before update of status on public.pedidos for each row execute function public.proteger_aprovacao_representante_333();
notify pgrst,'reload schema';
commit;
