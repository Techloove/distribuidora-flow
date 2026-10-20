-- Lojas, parte3B: campanhas e faixas de peso independentes.
begin;
do $$begin
 if to_regprocedure('public.preco_item_pedido_244(uuid,uuid)') is null then raise exception 'Aplique a fase244 antes da fase245';end if;
end $$;
alter table public.tabelas_preco add column if not exists centro_id uuid references public.centros(id);
alter table public.desconto_faixas_peso add column if not exists centro_id uuid references public.centros(id);
alter table public.centros add column if not exists comercial_por_loja_245 boolean not null default false;
-- Copia as configurações compartilhadas uma única vez para cada loja existente.
-- Originais permanecem como arquivo, sem acesso operacional autenticado.
do $$declare c record;t record;n uuid;begin
 for c in select id from public.centros where not comercial_por_loja_245 for update loop
  for t in select * from public.tabelas_preco where centro_id is null loop
   n:=gen_random_uuid();
   insert into public.tabelas_preco(id,nome,cliente_id,uf,vigencia_inicio,vigencia_fim,prioridade,ativo,centro_id)
    values(n,t.nome,t.cliente_id,t.uf,t.vigencia_inicio,t.vigencia_fim,t.prioridade,t.ativo,c.id);
   insert into public.tabela_preco_itens(tabela_id,produto_id,preco,desconto_maximo)
    select n,produto_id,preco,desconto_maximo from public.tabela_preco_itens where tabela_id=t.id;
  end loop;
  insert into public.desconto_faixas_peso(nome,categoria,peso_min,peso_max,percentual,ativo,ordem,centro_id)
   select nome,categoria,peso_min,peso_max,percentual,ativo,ordem,c.id from public.desconto_faixas_peso where centro_id is null;
  update public.centros set comercial_por_loja_245=true where id=c.id;
 end loop;
end $$;
-- Novas lojas começam sem campanhas/faixas, evitando ativação automática de ofertas antigas.
alter table public.centros alter column comercial_por_loja_245 set default true;
insert into public.permissoes(codigo,nome,grupo,ordem,modulo)
 values('lojas_ofertas_configurar','Configurar promoções e descontos por peso da loja','Lojas',145,'/centros') on conflict(codigo) do nothing;
-- Restritivas: somam-se às políticas de carteira e permissões já existentes.
do $$declare t text;expr text;begin
 foreach t in array array['tabelas_preco','desconto_faixas_peso','tabela_preco_itens'] loop
  expr:=case when t='tabela_preco_itens' then 'exists(select 1 from public.tabelas_preco t where t.id=tabela_id and t.centro_id is not null and public.usuario_pode_acessar_centro(t.centro_id))' else 'centro_id is not null and public.usuario_pode_acessar_centro(centro_id)' end;
  execute format('drop policy if exists loja_escopo_245 on public.%I',t);
  execute format('create policy loja_escopo_245 on public.%I as restrictive for all to authenticated using(public.usuario_ativo() and (%s)) with check(public.usuario_ativo() and (%s))',t,expr,expr);
 end loop;
end $$;
create or replace function public.validar_oferta_loja_245() returns trigger
language plpgsql security definer set search_path=public as $$declare loja uuid;begin
 if auth.uid() is not null then
  if tg_table_name='tabela_preco_itens' and tg_op='DELETE' and pg_trigger_depth()>1 and not exists(select 1 from public.tabelas_preco where id=(to_jsonb(old)->>'tabela_id')::uuid) then return old;end if;
  loja:=case when tg_table_name='tabela_preco_itens' then (select centro_id from public.tabelas_preco where id=coalesce((to_jsonb(new)->>'tabela_id')::uuid,(to_jsonb(old)->>'tabela_id')::uuid)) else coalesce((to_jsonb(new)->>'centro_id')::uuid,(to_jsonb(old)->>'centro_id')::uuid) end;
  if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('lojas_ofertas_configurar') or loja is null or not public.usuario_pode_acessar_centro(loja) then raise exception 'Sem permissão para configurar ofertas desta loja';end if;
  if tg_op='UPDATE' and ((tg_table_name<>'tabela_preco_itens' and (to_jsonb(new)->>'centro_id') is distinct from (to_jsonb(old)->>'centro_id')) or (tg_table_name='tabela_preco_itens' and (to_jsonb(new)->>'tabela_id') is distinct from (to_jsonb(old)->>'tabela_id'))) then raise exception 'A loja da oferta não pode ser alterada. Crie uma nova oferta na outra loja';end if;
 end if;
 if tg_op<>'DELETE' then
  if tg_table_name='desconto_faixas_peso' then
   if new.peso_min<0 or new.peso_min::text in ('NaN','Infinity','-Infinity') or (new.peso_max is not null and (new.peso_max<new.peso_min or new.peso_max::text in ('NaN','Infinity','-Infinity'))) or new.percentual<0 or new.percentual>100 or new.percentual::text in ('NaN','Infinity','-Infinity') then raise exception 'Confira o intervalo de peso e o desconto (0 a 100%%)';end if;
  elsif tg_table_name='tabelas_preco' then
   if new.vigencia_fim<new.vigencia_inicio then raise exception 'Vigência final anterior ao início';end if;
  else
   if new.preco<0 or new.preco::text in ('NaN','Infinity','-Infinity') or new.desconto_maximo<0 or new.desconto_maximo>100 or new.desconto_maximo::text in ('NaN','Infinity','-Infinity') then raise exception 'Preço ou desconto promocional inválido';end if;
  end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.validar_oferta_loja_245() from public,anon,authenticated;
do $$declare t text;begin
 foreach t in array array['tabelas_preco','desconto_faixas_peso','tabela_preco_itens'] loop
  execute format('drop trigger if exists validar_oferta_loja_245 on public.%I',t);
  execute format('create trigger validar_oferta_loja_245 before insert or update or delete on public.%I for each row execute function public.validar_oferta_loja_245()',t);
 end loop;
end $$;
-- O cálculo e o aviso de progresso passam a usar a mesma loja do pedido.
do $$declare d text;begin
 select pg_get_functiondef('public.desconto_peso_pedido(uuid)'::regprocedure) into d;
 if position('centro_id=ped.centro_id' in d)=0 then
  if position('from public.desconto_faixas_peso where ativo' in d)=0 then raise exception 'Cálculo por peso incompatível com a fase245';end if;
  d:=replace(d,'from public.desconto_faixas_peso where ativo','from public.desconto_faixas_peso where centro_id=ped.centro_id and ativo');execute d;
 end if;
end $$;
create or replace function public.preco_item_pedido_244(_pedido uuid,_produto uuid)
returns table(preco numeric,preco_normal numeric,tabela_nome text,vigencia_inicio date,vigencia_fim date,promocao boolean)
language plpgsql stable security definer set search_path=public as $$declare p public.pedidos;l public.loja_produtos;uf_cliente text;begin
 select * into p from public.pedidos where id=_pedido;
 if not public.usuario_ativo() or p.id is null or not public.usuario_pode_acessar_centro(p.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',p.id)) then raise exception 'Pedido sem acesso';end if;
 select * into l from public.loja_produtos where centro_id=p.centro_id and produto_id=_produto;
 if l.produto_id is null or not l.disponivel then raise exception 'Produto indisponível nesta loja';end if;
 select uf into uf_cliente from public.clientes where id=p.cliente_id;
 return query select i.preco,l.preco_venda,t.nome::text,t.vigencia_inicio,t.vigencia_fim,true
 from public.tabela_preco_itens i join public.tabelas_preco t on t.id=i.tabela_id
 where i.produto_id=_produto and t.centro_id=p.centro_id and t.ativo
 and t.vigencia_inicio<=current_date and (t.vigencia_fim is null or t.vigencia_fim>=current_date)
 and (t.cliente_id is null or t.cliente_id=p.cliente_id) and (t.uf is null or t.uf=uf_cliente)
 order by (t.cliente_id is not null) desc,(t.uf is not null) desc,t.prioridade desc,t.id limit 1;
 if not found then return query select l.preco_venda,l.preco_venda,null::text,null::date,null::date,false;end if;
end $$;
revoke all on function public.preco_item_pedido_244(uuid,uuid) from public,anon;
grant execute on function public.preco_item_pedido_244(uuid,uuid) to authenticated;
-- RPCs antigas não possuem loja: não podem escolher entre campanhas de lojas diferentes.
do $$declare r regprocedure;d text;begin
 foreach r in array array['public.preco_produto_info(uuid,uuid)'::regprocedure,'public.preco_produto(uuid,uuid)'::regprocedure] loop
  select pg_get_functiondef(r) into d;
  if position('t.centro_id is null' in d)=0 then
   if position('t.ativo' in d)=0 then raise exception 'Preço legado incompatível: %',r;end if;
   d:=replace(d,'t.ativo','t.ativo and t.centro_id is null');execute d;
  end if;
 end loop;
end $$;
create or replace view public.vw_promocoes with(security_invoker=true) as
select i.id as item_id,t.id as tabela_id,t.nome as tabela_nome,t.ativo,t.cliente_id,t.uf,t.prioridade,t.vigencia_inicio,t.vigencia_fim,
 p.id as produto_id,p.codigo as produto_codigo,p.descricao as produto_descricao,coalesce(l.preco_venda,p.preco_venda)::numeric(14,4) as preco_normal,
 i.preco as preco_promocional,i.desconto_maximo,
 case when coalesce(l.preco_venda,p.preco_venda,0)>0 then round(((i.preco-coalesce(l.preco_venda,p.preco_venda))/coalesce(l.preco_venda,p.preco_venda))*100,2) else 0 end as variacao_percentual,
 (t.ativo and t.vigencia_inicio<=current_date and (t.vigencia_fim is null or t.vigencia_fim>=current_date)) as vigente,t.centro_id
from public.tabela_preco_itens i join public.tabelas_preco t on t.id=i.tabela_id join public.produtos p on p.id=i.produto_id
left join public.loja_produtos l on l.produto_id=p.id and l.centro_id=t.centro_id;
grant select on public.vw_promocoes to authenticated;
notify pgrst,'reload schema';
commit;
