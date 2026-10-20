-- Separação: conclusão atômica de múltiplos pedidos e dados dos relatórios.
begin;
do $$begin
 if to_regprocedure('public.concluir_separacao_pratica_233(uuid,boolean)') is null then raise exception 'Aplique a fase233 antes da fase248';end if;
end $$;
create or replace function public.concluir_separacao_lote_248(_pedidos uuid[],_confirmar_completa boolean default false) returns integer
language plpgsql security definer set search_path=public as $$declare pedido uuid;n integer:=0;begin
 if not public.usuario_ativo() or not public.pode_rotina('separacao_concluir') or not public.can_stock(auth.uid()) then raise exception 'Sem acesso à conclusão da separação';end if;
 if _confirmar_completa is distinct from true then raise exception 'Confirme a conferência completa dos pedidos selecionados';end if;
 if _pedidos is null or cardinality(_pedidos)=0 or cardinality(_pedidos)>100 or array_position(_pedidos,null) is not null then raise exception 'Selecione de 1 a 100 pedidos válidos';end if;
 -- Ordem única de bloqueio e transação única: erro em qualquer pedido desfaz o lote.
 for pedido in select distinct unnest(_pedidos) order by 1 loop
  perform public.concluir_separacao_pratica_233(pedido,true);
  n:=n+1;
 end loop;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',null,'concluir_separacao_lote_248',auth.uid(),jsonb_build_object('pedidos',to_jsonb(_pedidos),'quantidade',n));
 return n;
end $$;
revoke all on function public.concluir_separacao_lote_248(uuid[],boolean) from public,anon;
grant execute on function public.concluir_separacao_lote_248(uuid[],boolean) to authenticated;
-- Acrescenta metadados sem remover a definição/guardas atuais da view.
do $$declare d text;begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='vw_separacao' and column_name='data_pedido') then
  select pg_get_viewdef('public.vw_separacao'::regclass,true) into d;
  d:=regexp_replace(d,';\s*$','');
  execute 'create or replace view public.vw_separacao with(security_invoker=true) as select v.*, p.data_pedido,p.previsao_entrega,p.cliente_id,cli.cidade,pr.unidade from ('||d||') v join public.pedidos p on p.id=v.pedido_id left join public.clientes cli on cli.id=p.cliente_id join public.produtos pr on pr.id=v.produto_id';
 end if;
end $$;
grant select on public.vw_separacao to authenticated;
notify pgrst,'reload schema';
commit;
