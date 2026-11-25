begin;
create table if not exists public.compra_precificacao_376(
 compra_id uuid not null references public.compras(id) on delete cascade,
 produto_id uuid not null references public.produtos(id),
 modo text not null check(modo in('markup','preco')),
 valor numeric(18,4) not null check(valor>=0 and valor::text not in('NaN','Infinity','-Infinity')),
 atualizado_por uuid, atualizado_em timestamptz not null default now(),
 primary key(compra_id,produto_id)
);
alter table public.compra_precificacao_376 enable row level security;
revoke all on public.compra_precificacao_376 from public,anon,authenticated;
create or replace function public.previa_precificacao_compra_376(_compra uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c public.compras; resultado jsonb;
begin
 select * into c from public.compras where id=_compra;
 if auth.uid() is null or not public.pode_ver_custos_produto_324() or not public.pode_rotina('compras_operar')
  or not (public.can_stock(auth.uid()) or public.can_finance(auth.uid()))
  or c.id is null or not public.usuario_pode_acessar_centro(c.centro_id) then raise exception 'Sem acesso à precificação da compra';end if;
 if exists(select 1 from public.compra_itens i where i.compra_id=c.id and public.loja_produto_estoque_271(i.produto_id) is distinct from c.centro_id) then raise exception 'Há produtos de outra loja na compra';end if;
 with itens as (
  select produto_id,sum(quantidade) qtd,
   sum(quantidade*(round(custo_unitario*(1+ipi_percentual/100),4)+frete_unitario))/nullif(sum(quantidade),0) custo
  from public.compra_itens where compra_id=c.id group by produto_id
 ), base as (
  select p.id produto_id,p.descricao,p.preco_venda preco_atual,p.markup_percentual markup_atual,
   p.custo_medio custo_atual,p.estoque_atual saldo_atual,i.qtd,
   round(case when c.status='recebida' then coalesce(p.custo_medio,0) when coalesce(p.estoque_atual,0)+i.qtd>0 then
    (coalesce(p.estoque_atual,0)*coalesce(p.custo_medio,0)+i.qtd*i.custo*
     case when c.total_itens>0 then c.total_liquido/c.total_itens else 1 end)/(coalesce(p.estoque_atual,0)+i.qtd)
    else coalesce(p.custo_medio,0) end,4) custo_novo,
   s.modo,s.valor
  from itens i join public.produtos p on p.id=i.produto_id
  left join public.compra_precificacao_376 s on s.compra_id=c.id and s.produto_id=p.id
 ) select coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object('preco_sugerido',round(b.custo_novo*(1+coalesce(b.markup_atual,0)/100),4)) order by b.descricao),'[]'::jsonb) into resultado from base b;
 return resultado;
end $$;
create or replace function public.salvar_precificacao_compra_376(_compra uuid,_produto uuid,_modo text,_valor numeric)
returns void language plpgsql security definer set search_path=public as $$
declare c public.compras;
begin
 select * into c from public.compras where id=_compra for update;
 perform public.previa_precificacao_compra_376(_compra);
 if not public.pode_alterar_preco(auth.uid()) then raise exception 'Seu perfil não permite alterar preços';end if;
 if c.status not in('rascunho','comprado') then raise exception 'Precificação disponível somente antes do recebimento';end if;
 if not exists(select 1 from public.compra_itens where compra_id=c.id and produto_id=_produto)
  or public.loja_produto_estoque_271(_produto) is distinct from c.centro_id then raise exception 'Produto não pertence à compra ou loja';end if;
 if _modo is null then
  delete from public.compra_precificacao_376 where compra_id=c.id and produto_id=_produto;
 else
  if _modo not in('markup','preco') or _valor is null or _valor<0 or _valor::text in('NaN','Infinity','-Infinity') then raise exception 'Informe markup ou preço válido, zero ou maior';end if;
  insert into public.compra_precificacao_376(compra_id,produto_id,modo,valor,atualizado_por)
  values(c.id,_produto,_modo,round(_valor,case when _modo='markup' then 2 else 4 end),auth.uid())
  on conflict(compra_id,produto_id) do update set modo=excluded.modo,valor=excluded.valor,atualizado_por=auth.uid(),atualizado_em=now();
 end if;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('compras',c.id,'planejar_preco_376',auth.uid(),jsonb_build_object('produto',_produto,'modo',_modo,'valor',_valor));
end $$;
-- Plano e recebimento são serializados pela compra; produtos seguem a ordem usada pelo estoque.
-- Mantém o recebimento original e aplica os preços somente depois da entrada real, na mesma transação.
do $patch$
declare d text; alvo text:=E'  update public.compras\n     set status=''recebida''';
begin
 select pg_get_functiondef('public.receber_compra(uuid)'::regprocedure) into d;
 if position('precificacao_376' in d)=0 then
  if position(alvo in d)=0 or position('ipi_percentual' in d)=0 then raise exception 'Recebimento incompatível. Aplique a fase375 antes da fase376';end if;
  d:=replace(d,'  perform public.recalcular_compra(_compra_id);',$guard$
  -- precificacao_376
  if exists(select 1 from public.compra_precificacao_376 s join public.compra_itens i on i.compra_id=s.compra_id and i.produto_id=s.produto_id where s.compra_id=cmp.id) then
   if not public.pode_ver_custos_produto_324() or not public.pode_alterar_preco(auth.uid()) then raise exception 'Há preços planejados; o recebimento exige permissão para alterar preços';end if;
  end if;
  perform 1 from public.produtos p where exists(select 1 from public.compra_itens i where i.compra_id=cmp.id and i.produto_id=p.id) order by p.id for update;
  perform public.recalcular_compra(_compra_id);
$guard$);
  d:=replace(d,alvo,$apply$
  for item in select s.*,p.preco_venda anterior from public.compra_precificacao_376 s join public.produtos p on p.id=s.produto_id
   where s.compra_id=cmp.id and exists(select 1 from public.compra_itens i where i.compra_id=cmp.id and i.produto_id=s.produto_id) order by s.produto_id loop
   if item.modo='markup' then
    update public.produtos set markup_percentual=item.valor,preco_venda=round(custo_medio*(1+item.valor/100),4) where id=item.produto_id;
   else
    update public.produtos set preco_venda=item.valor,
     markup_percentual=case when custo_medio>0 then round((item.valor/custo_medio-1)*100,2) else 0 end where id=item.produto_id;
   end if;
   -- Reaplica o preço explícito caso a sincronização por markup arredondado tenha ajustado um preço igual ao anterior.
   if item.modo='preco' then update public.produtos set preco_venda=item.valor where id=item.produto_id and preco_venda is distinct from item.valor;end if;
   insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('produtos',item.produto_id,'preco_recebimento_376',auth.uid(),jsonb_build_object('compra',cmp.id,'modo',item.modo,'valor',item.valor,'preco_antes_da_aplicacao',item.anterior,'preco_novo',(select preco_venda from public.produtos where id=item.produto_id)));
  end loop;
  update public.compras
     set status='recebida'
$apply$);
  execute d;
 end if;
end $patch$;
revoke all on function public.previa_precificacao_compra_376(uuid) from public,anon;
revoke all on function public.salvar_precificacao_compra_376(uuid,uuid,text,numeric) from public,anon;
grant execute on function public.previa_precificacao_compra_376(uuid) to authenticated;
grant execute on function public.salvar_precificacao_compra_376(uuid,uuid,text,numeric) to authenticated;
notify pgrst,'reload schema';
commit;
