-- Permite preparar/enviar pedidos de clientes pendentes sem antecipar aprovação, estoque ou financeiro.
begin;
create or replace function public.exigir_credito_liberado_284() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.status not in ('rascunho','digitacao','aguardando_aprovacao','cancelado') and exists(
  select 1 from public.clientes c join public.pessoas p on p.id=c.pessoa_id where c.id=new.cliente_id and p.credito_pendente
 ) then raise exception 'Aguardando aprovação de cadastro: o administrador deve revisar e liberar o cliente antes de aprovar ou confirmar o pedido';end if;
 return new;
end $$;
revoke all on function public.exigir_credito_liberado_284() from public,anon,authenticated,service_role;
create or replace function public.exigir_cadastro_cliente_334(_pedido uuid) returns void
language plpgsql security definer set search_path=public as $$begin
 if exists(select 1 from public.pedidos d join public.clientes c on c.id=d.cliente_id join public.pessoas p on p.id=c.pessoa_id where d.id=_pedido and p.credito_pendente) then
  raise exception 'Aguardando aprovação de cadastro: o administrador deve revisar e liberar o cliente antes de aprovar ou confirmar o pedido' using errcode='42501';
 end if;
end $$;
revoke all on function public.exigir_cadastro_cliente_334(uuid) from public,anon,authenticated,service_role;
-- Verificação antecipada para todos os perfis, antes de qualquer efeito de confirmação.
do $$declare d text;assinatura text;alvo text:='select * into ped from public.pedidos where id = _pedido_id for update;';guarda text;begin
 foreach assinatura in array array['public.confirmar_pedido(uuid)','public.avancar_pedido(uuid,text)'] loop
  select pg_get_functiondef(assinatura::regprocedure) into d;
  if position('cadastro_cliente_334' in d)=0 then
   if position(alvo in d)=0 then raise exception 'Revise a rotina % antes de instalar a fase334',assinatura;end if;
   guarda:=case when assinatura='public.confirmar_pedido(uuid)' then 'perform public.exigir_cadastro_cliente_334(_pedido_id);'
    else 'if _novo_status not in (''rascunho'',''digitacao'',''aguardando_aprovacao'',''cancelado'') then perform public.exigir_cadastro_cliente_334(_pedido_id);end if;' end;
   execute replace(d,alvo,alvo||E'\n '||guarda||' -- cadastro_cliente_334');
  end if;
 end loop;
 select pg_get_functiondef('public.validar_pedido(uuid)'::regprocedure) into d;
 if position('cadastro_cliente_334' in d)=0 then
  if position('''Cliente bloqueado no cadastro''' in d)=0 then raise exception 'Revise validar_pedido antes da fase334';end if;
  execute replace(d,'''Cliente bloqueado no cadastro''',
   '(case when exists(select 1 from public.pessoas cadastro_cliente_334 where cadastro_cliente_334.id=cli.pessoa_id and cadastro_cliente_334.credito_pendente) then ''Aguardando aprovação de cadastro do cliente pelo administrador'' else ''Cliente bloqueado no cadastro'' end)');
 end if;
end $$;
notify pgrst,'reload schema';
commit;
