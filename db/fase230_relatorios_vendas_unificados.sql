-- Fase230: Relatórios de Vendas unificados, apuração integral no servidor.
-- Aplicar após fase229. Somente leituras e migração de acessos; não altera vendas/estoque.
begin;
do $$ declare novo text; begin
 if to_regprocedure('public.agenda_leads_229(uuid,uuid,uuid,text,text,text,text,text,integer)') is null then
  raise exception 'Aplique a fase229 antes da fase230';
 end if;
 insert into public.permissoes(codigo,nome,grupo,ordem,modulo)
 values('vendas_rentabilidade_ver','Consultar custos e rentabilidade das vendas','Relatórios',132,'/relatorio-vendas')
 on conflict(codigo) do nothing returning codigo into novo;
 insert into public.permissoes(codigo,nome,grupo,ordem,modulo)
 values('vendas_relatorio_ver','Consultar Relatórios de Vendas','Relatórios',131,'/relatorio-vendas')
 on conflict(codigo) do update set nome=excluded.nome,modulo=excluded.modulo,grupo=excluded.grupo;
 if novo is not null then
  insert into public.role_permissoes(role,permissao)
  select distinct m.role::text,'vendas_relatorio_ver' from public.role_menus m where m.path in ('/relatorios','/relatorio-vendas') on conflict do nothing;
  insert into public.role_permissoes(role,permissao)
  select distinct m.role::text,'vendas_rentabilidade_ver' from public.role_menus m
   join public.role_permissoes rp on rp.role=m.role::text and rp.permissao='margem_pedido_ver'
   where m.path in ('/relatorios','/relatorio-vendas') on conflict do nothing;
 end if;
end $$;
insert into public.role_menus(role,path) select role,'/relatorio-vendas' from public.role_menus where path='/relatorios' on conflict do nothing;
delete from public.role_menus where path='/relatorios';
update public.permissoes set modulo='/relatorio-vendas' where modulo='/relatorios';

create or replace function public.relatorio_vendas_230(
 _inicio date,_fim date,_centro uuid default null,_representante uuid default null,
 _rota uuid default null,_cidade text default '',_busca text default '',_status text default '',
 _grupo text default 'rota',_ordem text default 'vendas',_asc boolean default false,
 _pagina integer default 0,_pagina_pedidos integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare saida jsonb; rentabilidade boolean; dias integer;
begin
 if not public.usuario_ativo() or not public.pode_rotina('vendas_relatorio_ver') then raise exception 'Relatórios de Vendas não liberados para seu perfil'; end if;
 rentabilidade:=public.pode_rotina('vendas_rentabilidade_ver');
 if _inicio is null or _fim is null or _fim<_inicio or _fim-_inicio>366 then raise exception 'Selecione um intervalo de até 367 dias'; end if;
 if _centro is not null and not public.usuario_pode_acessar_centro(_centro) then raise exception 'Centro sem acesso'; end if;
 if public.escopo_representante() and _representante is not null and _representante is distinct from public.meu_representante_id() then raise exception 'Carteira de outro representante'; end if;
 if _grupo is null or _grupo not in ('rota','cidade','representante','cliente','centro','mes') or _ordem is null or _ordem not in ('vendas','lucro_bruto','lucro_liquido','lucro_bruto_sem','lucro_liquido_sem','margem','margem_sem','pedidos','comissao','peso') then raise exception 'Agrupamento ou ordenação inválidos'; end if;
 if not rentabilidade and _ordem in ('lucro_bruto','lucro_liquido','lucro_bruto_sem','lucro_liquido_sem','margem','margem_sem') then raise exception 'Rentabilidade não liberada para seu perfil'; end if;
 if _pagina is null or _pagina<0 or _pagina>100000 or _pagina_pedidos is null or _pagina_pedidos<0 or _pagina_pedidos>100000 or _asc is null then raise exception 'Página inválida'; end if;
 if _status is null or (_status<>'' and _status<>all(array['confirmado','separacao','separado','conferido','faturado','nf_emitida','em_carga','em_rota','entregue','parcial','nao_entregue','devolvido'])) then raise exception 'Situação não elegível para vendas'; end if;
 dias:=_fim-_inicio+1;
 with escopo as materialized (
  select p.*,c.razao_social cliente,c.codigo codigo_cliente,coalesce(c.cidade,'') cidade,coalesce(c.uf,'') uf,
   coalesce(r.nome,'Sem representante') representante,coalesce(rt.nome,'Sem rota') rota,coalesce(ce.nome,'Sem centro') centro,
   to_char(p.data_pedido,'YYYY-MM') mes,case when p.data_pedido>=_inicio then 'atual' else 'anterior' end periodo
  from public.pedidos p join public.clientes c on c.id=p.cliente_id
  left join public.representantes r on r.id=p.representante_id left join public.rotas rt on rt.id=p.rota_id
  left join public.centros ce on ce.id=p.centro_id
  where p.data_pedido between _inicio-dias and _fim
   and p.status in ('confirmado','separacao','separado','conferido','faturado','nf_emitida','em_carga','em_rota','entregue','parcial','nao_entregue','devolvido')
   and public.usuario_pode_acessar_centro(p.centro_id)
   and (not public.escopo_representante() or (public.cliente_na_minha_carteira(p.cliente_id) and p.representante_id=public.meu_representante_id()))
   and (_centro is null or p.centro_id=_centro) and (_representante is null or p.representante_id=_representante)
   and (_rota is null or p.rota_id=_rota) and (coalesce(_cidade,'')='' or c.cidade||case when coalesce(c.uf,'')<>'' then ' / '||c.uf else '' end=_cidade)
   and (coalesce(_busca,'')='' or position(lower(trim(_busca)) in lower(c.razao_social||' '||coalesce(c.codigo::text,'')))>0)
   and (_status='' or p.status=_status)
 ), itens as materialized (
  select i.pedido_id,i.produto_id,sum(i.quantidade) quantidade,sum(i.total) total,
   sum(i.quantidade*coalesce(i.custo_unitario_base,nullif(pr.custo_medio,0),nullif(pr.preco_custo,0),nullif(pr.ultimo_custo,0),0)) custo,
   count(*) filter(where coalesce(i.custo_unitario_base,nullif(pr.custo_medio,0),nullif(pr.preco_custo,0),nullif(pr.ultimo_custo,0),0)<=0) sem_custo,
   sum(i.quantidade*coalesce(pr.peso_kg,0)) peso,
   count(*) filter(where i.custo_unitario_base is null) custo_atual
  from public.pedido_itens i join escopo e on e.id=i.pedido_id join public.produtos pr on pr.id=i.produto_id group by i.pedido_id,i.produto_id
 ), devolucoes as materialized (
  select d.pedido_id,sum(d.valor_total) valor from public.devolucoes d join escopo e on e.id=d.pedido_id
  where d.status='confirmada' and public.usuario_pode_acessar_centro(d.centro_id) group by d.pedido_id
 ), retorno_custo as (
  select d.pedido_id,sum(di.quantidade*coalesce(i.custo/nullif(i.quantidade,0),0)) custo
  from public.devolucoes d join escopo e on e.id=d.pedido_id join public.devolucao_itens di on di.devolucao_id=d.id
  left join itens i on i.pedido_id=d.pedido_id and i.produto_id=di.produto_id
  where d.status='confirmada' and di.condicao='revenda' and public.usuario_pode_acessar_centro(d.centro_id) group by d.pedido_id
 ), custos as (
  select pedido_id,sum(custo) custo,sum(sem_custo) sem_custo,sum(peso) peso,sum(custo_atual) custo_atual from itens group by pedido_id
 ), comissoes as (
  select cm.pedido_id,sum(cm.valor) valor,sum(cm.valor) filter(where cm.status='paga') paga,
   sum(cm.valor) filter(where cm.status in ('prevista','liberada')) a_pagar
  from public.comissoes cm join escopo e on e.id=cm.pedido_id
  where cm.status<>'cancelada' and public.usuario_pode_acessar_centro(cm.centro_id)
   and (not public.escopo_representante() or cm.representante_id=public.meu_representante_id()) group by cm.pedido_id
 ), base as materialized (
  select e.id pedido_id,e.numero,e.data_pedido,e.cliente_id,e.cliente,e.codigo_cliente,e.representante_id,e.representante,
   e.rota_id,e.rota,e.centro_id,e.centro,e.cidade||case when e.uf<>'' then ' / '||e.uf else '' end cidade,e.mes,e.status,e.periodo,
   coalesce(e.total_itens,0) bruto,coalesce(e.desconto_valor,0)+coalesce(e.forma_desconto_valor,0) descontos,
   coalesce(e.frete_valor,0) frete_cobrado,coalesce(e.forma_acrescimo_valor,0) acrescimos,
   coalesce(e.total_liquido,0) vendido,coalesce(d.valor,0) devolucoes,
   coalesce(e.total_liquido,0)-coalesce(d.valor,0) vendas,
   coalesce(cm.valor,case when exists(select 1 from public.comissoes cx where cx.pedido_id=e.id) then 0 else e.comissao_valor end,0) comissao,
   coalesce(cm.paga,0) comissao_paga,coalesce(cm.a_pagar,0) comissao_a_pagar,
   coalesce(c.peso,0) peso,
   case when rentabilidade then coalesce(c.custo,0)-coalesce(rc.custo,0) end custo,
   case when rentabilidade then e.custo_frete end frete,
   case when rentabilidade then e.tributos_estimados end tributos,
   case when rentabilidade then e.despesas_variaveis end despesas,
   case when rentabilidade then coalesce(c.sem_custo,1) end sem_custo,
   case when rentabilidade then coalesce(c.custo_atual,0) end custo_atual
  from escopo e left join custos c on c.pedido_id=e.id left join devolucoes d on d.pedido_id=e.id
   left join retorno_custo rc on rc.pedido_id=e.id left join comissoes cm on cm.pedido_id=e.id
 ), calculos as materialized (
  select b.*,vendas-custo lucro_bruto_sem,vendas-custo-comissao lucro_bruto_com,
   vendas-custo-frete-tributos-despesas lucro_liquido_sem,
   vendas-custo-frete-tributos-despesas-comissao lucro_liquido_com from base b
 ), atual as materialized(select * from calculos where periodo='atual'),
 totais as (
  select periodo,count(*) pedidos,sum(vendido) vendido,sum(vendas) vendas,sum(bruto) bruto,sum(descontos) descontos,
   sum(devolucoes) devolucoes,sum(comissao) comissao,sum(peso) peso,sum(custo) custo,sum(frete) frete,
   sum(tributos) tributos,sum(despesas) despesas,sum(sem_custo) sem_custo,sum(custo_atual) custo_atual,
   sum(lucro_bruto_sem) lucro_bruto_sem,sum(lucro_bruto_com) lucro_bruto_com,
   sum(lucro_liquido_sem) lucro_liquido_sem,sum(lucro_liquido_com) lucro_liquido_com,
   round(sum(lucro_liquido_com)/nullif(sum(vendas),0)*100,2) margem,
   round(sum(vendas)/nullif(count(*),0),2) ticket
  from calculos group by periodo
 ), grupos as (
  select case _grupo when 'rota' then coalesce(rota_id::text,'sem-rota') when 'cidade' then cidade when 'representante' then coalesce(representante_id::text,'sem-representante') when 'cliente' then cliente_id::text when 'centro' then coalesce(centro_id::text,'sem-centro') else mes end chave,
   case _grupo when 'rota' then rota when 'cidade' then coalesce(nullif(cidade,''),'Sem cidade') when 'representante' then representante when 'cliente' then coalesce(codigo_cliente::text||' · ','')||cliente when 'centro' then centro else mes end nome,
   count(*) pedidos,sum(vendas) vendas,sum(comissao) comissao,sum(peso) peso,
   sum(lucro_bruto_sem) lucro_bruto_sem,sum(lucro_bruto_com) lucro_bruto_com,sum(lucro_liquido_sem) lucro_liquido_sem,sum(lucro_liquido_com) lucro_liquido_com,
   round(sum(lucro_liquido_com)/nullif(sum(vendas),0)*100,2) margem,sum(sem_custo) sem_custo
  from atual group by 1,2
 ), classificados as (
  select g.*,row_number() over(order by
   case when _asc then case _ordem when 'vendas' then vendas when 'lucro_bruto' then lucro_bruto_com when 'lucro_liquido' then lucro_liquido_com when 'lucro_bruto_sem' then lucro_bruto_sem when 'lucro_liquido_sem' then lucro_liquido_sem when 'margem' then margem when 'margem_sem' then round(lucro_liquido_sem/nullif(vendas,0)*100,2) when 'pedidos' then pedidos when 'comissao' then comissao else peso end end asc nulls last,
   case when not _asc then case _ordem when 'vendas' then vendas when 'lucro_bruto' then lucro_bruto_com when 'lucro_liquido' then lucro_liquido_com when 'lucro_bruto_sem' then lucro_bruto_sem when 'lucro_liquido_sem' then lucro_liquido_sem when 'margem' then margem when 'margem_sem' then round(lucro_liquido_sem/nullif(vendas,0)*100,2) when 'pedidos' then pedidos when 'comissao' then comissao else peso end end desc nulls last,nome,chave) posicao from grupos g
 ), mensal as (
  select mes,count(*) pedidos,sum(vendas) vendas,sum(comissao) comissao,sum(lucro_liquido_com) lucro_liquido_com,sum(lucro_liquido_sem) lucro_liquido_sem from atual group by mes order by mes
 ), comparativo as (
  select coalesce(centro_id::text,'sem-centro')||'/'||periodo chave,centro,periodo,count(*) pedidos,sum(vendas) vendas,
   sum(lucro_liquido_com) lucro_liquido_com,sum(lucro_liquido_sem) lucro_liquido_sem
  from calculos where public.can_manage(auth.uid()) and public.pode_rotina('indicadores_comparar') group by centro_id,centro,periodo
 ), produtos as (
  select i.produto_id,pr.codigo,pr.descricao,sum(i.quantidade) quantidade,sum(i.total) total
  from itens i join atual a on a.pedido_id=i.pedido_id join public.produtos pr on pr.id=i.produto_id group by i.produto_id,pr.codigo,pr.descricao
 ), representantes as (
  select representante_id,representante,sum(comissao) comissao,sum(comissao_paga) paga,sum(comissao_a_pagar) a_pagar from atual group by representante_id,representante
 )
 select jsonb_build_object(
  'rentabilidade',rentabilidade,'totais',coalesce((select to_jsonb(t) from totais t where periodo='atual'),'{}'),
  'anterior',coalesce((select to_jsonb(t) from totais t where periodo='anterior'),'{}'),
  'ranking',coalesce((select jsonb_agg(to_jsonb(g) order by posicao) from classificados g where posicao>_pagina*50 and posicao<=(_pagina+1)*50),'[]'),
  'grupos',(select count(*) from grupos),'pedidos',coalesce((select jsonb_agg(to_jsonb(p) order by data_pedido desc,numero desc,pedido_id) from (select * from atual order by data_pedido desc,numero desc,pedido_id limit 50 offset _pagina_pedidos*50) p),'[]'),
  'comparativo',coalesce((select jsonb_agg(to_jsonb(c) order by centro,periodo) from comparativo c),'[]'),
  'mensal',coalesce((select jsonb_agg(to_jsonb(m) order by mes) from mensal m),'[]'),
  'produtos',coalesce((select jsonb_agg(to_jsonb(p) order by total desc,produto_id) from (select * from produtos order by total desc,produto_id limit 20) p),'[]'),
  'comissoes',coalesce((select jsonb_agg(to_jsonb(r) order by comissao desc,representante_id) from (select * from representantes order by comissao desc,representante_id limit 20) r),'[]'),
  'comparativo_inicio',_inicio-dias,'comparativo_fim',_inicio-1
 ) into saida;
 return saida;
end $$;
revoke all on function public.relatorio_vendas_230(date,date,uuid,uuid,uuid,text,text,text,text,text,boolean,integer,integer) from public,anon;
grant execute on function public.relatorio_vendas_230(date,date,uuid,uuid,uuid,text,text,text,text,text,boolean,integer,integer) to authenticated;
create or replace function public.relatorio_vendas_filtros_230()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare resultado jsonb;
begin
 if not public.usuario_ativo() or not public.pode_rotina('vendas_relatorio_ver') then raise exception 'Relatórios de Vendas não liberados para seu perfil'; end if;
 with escopo as materialized (
  select p.rota_id,p.representante_id,c.cidade,c.uf from public.pedidos p join public.clientes c on c.id=p.cliente_id
  where public.usuario_pode_acessar_centro(p.centro_id)
  and (not public.escopo_representante() or (public.cliente_na_minha_carteira(p.cliente_id) and p.representante_id=public.meu_representante_id()))
 ) select jsonb_build_object(
  'rotas',coalesce((select jsonb_agg(to_jsonb(r) order by nome,id) from (select id,nome from public.rotas where id in(select rota_id from escopo)) r),'[]'),
  'representantes',coalesce((select jsonb_agg(to_jsonb(r) order by nome,id) from (select id,nome from public.representantes where id in(select representante_id from escopo)) r),'[]'),
  'cidades',coalesce((select jsonb_agg(cidade order by cidade) from (select distinct cidade||case when coalesce(uf,'')<>'' then ' / '||uf else '' end cidade from escopo where coalesce(cidade,'')<>'') c),'[]'),
  'centros',coalesce((select jsonb_agg(to_jsonb(c) order by nome,id) from (select id,nome from public.centros where public.usuario_pode_acessar_centro(id)) c),'[]')
 ) into resultado;
 return resultado;
end $$;
revoke all on function public.relatorio_vendas_filtros_230() from public,anon;
grant execute on function public.relatorio_vendas_filtros_230() to authenticated;

create or replace function public.admin_salvar_acesso(_role text,_menus text[],_permissoes text[])
returns void language plpgsql security definer set search_path=public as $$
declare antes jsonb; tipo_role text;
begin
 if not public.usuario_ativo() or not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador ativo pode alterar acessos'; end if;
 if _role in ('admin','gestor') or not exists(select 1 from public.papeis where codigo=_role) then raise exception 'Perfil inválido ou de acesso total'; end if;
 _menus:=case when _menus is null then null else array(select distinct case when m in ('/cobranca','/clientes-inativos','/lead-rota') then '/agenda-comercial' when m='/relatorios' then '/relatorio-vendas' else m end from unnest(_menus) m) end;
 if _menus is null or _permissoes is null or cardinality(_menus)>100 or cardinality(_permissoes)>200 then raise exception 'Listas de acesso inválidas'; end if;
 if exists(select 1 from unnest(_menus) p where p is null or p<>all(array['/dashboard','/pendencias','/pessoas','/produtos','/tabelas-preco','/centros','/rotas','/formas-pagamento','/cadastros-padrao','/descontos-peso','/pedidos','/representantes','/lead-rota','/agenda-comercial','/metas','/comissoes','/separacao','/compras','/planejamento-compras','/estoque','/notas','/cargas','/expedicao','/devolucoes','/financeiro','/fluxo-caixa','/contas','/categorias-financeiras','/movimentacoes','/dre','/relatorios-financeiros','/rota-despesas','/receber','/cobranca','/boletos','/conciliacao-creditos','/pagar','/relatorios','/relatorio-vendas','/clientes-inativos','/notificacoes','/usuarios','/auditoria','/configuracoes'])) then raise exception 'Menu desconhecido'; end if;
 if exists(select 1 from unnest(_permissoes) p where p is null or not exists(select 1 from public.permissoes c where c.codigo=p)) then raise exception 'Permissão desconhecida'; end if;
 perform pg_advisory_xact_lock(hashtextextended('acesso_perfil:'||_role,0));
 select jsonb_build_object('menus',coalesce((select jsonb_agg(path order by path) from public.role_menus where role::text=_role),'[]'::jsonb),'permissoes',coalesce((select jsonb_agg(permissao order by permissao) from public.role_permissoes where role=_role),'[]'::jsonb)) into antes;
 delete from public.role_menus where role::text=_role;
 select format_type(a.atttypid,a.atttypmod) into tipo_role from pg_attribute a where a.attrelid='public.role_menus'::regclass and a.attname='role';
 execute format('insert into public.role_menus(role,path) select $1::%s,path from (select distinct unnest($2::text[]) as path) x',tipo_role) using _role,_menus;
 delete from public.role_permissoes where role=_role;
 insert into public.role_permissoes(role,permissao) select _role,p from (select distinct unnest(_permissoes) p) x;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe)
 values('role_menus',null,'salvar_acesso',auth.uid(),jsonb_build_object('role',_role,'antes',antes,'depois',jsonb_build_object('menus',to_jsonb(_menus),'permissoes',to_jsonb(_permissoes))));
end $$;
revoke all on function public.admin_salvar_acesso(text,text[],text[]) from public,anon;
grant execute on function public.admin_salvar_acesso(text,text[],text[]) to authenticated;
notify pgrst,'reload schema';
commit;
