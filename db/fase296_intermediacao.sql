-- Modalidade opt-in por loja; cotação versionada e custos congelados no item.
-- Não converte pedidos existentes nem altera custos/preços de produtos.
begin;
insert into public.parametros(chave,valor,descricao) values('intermediacao_habilitada','false','Permitir pedidos de intermediação com entrega direta da fábrica') on conflict(chave) do nothing;
insert into public.loja_parametros(centro_id,chave,valor)
 select id,'intermediacao_habilitada',case when public.norm_txt(nome)='cimento' and ativo then 'true' else 'false' end from public.centros on conflict(centro_id,chave) do nothing;

alter table public.pedidos add column if not exists modalidade_venda text not null default 'estoque' check(modalidade_venda in('estoque','intermediacao'));
create table if not exists public.intermediacao_cotacoes_296(
 id uuid primary key default gen_random_uuid(), centro_id uuid not null references public.centros(id), produto_id uuid not null references public.produtos(id),
 dia date not null, custo_fabrica numeric(14,4) not null check(custo_fabrica>0 and custo_fabrica::text not in('NaN','Infinity','-Infinity')),
 revisao integer not null check(revisao>0), created_by uuid not null references public.profiles(id), created_at timestamptz not null default clock_timestamp(),
 unique(centro_id,produto_id,dia,revisao)
);
create index if not exists intermediacao_cotacoes_busca_296 on public.intermediacao_cotacoes_296(centro_id,dia,produto_id,revisao desc);
alter table public.intermediacao_cotacoes_296 enable row level security;
revoke all on public.intermediacao_cotacoes_296 from public,anon,authenticated;
grant select on public.intermediacao_cotacoes_296 to authenticated;
grant all on public.intermediacao_cotacoes_296 to service_role;
drop policy if exists cotacoes_leitura_296 on public.intermediacao_cotacoes_296;
create policy cotacoes_leitura_296 on public.intermediacao_cotacoes_296 for select to authenticated using(public.usuario_ativo() and public.can_operate(auth.uid()) and public.usuario_pode_acessar_centro(centro_id));
alter table public.pedido_itens add column if not exists cotacao_intermediacao_id uuid references public.intermediacao_cotacoes_296(id);
alter table public.pedido_itens add column if not exists custo_fabrica_saca numeric(14,4);
alter table public.pedido_itens add column if not exists frete_saca numeric(14,4);
alter table public.pedido_itens add column if not exists margem_saca numeric(14,4);

-- A confirmação continua única por pedido/ciclo/parcela. Títulos de saldo de
-- devolução são substituições da cobrança original, não novas confirmações.
-- Permite preservar o original cancelado e o novo saldo sem violar a unicidade.
drop index if exists public.contas_receber_pedido_parcela_uq;
create unique index contas_receber_pedido_parcela_uq on public.contas_receber(pedido_id,ciclo_pedido_289,parcela) where pedido_id is not null and documento like 'PED-%' and titulo_substituido_285 is null;

-- Prova de confirmação independente do estoque, inclusive pagamento integral com crédito.
create table if not exists public.intermediacao_confirmacoes_296(
 pedido_id uuid not null references public.pedidos(id),ciclo integer not null,
 valor numeric(14,2) not null,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),primary key(pedido_id,ciclo)
);
alter table public.intermediacao_confirmacoes_296 enable row level security;
revoke all on public.intermediacao_confirmacoes_296 from public,anon,authenticated;
grant select on public.intermediacao_confirmacoes_296 to authenticated;
grant all on public.intermediacao_confirmacoes_296 to service_role;
drop policy if exists confirmacoes_leitura_296 on public.intermediacao_confirmacoes_296;
create policy confirmacoes_leitura_296 on public.intermediacao_confirmacoes_296 for select to authenticated using(public.usuario_ativo() and exists(select 1 from public.pedidos p where p.id=pedido_id and public.usuario_pode_acessar_centro(p.centro_id) and (not public.escopo_representante() or public.documento_na_minha_carteira('pedidos',p.id))));

create or replace function public.intermediacao_ativa_296(_loja uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select public.usuario_ativo() and public.usuario_pode_acessar_centro(_loja) and exists(select 1 from public.centros c join public.loja_parametros l on l.centro_id=c.id and l.chave='intermediacao_habilitada' and l.valor='true' where c.id=_loja and c.ativo)
$$;
revoke all on function public.intermediacao_ativa_296(uuid) from public,anon;
grant execute on function public.intermediacao_ativa_296(uuid) to authenticated;

create or replace function public.salvar_cotacao_intermediacao_296(_loja uuid,_produto uuid,_dia date,_custo numeric) returns public.intermediacao_cotacoes_296
language plpgsql security definer set search_path=public as $$declare anterior public.intermediacao_cotacoes_296; nova public.intermediacao_cotacoes_296;begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('configuracao_rotinas_editar') or not public.intermediacao_ativa_296(_loja) then raise exception 'Sem permissão para cadastrar cotação nesta loja';end if;
 if _dia is null or _custo is null or _custo::text in('NaN','Infinity','-Infinity') or _custo<=0 or _custo>=10000000000 then raise exception 'Informe data e custo de fábrica maior que zero';end if;
 perform 1 from public.centros where id=_loja for share;
 if not exists(select 1 from public.produtos p join public.loja_produtos l on l.produto_id=p.id and l.centro_id=_loja where p.id=_produto and p.ativo and l.disponivel and public.produto_categoria_loja_246(_loja,p.id)) then raise exception 'Produto indisponível nesta loja';end if;
 perform pg_advisory_xact_lock(hashtextextended(_loja::text||_produto::text||_dia::text,296));
 select * into anterior from public.intermediacao_cotacoes_296 where centro_id=_loja and produto_id=_produto and dia=_dia order by revisao desc limit 1;
 if anterior.id is not null and anterior.custo_fabrica=round(_custo,4) then return anterior;end if;
 insert into public.intermediacao_cotacoes_296(centro_id,produto_id,dia,custo_fabrica,revisao,created_by) values(_loja,_produto,_dia,round(_custo,4),coalesce(anterior.revisao,0)+1,auth.uid()) returning * into nova;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('intermediacao_cotacoes_296',nova.id,'cotacao_diaria',auth.uid(),to_jsonb(nova));
 return nova;
end $$;
revoke all on function public.salvar_cotacao_intermediacao_296(uuid,uuid,date,numeric) from public,anon;
grant execute on function public.salvar_cotacao_intermediacao_296(uuid,uuid,date,numeric) to authenticated;

create or replace function public.modalidade_pedido_296() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if new.modalidade_venda='intermediacao' and new.tipo_documento<>'pedido' then raise exception 'Intermediação é uma modalidade de pedido, não de orçamento';end if;
 if new.modalidade_venda='intermediacao' and (tg_op='INSERT' or old.modalidade_venda is distinct from new.modalidade_venda) then
  if not public.intermediacao_ativa_296(new.centro_id) or new.tipo_documento<>'pedido' or new.status not in('rascunho','digitacao') then raise exception 'Intermediação não habilitada nesta loja ou pedido indisponível';end if;
 end if;
 if tg_op='UPDATE' and new.modalidade_venda is distinct from old.modalidade_venda and (old.status not in('rascunho','digitacao') or exists(select 1 from public.pedido_itens where pedido_id=old.id)) then raise exception 'Escolha a modalidade antes de incluir os itens';end if;
 if tg_op='UPDATE' and old.modalidade_venda='intermediacao' and (new.centro_id is distinct from old.centro_id or new.data_pedido is distinct from old.data_pedido) and exists(select 1 from public.pedido_itens where pedido_id=old.id) then raise exception 'Remova os itens antes de alterar a loja ou data de um pedido de intermediação';end if;
 if new.modalidade_venda='intermediacao' then new.frete_volume_opcao:='dispensar'; new.frete_volume_ativo:=false;new.frete_volume_valor:=0;new.frete_volume_detalhes:='[]';end if;
 return new;
end $$;
revoke all on function public.modalidade_pedido_296() from public,anon,authenticated,service_role;
drop trigger if exists aa_modalidade_296 on public.pedidos;
create trigger aa_modalidade_296 before insert or update on public.pedidos for each row execute function public.modalidade_pedido_296();

create or replace function public.definir_modalidade_pedido_296(_pedido uuid,_modalidade text) returns void
language plpgsql security definer set search_path=public as $$declare p public.pedidos;begin
 select * into p from public.pedidos where id=_pedido for update;
 if not public.usuario_ativo() or not public.can_operate(auth.uid()) or p.id is null or not public.usuario_pode_acessar_centro(p.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',_pedido)) then raise exception 'Pedido sem acesso';end if;
 if _modalidade not in('estoque','intermediacao') or _modalidade is null then raise exception 'Modalidade inválida';end if;
 update public.pedidos set modalidade_venda=_modalidade where id=_pedido;
 perform public.recalcular_pedido(_pedido);
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',_pedido,'modalidade_venda',auth.uid(),jsonb_build_object('anterior',p.modalidade_venda,'nova',_modalidade));
end $$;
revoke all on function public.definir_modalidade_pedido_296(uuid,text) from public,anon;
grant execute on function public.definir_modalidade_pedido_296(uuid,text) to authenticated;

create or replace function public.item_intermediacao_296() returns trigger
language plpgsql security definer set search_path=public as $$declare p public.pedidos;q public.intermediacao_cotacoes_296;begin
 if tg_op='UPDATE' and new.pedido_id is distinct from old.pedido_id and exists(select 1 from public.pedidos where id in(old.pedido_id,new.pedido_id) and modalidade_venda='intermediacao') then raise exception 'Itens de intermediação não podem ser transferidos entre pedidos';end if;
 select * into p from public.pedidos where id=coalesce(new.pedido_id,old.pedido_id) for update;
 if p.modalidade_venda<>'intermediacao' then
  if tg_op<>'DELETE' and (new.cotacao_intermediacao_id is not null or new.custo_fabrica_saca is not null or new.frete_saca is not null or new.margem_saca is not null) then raise exception 'Custos de intermediação não se aplicam à venda do estoque';end if;
  return coalesce(new,old);
 end if;
 if tg_op='DELETE' then
  if p.status not in('rascunho','digitacao','aguardando_aprovacao') then raise exception 'Item de intermediação já confirmado não pode ser excluído';end if;
  return old;
 end if;
 if tg_op='UPDATE' and (new.produto_id,new.pedido_id,new.quantidade,new.preco_unitario,new.desconto_percentual,new.cotacao_intermediacao_id,new.custo_fabrica_saca,new.frete_saca,new.margem_saca,new.custo_unitario_base) is not distinct from (old.produto_id,old.pedido_id,old.quantidade,old.preco_unitario,old.desconto_percentual,old.cotacao_intermediacao_id,old.custo_fabrica_saca,old.frete_saca,old.margem_saca,old.custo_unitario_base) then return new;end if;
 if p.status not in('rascunho','digitacao','aguardando_aprovacao') then raise exception 'Custos e quantidade de intermediação são imutáveis após aprovação';end if;
 if not public.usuario_ativo() or not public.can_operate(auth.uid()) or not public.pode_alterar_preco(auth.uid()) or not public.usuario_pode_acessar_centro(p.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',p.id)) then raise exception 'Sem permissão para precificar intermediação';end if;
 select * into q from public.intermediacao_cotacoes_296 where id=new.cotacao_intermediacao_id;
 if q.id is null or q.centro_id is distinct from p.centro_id or q.produto_id is distinct from new.produto_id or q.dia is distinct from p.data_pedido then raise exception 'Selecione uma cotação do produto na data e loja do pedido';end if;
 if (tg_op='INSERT' or new.cotacao_intermediacao_id is distinct from old.cotacao_intermediacao_id) and exists(select 1 from public.intermediacao_cotacoes_296 where centro_id=q.centro_id and produto_id=q.produto_id and dia=q.dia and revisao>q.revisao) then raise exception 'A cotação mudou. Atualize antes de incluir ou reaplicar o custo';end if;
 if new.quantidade is null or new.quantidade::text in('NaN','Infinity','-Infinity') or new.quantidade<=0 or new.quantidade<>trunc(new.quantidade) then raise exception 'Informe uma quantidade inteira de sacas maior que zero';end if;
 if new.frete_saca is null or new.margem_saca is null or new.frete_saca::text in('NaN','Infinity','-Infinity') or new.margem_saca::text in('NaN','Infinity','-Infinity') or new.frete_saca<0 or new.margem_saca<0 then raise exception 'Frete e margem por saca devem ser valores não negativos';end if;
 if coalesce(new.desconto_percentual,0)<>0 then raise exception 'Ajuste a margem por saca em vez de descontar o custo da fábrica ou frete';end if;
 if new.preco_unitario is distinct from round(q.custo_fabrica+new.frete_saca+new.margem_saca,4) then raise exception 'Preço deve ser cotação da fábrica + frete por saca + margem por saca';end if;
 new.custo_fabrica_saca:=q.custo_fabrica;new.custo_unitario_base:=round(q.custo_fabrica+new.frete_saca,4);return new;
end $$;
revoke all on function public.item_intermediacao_296() from public,anon,authenticated,service_role;
drop trigger if exists aa_item_intermediacao_296 on public.pedido_itens;
create trigger aa_item_intermediacao_296 before insert or update or delete on public.pedido_itens for each row execute function public.item_intermediacao_296();

create or replace function public.salvar_item_intermediacao_296(_pedido uuid,_item uuid,_produto uuid,_quantidade numeric,_cotacao uuid,_frete numeric,_margem numeric) returns public.pedido_itens
language plpgsql security definer set search_path=public as $$declare p public.pedidos;q public.intermediacao_cotacoes_296;i public.pedido_itens;begin
 select * into p from public.pedidos where id=_pedido for update;
 if not public.usuario_ativo() or not public.can_operate(auth.uid()) or p.id is null or p.modalidade_venda<>'intermediacao' or not public.usuario_pode_acessar_centro(p.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',_pedido)) then raise exception 'Pedido de intermediação sem acesso';end if;
 select * into q from public.intermediacao_cotacoes_296 where id=_cotacao;
 if _item is null then
  insert into public.pedido_itens(pedido_id,produto_id,quantidade,preco_unitario,desconto_percentual,cotacao_intermediacao_id,frete_saca,margem_saca) values(_pedido,_produto,_quantidade,round(q.custo_fabrica+_frete+_margem,4),0,_cotacao,round(_frete,4),round(_margem,4)) returning * into i;
 else
  select * into i from public.pedido_itens where id=_item and pedido_id=_pedido for update;
  if i.id is null or i.produto_id is distinct from _produto then raise exception 'Item de outro pedido ou produto';end if;
  update public.pedido_itens set quantidade=_quantidade,preco_unitario=round(q.custo_fabrica+_frete+_margem,4),cotacao_intermediacao_id=_cotacao,frete_saca=round(_frete,4),margem_saca=round(_margem,4) where id=_item returning * into i;
 end if;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedido_itens',i.id,'precificar_intermediacao_296',auth.uid(),jsonb_build_object('cotacao',i.cotacao_intermediacao_id,'fabrica_saca',i.custo_fabrica_saca,'frete_saca',i.frete_saca,'margem_saca',i.margem_saca,'quantidade',i.quantidade,'preco_unitario',i.preco_unitario));
 perform public.recalcular_pedido(_pedido);return i;
end $$;
revoke all on function public.salvar_item_intermediacao_296(uuid,uuid,uuid,numeric,uuid,numeric,numeric) from public,anon;
grant execute on function public.salvar_item_intermediacao_296(uuid,uuid,uuid,numeric,uuid,numeric,numeric) to authenticated;

-- Última barreira: nenhum caminho alternativo pode criar estoque físico fictício.
create or replace function public.estoque_intermediacao_296() returns trigger
language plpgsql security definer set search_path=public as $$declare pid uuid;begin
 if tg_table_name='estoque_reservas' then pid:=new.pedido_id;
 elsif new.origem in('pedido','pedido_cancelado') then pid:=new.documento_id;
 elsif new.origem='devolucao' then select pedido_id into pid from public.devolucoes where id=new.documento_id;end if;
 if exists(select 1 from public.pedidos where id=pid and modalidade_venda='intermediacao') then raise exception 'Intermediação não movimenta nem reserva estoque da loja';end if;
 return new;
end $$;
revoke all on function public.estoque_intermediacao_296() from public,anon,authenticated,service_role;
drop trigger if exists a_estoque_intermediacao_296 on public.estoque_movimentos;
create trigger a_estoque_intermediacao_296 before insert or update on public.estoque_movimentos for each row execute function public.estoque_intermediacao_296();
drop trigger if exists a_reserva_intermediacao_296 on public.estoque_reservas;
create trigger a_reserva_intermediacao_296 before insert or update on public.estoque_reservas for each row execute function public.estoque_intermediacao_296();

-- Mudanças locais e verificadas, preservando assinatura, OID, ACL e guardas dos motores existentes.
do $patch296$declare r record;d text;begin
 for r in select * from (values
 ('public.confirmar_pedido(uuid)',$old296$  for item in
    select produto_id, sum(quantidade) qtd
    from public.pedido_itens
    where pedido_id = _pedido_id
    group by produto_id
  loop
    perform public.registrar_movimento_estoque_controlado(
      item.produto_id, ped.centro_id, 'saida', item.qtd, null,
      'pedido', _pedido_id, 'Baixa por confirmacao de pedido'
    );
  end loop;$old296$,$new296$  -- intermediacao_confirmacao_296: financeiro/comissão continuam integrais.
  if ped.modalidade_venda<>'intermediacao' then
  for item in
    select produto_id, sum(quantidade) qtd
    from public.pedido_itens
    where pedido_id = _pedido_id
    group by produto_id
  loop
    perform public.registrar_movimento_estoque_controlado(
      item.produto_id, ped.centro_id, 'saida', item.qtd, null,
      'pedido', _pedido_id, 'Baixa por confirmacao de pedido'
    );
  end loop;
  end if;$new296$),
 ('public.confirmar_pedido(uuid)',$old296$  update public.pedidos set status='confirmado' where id=_pedido_id returning * into ped;$old296$,$new296$  -- intermediacao_prova_296
  if ped.modalidade_venda='intermediacao' then
    insert into public.intermediacao_confirmacoes_296(pedido_id,ciclo,valor,created_by) values(ped.id,ped.ciclo_reabertura_289,ped.total_liquido,auth.uid()) on conflict(pedido_id,ciclo) do nothing;
  end if;
  update public.pedidos set status='confirmado' where id=_pedido_id returning * into ped;$new296$),
 ('public.pedido_confirmado_logistica_233(uuid)',$old296$and exists(select 1 from public.estoque_movimentos m where m.documento_id=p.id and m.origem='pedido' and m.tipo='saida')$old296$,$new296$and (exists(select 1 from public.estoque_movimentos m where m.documento_id=p.id and m.origem='pedido' and m.tipo='saida') or (p.modalidade_venda='intermediacao' and exists(select 1 from public.intermediacao_confirmacoes_296 cf where cf.pedido_id=p.id and cf.ciclo=p.ciclo_reabertura_289)))$new296$),
 ('public.reservar_pedido_212()',$old296$begin$old296$,$new296$begin
 -- intermediacao_reserva_296
 if new.modalidade_venda='intermediacao' then
  if not public.usuario_ativo() or not public.usuario_pode_acessar_centro(new.centro_id) then raise exception 'Pedido sem acesso';end if;
  return new;
 end if;$new296$),
 ('public.validar_pedido(uuid)',$old296$p.descricao, p.estoque_atual, p.custo_medio, p.margem_minima$old296$,$new296$p.descricao, p.estoque_atual, case when ped.modalidade_venda='intermediacao' then pi.custo_unitario_base else p.custo_medio end as custo_medio, p.margem_minima$new296$),
 ('public.validar_pedido(uuid)',$old296$if item.quantidade > coalesce(item.estoque_atual,0) then$old296$,$new296$if ped.modalidade_venda<>'intermediacao' and item.quantidade > coalesce(item.estoque_atual,0) then$new296$),
 ('public.confirmar_devolucao(uuid)',$old296$    insert into public.estoque_movimentos
      (produto_id,centro_id,tipo,quantidade,custo_unitario,origem,documento_id,observacao,created_by)
    values
      (it.produto_id,dev.centro_id,'entrada',it.qtd,
       case when it.qtd<>0 then it.total/it.qtd else 0 end,
       'devolucao',dev.id,'Entrada de devolucao '||dev.numero,auth.uid());$old296$,$new296$    -- intermediacao_devolucao_296: retorno à fábrica, sem entrada fictícia na loja.
    if coalesce(ped.modalidade_venda,'estoque')<>'intermediacao' then
    insert into public.estoque_movimentos
      (produto_id,centro_id,tipo,quantidade,custo_unitario,origem,documento_id,observacao,created_by)
    values
      (it.produto_id,dev.centro_id,'entrada',it.qtd,
       case when it.qtd<>0 then it.total/it.qtd else 0 end,
       'devolucao',dev.id,'Entrada de devolucao '||dev.numero,auth.uid());
    end if;$new296$),
 ('public.confirmar_devolucao(uuid)',$old296$'Devolucao '||dev.numero||' retornou ao estoque e gerou credito ao cliente.'$old296$,$new296$'Devolucao '||dev.numero||case when ped.modalidade_venda='intermediacao' then ' registrada sem movimentar o estoque da loja e gerou credito ao cliente.' else ' retornou ao estoque e gerou credito ao cliente.' end$new296$),
 ('public.calcular_frete_volume_250(uuid)',$old296$if ped250.id is null or ped250.status not in ('rascunho','digitacao') then return;end if;$old296$,$new296$if ped250.id is null or ped250.status not in ('rascunho','digitacao') then return;end if;
 -- intermediacao_frete_296: frete já compõe cada saca, sem duplicar cobrança.
 if ped250.modalidade_venda='intermediacao' then return;end if;$new296$),
 ('public.salvar_parametros_loja_243(uuid,jsonb)',$old296$'exigir_nf_boleto','alerta_estoque_minimo'$old296$,$new296$'exigir_nf_boleto','alerta_estoque_minimo','intermediacao_habilitada'$new296$)
 ) as x(assinatura,trecho,novo) loop
  select pg_get_functiondef(r.assinatura::regprocedure) into d;
  if position(r.novo in d)>0 then continue;end if;
  if position(r.trecho in d)=0 then raise exception 'Motor incompatível com a fase296: %',r.assinatura;end if;
  execute replace(d,r.trecho,r.novo);
 end loop;
end $patch296$;
-- CPV da modalidade usa custo fábrica+frete congelado, mantendo as demais vendas.
do $$declare d text;begin
 select pg_get_viewdef('public.vw_cpv'::regclass,true) into d;
 if position('modalidade_venda' in d)=0 then
  if position('COALESCE(pr.custo_medio, pr.preco_custo, pr.ultimo_custo, 0::numeric)' in d)=0 then raise exception 'CPV incompatível com a fase296';end if;
  d:=replace(d,'COALESCE(pr.custo_medio, pr.preco_custo, pr.ultimo_custo, 0::numeric)', $expr$case when p.modalidade_venda='intermediacao' then coalesce(i.custo_unitario_base,0) else COALESCE(pr.custo_medio, pr.preco_custo, pr.ultimo_custo, 0::numeric) end$expr$);
  execute 'create or replace view public.vw_cpv with(security_invoker=on) as '||d;
 end if;
end $$;
-- Vendas diretas não são consumo nem pendência do estoque físico da loja.
do $$declare n text;d text;begin
 foreach n in array array['vw_planejamento_compras_294','vw_sugestao_compras_centro'] loop
  select pg_get_viewdef(('public.'||n)::regclass,true) into d;
  if position('modalidade_venda' in d)>0 then continue;end if;
  if n='vw_planejamento_compras_294' then
   d:=replace(d,'WHERE (ped.status', $expr$WHERE ped.modalidade_venda='estoque' and (ped.status$expr$);
   d:=replace(d,'WHERE ped.status', $expr$WHERE ped.modalidade_venda='estoque' and ped.status$expr$);
  else
   d:=replace(d,'WHERE ped.centro_id IS NOT NULL', $expr$WHERE ped.modalidade_venda='estoque' and ped.centro_id IS NOT NULL$expr$);
  end if;
  if position('modalidade_venda' in d)=0 then raise exception 'Planejamento incompatível com a fase296: %',n;end if;
  execute 'create or replace view public.'||quote_ident(n)||' with(security_invoker=on,security_barrier=on) as '||d;
 end loop;
end $$;
-- Identificação operacional da entrega direta na fila de separação.
do $$declare d text;begin
 if to_regclass('public.vw_separacao') is not null and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='vw_separacao' and column_name='modalidade_venda') then
  select pg_get_viewdef('public.vw_separacao'::regclass,true) into d;
  execute 'create or replace view public.vw_separacao with(security_invoker=on,security_barrier=on) as select origem296.*, p296.modalidade_venda from ('||rtrim(d,'; '||chr(10))||') origem296 join public.pedidos p296 on p296.id=origem296.pedido_id';
 end if;
end $$;
notify pgrst,'reload schema';
commit;
