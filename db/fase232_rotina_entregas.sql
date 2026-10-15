-- Fase232: formalização de entrega em rotina dedicada, integrada à expedição.
-- Aplicar após fase231. Não gera estoque, baixa financeira, boleto ou nota fiscal.
begin;
do $$ declare novo text; begin
 if not exists(select 1 from public.permissoes where codigo='compras_planejar') or to_regprocedure('public.sincronizar_entrega_214()') is null then raise exception 'Aplique as fases anteriores até a fase231'; end if;
 insert into public.permissoes(codigo,nome,grupo,ordem,modulo)
 values('entregas_operar','Consultar e formalizar entregas de pedidos','Entregas',135,'/entregas') on conflict do nothing returning codigo into novo;
 if novo is not null then
  insert into public.role_permissoes(role,permissao)
  select distinct rp.role,'entregas_operar' from public.role_permissoes rp join public.role_menus m on m.role::text=rp.role and m.path='/expedicao'
   where rp.permissao='entrega_registrar' and rp.role in ('expedicao','estoque') on conflict do nothing;
  insert into public.role_menus(role,path) select distinct m.role,'/entregas' from public.role_menus m join public.role_permissoes rp on rp.role=m.role::text and rp.permissao='entregas_operar' on conflict do nothing;
 end if;
end $$;
alter table public.pedidos add column if not exists data_entrega date;
alter table public.entrega_registros add column if not exists data_entrega date;

create or replace function public.entrega_acessivel_232(_expedicao uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select public.usuario_ativo() and public.can_ship(auth.uid()) and public.pode_rotina('entregas_operar') and exists(
  select 1 from public.expedicoes e join public.pedidos p on p.id=e.pedido_id where e.id=_expedicao
   and public.usuario_pode_acessar_centro(e.centro_id) and public.usuario_pode_acessar_centro(p.centro_id)
   and (not public.escopo_representante() or public.documento_na_minha_carteira('pedidos',p.id))
 );
$$;
revoke all on function public.entrega_acessivel_232(uuid) from public,anon,authenticated;

create or replace function public.entregas_listar_232(_centro uuid default null,_status text default 'em_rota',_rota uuid default null,_busca text default '',_pagina integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare resultado jsonb;
begin
 if not public.usuario_ativo() or not public.can_ship(auth.uid()) or not public.pode_rotina('entregas_operar') then raise exception 'Rotina de entregas não liberada para seu perfil'; end if;
 if _centro is not null and not public.usuario_pode_acessar_centro(_centro) then raise exception 'Centro sem acesso'; end if;
 if _status is null or _status not in ('','em_rota','entregue') or _pagina is null or _pagina<0 or _pagina>100000 then raise exception 'Filtro ou página inválidos'; end if;
 with escopo as materialized (
  select e.id expedicao_id,e.pedido_id,e.numero romaneio,e.status,e.centro_id,p.numero,p.data_pedido,p.status pedido_status,p.rota_id,
   e.data_saida,e.previsao_entrega,e.data_entrega,e.motorista,c.razao_social cliente,c.codigo codigo_cliente,c.telefone,c.cidade,c.uf,
   nullif(concat_ws(', ',nullif(to_jsonb(c)->>'logradouro',''),nullif(to_jsonb(c)->>'numero',''),nullif(to_jsonb(c)->>'bairro','')),'') endereco,
   coalesce(rt.nome,'Sem rota') rota,ce.nome centro,
   (select count(*) from public.pedido_itens i where i.pedido_id=p.id) itens,
   exists(select 1 from public.entrega_registros er join public.entrega_itens it on it.registro_id=er.id where er.pedido_id=p.id) parcial,
   er.recebedor,er.comprovante,er.observacao,er.created_at registrado_em,pr.nome registrado_por
  from public.expedicoes e join public.pedidos p on p.id=e.pedido_id join public.clientes c on c.id=p.cliente_id
   left join public.rotas rt on rt.id=p.rota_id left join public.centros ce on ce.id=e.centro_id
   left join public.entrega_registros er on er.expedicao_id=e.id and er.tipo='entrega' left join public.profiles pr on pr.id=er.created_by
  where e.status in ('em_rota','entregue') and p.status not in ('rascunho','digitacao','aguardando_aprovacao','aprovado','cancelado','recusado','devolvido')
   and public.usuario_pode_acessar_centro(e.centro_id) and public.usuario_pode_acessar_centro(p.centro_id)
   and (not public.escopo_representante() or public.documento_na_minha_carteira('pedidos',p.id))
   and (_centro is null or e.centro_id=_centro)
 ), filtrados as materialized(
  select * from escopo where (_rota is null or rota_id=_rota) and (coalesce(_busca,'')='' or position(lower(trim(_busca)) in lower(numero::text||' '||cliente||' '||coalesce(codigo_cliente::text,'')||' '||coalesce(cidade,'')))>0)
 ), escolhidos as materialized(select * from filtrados where _status='' or status=_status),
 pagina as(select * from escolhidos order by case when status='em_rota' then 0 else 1 end,data_entrega desc nulls last,previsao_entrega nulls last,numero,expedicao_id limit 50 offset _pagina*50)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by case when p.status='em_rota' then 0 else 1 end,p.data_entrega desc nulls last,p.previsao_entrega nulls last,p.numero,p.expedicao_id) from pagina p),'[]'),
 'count',(select count(*) from escolhidos),'pendentes',(select count(*) from filtrados where status='em_rota'),'entregues',(select count(*) from filtrados where status='entregue'),
 'rotas',coalesce((select jsonb_agg(to_jsonb(r) order by nome) from (select distinct rota_id id,rota nome from escopo where rota_id is not null) r),'[]')) into resultado;
 return resultado;
end $$;
revoke all on function public.entregas_listar_232(uuid,text,uuid,text,integer) from public,anon;
grant execute on function public.entregas_listar_232(uuid,text,uuid,text,integer) to authenticated;

create or replace function public.entregas_itens_232(_expedicao uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare resultado jsonb;
begin
 if not public.entrega_acessivel_232(_expedicao) then raise exception 'Entrega sem acesso'; end if;
 select jsonb_build_object('count',count(*),'rows',coalesce(jsonb_agg(jsonb_build_object('id',i.id,'codigo',pr.codigo,'produto',pr.descricao,'quantidade',i.quantidade) order by pr.descricao,i.id),'[]')) into resultado
 from public.pedido_itens i join public.produtos pr on pr.id=i.produto_id join public.expedicoes e on e.pedido_id=i.pedido_id where e.id=_expedicao;
 return resultado;
end $$;
revoke all on function public.entregas_itens_232(uuid) from public,anon;
grant execute on function public.entregas_itens_232(uuid) to authenticated;

-- Data da expedição é a origem para o pedido, inclusive nas rotinas de entrega existentes.
create or replace function public.sincronizar_data_entrega_232()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='entregue' and new.data_entrega is not null then
  update public.pedidos set data_entrega=new.data_entrega where id=new.pedido_id and status='entregue' and data_entrega is distinct from new.data_entrega;
 end if;
 return new;
end $$;
revoke all on function public.sincronizar_data_entrega_232() from public,anon,authenticated;
drop trigger if exists zz_data_entrega_232 on public.expedicoes;
create trigger zz_data_entrega_232 after update of status,data_entrega on public.expedicoes for each row execute function public.sincronizar_data_entrega_232();
update public.pedidos p set data_entrega=x.data_entrega from (select pedido_id,max(data_entrega) data_entrega from public.expedicoes where status='entregue' and data_entrega is not null group by pedido_id) x where p.id=x.pedido_id and p.status='entregue' and p.data_entrega is null;

create or replace function public.confirmar_entrega_232(_expedicao uuid,_data date,_recebedor text,_comprovante text,_observacao text,_chave uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare e public.expedicoes; p public.pedidos; anterior public.entrega_registros; reg uuid;
begin
 if not public.entrega_acessivel_232(_expedicao) then raise exception 'Entrega sem acesso'; end if;
 if _chave is null or _data is null or _data>(now() at time zone 'America/Sao_Paulo')::date or nullif(trim(_recebedor),'') is null or length(_recebedor)>120 or nullif(trim(_comprovante),'') is null or length(_comprovante)>1000 or length(coalesce(_observacao,''))>4000 then raise exception 'Informe data válida, recebedor e referência do comprovante'; end if;
 perform pg_advisory_xact_lock(hashtextextended('entrega232:'||_chave,0));
 select * into e from public.expedicoes where id=_expedicao for update;
 select * into p from public.pedidos where id=e.pedido_id for update;
 perform 1 from public.clientes where id=p.cliente_id for share;
 -- Repete o escopo após os locks: o pedido pode ter mudado de carteira/centro.
 if not public.entrega_acessivel_232(e.id) then raise exception 'Entrega sem acesso'; end if;
 select * into anterior from public.entrega_registros where chave_operacao=_chave;
 if anterior.id is not null then
  if anterior.expedicao_id is distinct from e.id or anterior.tipo<>'entrega' or anterior.data_entrega is distinct from _data or anterior.recebedor is distinct from trim(_recebedor) or anterior.comprovante is distinct from trim(_comprovante) or coalesce(anterior.observacao,'')<>coalesce(nullif(trim(_observacao),''),'') then raise exception 'Confirmação já usada com dados diferentes'; end if;
  return anterior.id;
 end if;
 if e.status='entregue' then raise exception 'Entrega já formalizada. Atualize a lista'; end if;
 if e.status<>'em_rota' or p.status<>'em_rota' then raise exception 'O pedido e a expedição devem estar em rota para confirmar a entrega'; end if;
 if _data<coalesce(e.data_saida,p.data_pedido) then raise exception 'Data de entrega anterior à saída do pedido'; end if;
 if not exists(select 1 from public.pedido_itens where pedido_id=p.id) then raise exception 'Pedido sem itens'; end if;
 if exists(select 1 from public.entrega_registros er join public.entrega_itens i on i.registro_id=er.id where er.pedido_id=p.id) then raise exception 'Pedido com entrega parcial ou recusa. Conclua o tratamento na Expedição'; end if;
 insert into public.entrega_registros(expedicao_id,pedido_id,centro_id,tipo,recebedor,comprovante,observacao,data_entrega,chave_operacao)
 values(e.id,p.id,e.centro_id,'entrega',trim(_recebedor),trim(_comprovante),nullif(trim(_observacao),''),_data,_chave) returning id into reg;
 perform public.avancar_expedicao(e.id,'entregue',_data);
 if not exists(select 1 from public.pedidos where id=p.id and status='entregue' and data_entrega=_data) then raise exception 'Pedido não foi atualizado. Verifique a sincronização de entregas'; end if;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('entrega_registros',reg,'formalizar_entrega_232',auth.uid(),jsonb_build_object('pedido_id',p.id,'expedicao_id',e.id,'data_entrega',_data,'recebedor',trim(_recebedor)));
 return reg;
end $$;
revoke all on function public.confirmar_entrega_232(uuid,date,text,text,text,uuid) from public,anon;
grant execute on function public.confirmar_entrega_232(uuid,date,text,text,text,uuid) to authenticated;
create or replace function public.admin_salvar_acesso(_role text,_menus text[],_permissoes text[])
returns void language plpgsql security definer set search_path=public as $$
declare antes jsonb; tipo_role text;
begin
 if not public.usuario_ativo() or not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador ativo pode alterar acessos'; end if;
 if _role in ('admin','gestor') or not exists(select 1 from public.papeis where codigo=_role) then raise exception 'Perfil inválido ou de acesso total'; end if;
 _menus:=case when _menus is null then null else array(select distinct case when m in ('/cobranca','/clientes-inativos','/lead-rota') then '/agenda-comercial' when m='/relatorios' then '/relatorio-vendas' when m='/planejamento-compras' then '/compras' else m end from unnest(_menus) m) end;
 if _menus is null or _permissoes is null or cardinality(_menus)>100 or cardinality(_permissoes)>200 then raise exception 'Listas de acesso inválidas'; end if;
 if exists(select 1 from unnest(_menus) p where p is null or p<>all(array['/dashboard','/pendencias','/pessoas','/produtos','/tabelas-preco','/centros','/rotas','/formas-pagamento','/cadastros-padrao','/descontos-peso','/pedidos','/representantes','/lead-rota','/agenda-comercial','/metas','/comissoes','/separacao','/compras','/planejamento-compras','/estoque','/notas','/cargas','/expedicao','/entregas','/devolucoes','/financeiro','/fluxo-caixa','/contas','/categorias-financeiras','/movimentacoes','/dre','/relatorios-financeiros','/rota-despesas','/receber','/cobranca','/boletos','/conciliacao-creditos','/pagar','/relatorios','/relatorio-vendas','/clientes-inativos','/notificacoes','/usuarios','/auditoria','/configuracoes'])) then raise exception 'Menu desconhecido'; end if;
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
