begin;
-- Saldo final: cálculo serializado pela mesma linha usada pelos movimentos e reservas (fase271).
create or replace function public.ajustar_saldo_estoque_374(
 _produto_id uuid,_centro_id uuid,_saldo_final numeric,_saldo_esperado numeric,_observacao text default null
) returns void language plpgsql security definer set search_path=public as $$
declare atual numeric; delta numeric;
begin
 if auth.uid() is null or not public.usuario_ativo() or not public.can_stock(auth.uid()) then
  raise exception 'Sem permissão para ajustar estoque';
 end if;
 if _centro_id is null or not public.usuario_pode_acessar_centro(_centro_id) then
  raise exception 'Usuário sem acesso à loja informada';
 end if;
 if _saldo_final is null or _saldo_final::text in ('NaN','Infinity','-Infinity') or _saldo_final<0
  or _saldo_final<>round(_saldo_final,3) or _saldo_esperado is null then
  raise exception 'Informe um saldo final válido, zero ou maior, com até três casas decimais';
 end if;
 perform 1 from public.produtos where id=_produto_id for update;
 if not found or _centro_id is distinct from public.loja_produto_estoque_271(_produto_id) then
  raise exception 'Selecione um produto da loja atual';
 end if;
 select coalesce((select quantidade from public.estoque_saldos where produto_id=_produto_id and centro_id=_centro_id),0) into atual;
 if atual is distinct from _saldo_esperado then
  raise exception 'O saldo mudou durante o preenchimento. Atualize a tela e confira antes de ajustar';
 end if;
 delta:=_saldo_final-atual;
 if delta=0 then return;end if;
 -- O motor existente valida reservas/negativo, mantém depósitos e registra o autor.
 perform public.lancar_movimento_estoque(_produto_id,_centro_id,'ajuste',delta,null,'manual',null,_observacao);
end $$;
revoke all on function public.ajustar_saldo_estoque_374(uuid,uuid,numeric,numeric,text) from public,anon,service_role;
grant execute on function public.ajustar_saldo_estoque_374(uuid,uuid,numeric,numeric,text) to authenticated;
commit;
