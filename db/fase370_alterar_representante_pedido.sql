begin;
-- A troca transfere a comissão contratada do pedido; não renegocia percentuais.
create or replace function public.validar_troca_representante_370() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.representante_id is not distinct from old.representante_id then return new;end if;
 if auth.uid() is null or not public.usuario_ativo() or not public.has_role(auth.uid(),'admin') or not public.usuario_pode_acessar_centro(old.centro_id) then raise exception 'Somente administrador com acesso à loja altera o representante';end if;
 if old.tipo_documento<>'pedido' or old.status in('cancelado','recusado') then raise exception 'Troca disponível somente para pedidos ativos';end if;
 if not exists(select 1 from public.representantes r where r.id=new.representante_id and r.ativo and (r.centro_id is null or r.centro_id=old.centro_id)) then raise exception 'Selecione um representante ativo da loja ou compartilhado';end if;
 perform 1 from public.comissoes where pedido_id=old.id order by id for update;
 perform 1 from public.contas_pagar t where t.id in(
  select cp.conta_pagar_id from public.comissao_parcelas cp join public.comissoes c on c.id=cp.comissao_id where c.pedido_id=old.id
  union select pg.conta_pagar_id from public.comissao_pagamentos pg join public.comissao_pagamento_itens i on i.pagamento_id=pg.id join public.comissoes c on c.id=i.comissao_id where c.pedido_id=old.id
 ) order by t.id for update;
 if exists(select 1 from public.comissao_pagamento_itens i join public.comissao_pagamentos pg on pg.id=i.pagamento_id join public.comissoes c on c.id=i.comissao_id join public.contas_pagar t on t.id=pg.conta_pagar_id where c.pedido_id=old.id and (coalesce(t.valor_pago,0)>0 or t.status='pago')) or exists(select 1 from public.comissoes where pedido_id=old.id and status='paga') or exists(
  select 1 from public.comissao_parcelas cp join public.comissoes c on c.id=cp.comissao_id join public.contas_pagar t on t.id=cp.conta_pagar_id where c.pedido_id=old.id and (coalesce(t.valor_pago,0)>0 or t.status='pago')
 ) then raise exception 'Não é possível alterar: comissão já paga, inclusive parcialmente';end if;
 if exists(select 1 from public.comissao_pagamento_itens i join public.comissao_pagamentos pg on pg.id=i.pagamento_id join public.comissoes c on c.id=i.comissao_id where c.pedido_id=old.id and pg.status<>'cancelado') or exists(
 select 1 from public.comissao_parcelas cp join public.comissoes c on c.id=cp.comissao_id join public.contas_pagar t on t.id=cp.conta_pagar_id where c.pedido_id=old.id and t.status<>'cancelado'
 ) then raise exception 'Estorne o agendamento da comissão antes de alterar o representante';end if;
 return new;
end $$;
revoke all on function public.validar_troca_representante_370() from public,anon,authenticated;
drop trigger if exists validar_troca_representante_370 on public.pedidos;
create trigger validar_troca_representante_370 before update of representante_id on public.pedidos for each row execute function public.validar_troca_representante_370();
create or replace function public.registrar_troca_representante_370() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if new.representante_id is not distinct from old.representante_id then return new;end if;
 update public.comissoes set representante_id=new.representante_id where pedido_id=new.id;
 update public.comissao_ajustes set representante_id=new.representante_id where pedido_id=new.id and status='pendente';
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',new.id,'alterar_representante_370',auth.uid(),jsonb_build_object('representante_anterior',old.representante_id,'representante_novo',new.representante_id,'comissao_contratada_preservada',true));
 return new;
end $$;
revoke all on function public.registrar_troca_representante_370() from public,anon,authenticated;
drop trigger if exists zz_troca_representante_370 on public.pedidos;
create trigger zz_troca_representante_370 after update of representante_id on public.pedidos for each row execute function public.registrar_troca_representante_370();
create or replace function public.alterar_representante_pedido_370(_pedido uuid,_representante uuid,_anterior uuid) returns void
language plpgsql security definer set search_path=public as $$declare p public.pedidos;begin
 if auth.uid() is null or not public.usuario_ativo() or not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador altera o representante';end if;
 select * into p from public.pedidos where id=_pedido for update;
 if p.id is null or not public.usuario_pode_acessar_centro(p.centro_id) then raise exception 'Pedido sem acesso';end if;
 if p.representante_id is distinct from _anterior then raise exception 'Representante alterado por outro usuário. Atualize o pedido';end if;
 if _representante is null or _representante is not distinct from p.representante_id then raise exception 'Selecione outro representante';end if;
 update public.pedidos set representante_id=_representante where id=p.id;
end $$;
revoke all on function public.alterar_representante_pedido_370(uuid,uuid,uuid) from public,anon;
grant execute on function public.alterar_representante_pedido_370(uuid,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
