-- Emissão permitida após separação conferida, antes da montagem/faturamento da carga.
-- Mantém conferência, regras fiscais da loja, vínculos e proteção contra duplicidade.
begin;
do $$declare d text;antigo text:='(''faturado'',''nf_emitida'',''em_carga'',''em_rota'',''entregue'',''parcial'')';begin
 if to_regprocedure('public.bloqueio_boleto(uuid)') is null then raise exception 'Confira a fase42 antes da fase255';end if;
 select pg_get_functiondef('public.bloqueio_boleto(uuid)'::regprocedure) into d;
 if position('''conferido''' in d)=0 then
  if position(antigo in d)=0 then raise exception 'Regra de liberação de boletos incompatível com a fase255';end if;
  d:=replace(d,antigo,'(''conferido'',''faturado'',''nf_emitida'',''em_carga'',''em_rota'',''entregue'',''parcial'')');
 end if;
 d:=replace(d,'O boleto só pode ser emitido depois da separação conferida e do faturamento do pedido.','Conclua e confira a separação antes de emitir boletos deste pedido.');
 execute d;
end $$;
create or replace function public.liberacao_boleto_pedido_255(_pedido uuid) returns text
language plpgsql stable security definer set search_path=public as $$declare p255 public.pedidos;begin
 if not public.usuario_ativo() or not public.can_finance(auth.uid()) then raise exception 'Sem permissão para consultar a emissão de boletos';end if;
 select * into p255 from public.pedidos where id=_pedido;
 if p255.id is null or not public.usuario_pode_acessar_centro(p255.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',p255.id)) then raise exception 'Pedido indisponível ou sem acesso';end if;
 return public.bloqueio_boleto(p255.id);
end $$;
revoke all on function public.liberacao_boleto_pedido_255(uuid) from public,anon;
grant execute on function public.liberacao_boleto_pedido_255(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
