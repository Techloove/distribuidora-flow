-- Mínimo por loja = venda líquida no período / dias da média * dias de cobertura.
-- A leitura calcula o valor vigente; não altera saldo físico nem preços.
begin;
insert into public.parametros(chave,valor,descricao) values
 ('estoque_media_dias','90','Período da média de vendas para estoque mínimo (dias)'),
 ('estoque_cobertura_dias','30','Dias de vendas que o estoque mínimo deve cobrir')
on conflict(chave) do nothing;
insert into public.loja_parametros(centro_id,chave,valor)
 select c.id,p.chave,p.valor from public.centros c cross join public.parametros p
 where p.chave in('estoque_media_dias','estoque_cobertura_dias') on conflict do nothing;

-- Reutiliza as permissões e auditoria da configuração da loja, sem substituir regras instaladas.
do $$declare d text;begin
 select pg_get_functiondef('public.salvar_parametros_loja_243(uuid,jsonb)'::regprocedure) into d;
 if position('-- estoque_config_379' in d)=0 then
  if position('elsif r.key=''comissao_fato_gerador'' then' in d)=0 then raise exception 'Configuração da loja incompatível com fase379';end if;
  d:=replace(d,'elsif r.key=''comissao_fato_gerador'' then',
  'elsif r.key in (''estoque_media_dias'',''estoque_cobertura_dias'') then -- estoque_config_379
   if v!~''^[0-9]{1,4}$'' or v::integer not between 1 and 3650 then raise exception ''Informe de 1 a 3650 dias para %'',r.key;end if;
  elsif r.key=''comissao_fato_gerador'' then');
  execute d;
 end if;
end $$;

create or replace function public.estoque_minimos_interno_379(_centro uuid,_produto uuid default null)
returns table(produto_id uuid,estoque_minimo numeric,media_diaria numeric,venda_periodo numeric,periodo_dias integer,cobertura_dias integer)
language sql stable security definer set search_path=public,pg_temp as $$
 with cfg as (
  select (now() at time zone 'America/Sao_Paulo')::date hoje,
  coalesce(max(case when chave='estoque_media_dias' and valor~'^[0-9]{1,4}$' then greatest(1,least(valor::integer,3650)) end),90) periodo,
  coalesce(max(case when chave='estoque_cobertura_dias' and valor~'^[0-9]{1,4}$' then greatest(1,least(valor::integer,3650)) end),30) cobertura
  from public.parametros_da_loja_243(_centro)
 ), vendidos as materialized (
  select ped.id,pi.produto_id,sum(pi.quantidade) quantidade
  from public.pedidos ped join public.pedido_itens pi on pi.pedido_id=ped.id cross join cfg c
  where ped.centro_id=_centro and ped.data_pedido between c.hoje-(c.periodo-1) and c.hoje
  and ped.tipo_documento='pedido' and ped.modalidade_venda='estoque'
  and ped.status in('confirmado','separacao','separado','conferido','faturado','nf_emitida','em_carga','em_rota','entregue','parcial','nao_entregue','devolvido')
  and (_produto is null or pi.produto_id=_produto)
  group by ped.id,pi.produto_id
 ), retornos as (
  select v.id,v.produto_id,sum(di.quantidade) quantidade from vendidos v
  join public.devolucoes d on d.pedido_id=v.id and d.status='confirmada'
  join public.devolucao_itens di on di.devolucao_id=d.id and di.produto_id=v.produto_id
  group by v.id,v.produto_id
 ), totais as (
  select v.produto_id,sum(greatest(v.quantidade-coalesce(d.quantidade,0),0)) quantidade
  from vendidos v left join retornos d on d.id=v.id and d.produto_id=v.produto_id group by v.produto_id
 )
 select p.id,ceil(coalesce(t.quantidade,0)*c.cobertura*1000/c.periodo)/1000,
 coalesce(t.quantidade,0)/c.periodo,coalesce(t.quantidade,0),c.periodo,c.cobertura
 from public.produtos p join public.centros l on l.id=_centro and l.ativo
 join public.cad_categorias k on k.id=l.categoria_produtos_id and k.nome_norm=public.norm_txt(p.categoria)
 cross join cfg c left join totais t on t.produto_id=p.id
 where p.ativo and (_produto is null or p.id=_produto);
$$;
revoke all on function public.estoque_minimos_interno_379(uuid,uuid) from public,anon,authenticated,service_role;
create or replace function public.estoque_minimos_loja_379(_centro uuid)
returns table(produto_id uuid,estoque_minimo numeric,media_diaria numeric,venda_periodo numeric,periodo_dias integer,cobertura_dias integer)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.usuario_ativo() or _centro is null or not public.usuario_pode_acessar_centro(_centro) then raise exception 'Loja sem acesso';end if;
 return query select * from public.estoque_minimos_interno_379(_centro);
end $$;
revoke all on function public.estoque_minimos_loja_379(uuid) from public,anon;
grant execute on function public.estoque_minimos_loja_379(uuid) to authenticated,service_role;

-- Projeções atuais e legadas mantêm contratos, custos e políticas de leitura.
do $$declare n text;d text;begin
 foreach n in array array['vw_planejamento_compras_294','vw_planejamento_compras','vw_planejamento_compras_mod_300','vw_sugestao_compras_centro','vw_sugestao_compras_centro_mod_300'] loop
  if to_regclass('public.'||n) is null then continue;end if;
  select pg_get_viewdef(('public.'||n)::regclass,true) into d;
  if position('estoque_minimos_loja_379' in d)>0 then continue;end if;
  if d!~'p\.estoque_minimo' then raise exception 'Projeção de estoque incompatível: %',n;end if;
  -- Uma agregação por loja, não uma consulta para cada linha de produto.
  d:=regexp_replace(d,'^\s*WITH\s+','WITH minimos_379 AS (select cx.id centro_id,m.produto_id,m.estoque_minimo from public.centros cx cross join lateral public.estoque_minimos_loja_379(cx.id) m where cx.ativo and public.usuario_pode_acessar_centro(cx.id)), ','i');
  d:=regexp_replace(d,'(\n[[:space:]]*)p\.estoque_minimo,','\1p.estoque_minimo AS estoque_minimo,','g');
  d:=replace(d,'p.estoque_minimo','coalesce(m379.estoque_minimo,0)::numeric(14,3)');
  if d!~*'WHERE p\.ativo' then raise exception 'Escopo de produtos incompatível: %',n;end if;
  d:=regexp_replace(d,'WHERE p\.ativo','LEFT JOIN minimos_379 m379 ON m379.centro_id=c.id AND m379.produto_id=p.id WHERE p.ativo','i');
  -- O filtro de loja pode ser propagado ao cálculo, sem materializar outras lojas.
  execute format('create or replace view public.%I with(security_invoker=true) as %s',n,d);
 end loop;
end $$;

-- Mesma quantidade calculada nos alertas dos dashboards, inclusive filtro de modalidade.
do $$declare f record;d text;begin
 for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in('dashboard_resumo','dashboard_resumo_mod_300','dashboard_resumo_mes_307','dashboard_resumo_mes_307_mod_300') loop
  select pg_get_functiondef(f.oid) into d;
  if position('-- estoque_alertas_379' in d)>0 then continue;end if;
  if d!~'alertas as \(' then raise exception 'Dashboard incompatível com fase379: %',f.proname;end if;
  d:=regexp_replace(d,'alertas as \([\s\S]*?\)\s*select jsonb_build_object',
  'alertas as ( -- estoque_alertas_379
    select p.id,p.descricao,coalesce(s.quantidade,0)::numeric(14,3) estoque_atual,m.estoque_minimo
    from public.centros cx cross join lateral public.estoque_minimos_loja_379(cx.id) m
    join public.produtos p on p.id=m.produto_id
    left join public.estoque_saldos s on s.centro_id=cx.id and s.produto_id=p.id
    where cx.ativo and public.usuario_pode_acessar_centro(cx.id) and (_centro_id is null or cx.id=_centro_id)
    and coalesce(s.quantidade,0)<=m.estoque_minimo
    order by coalesce(s.quantidade,0)-m.estoque_minimo,p.id limit 8
  ) select jsonb_build_object','i');
  if position('-- estoque_alertas_379' in d)=0 then raise exception 'Não foi possível atualizar os alertas';end if;
  execute d;
 end loop;
end $$;

-- O antigo disparo dependia do mínimo manual global; o novo respeita a loja do saldo.
drop trigger if exists produtos_alerta_estoque on public.produtos;
create or replace function public.alertar_estoque_minimo_379() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare minimo numeric;descr text;loja text;
begin
 if new.quantidade>=old.quantidade then return new;end if;
 if not exists(select 1 from public.parametros_da_loja_243(new.centro_id) where chave='alerta_estoque_minimo' and valor='true') then return new;end if;
 select m.estoque_minimo into minimo from public.estoque_minimos_interno_379(new.centro_id,new.produto_id) m;
 if minimo>0 and new.quantidade<=minimo and old.quantidade>minimo then
  select descricao into descr from public.produtos where id=new.produto_id;
  select nome into loja from public.centros where id=new.centro_id;
  perform public.notificar('Estoque mínimo: '||descr,'Loja '||loja||': saldo '||new.quantidade||' / mínimo '||minimo||'.','alerta','/estoque');
 end if;
 return new;
end $$;
revoke all on function public.alertar_estoque_minimo_379() from public,anon,authenticated,service_role;
drop trigger if exists estoque_minimo_379 on public.estoque_saldos;
create trigger estoque_minimo_379 after update of quantidade on public.estoque_saldos for each row execute function public.alertar_estoque_minimo_379();
notify pgrst,'reload schema';
commit;
