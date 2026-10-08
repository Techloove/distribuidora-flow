-- Fase211: menus independentes e ações das novas rotinas em Usuários e papéis.
-- Reutiliza o catálogo de permissões existente; não redefine carteiras ou sequências.
begin;

do $$ begin
 if to_regclass('public.acompanhamentos') is null or to_regclass('public.role_permissoes') is null then
  raise exception 'Aplique as fases36 e209 antes da fase211';
 end if;
end $$;

alter table public.permissoes add column if not exists modulo text;
-- Copia o acesso que antes era herdado somente na primeira aplicação.
do $$ begin
 if not exists(select 1 from public.permissoes where codigo='comercial_acompanhar') then
  insert into public.role_menus(role,path)
  select rm.role,x.novo from public.role_menus rm join (values
   ('/lead-rota','/agenda-comercial'),('/receber','/cobranca'),('/dashboard','/pendencias')
  ) x(antigo,novo) on rm.path=x.antigo on conflict do nothing;
 end if;
end $$;

-- Catálogo processado em um único bloco, sem tabela temporária entre comandos.
-- Grants padrão apenas para códigos novos: reaplicar preserva revogações.
do $$
declare r record; novo text;
begin
 for r in select * from (values
('margem_pedido_ver','Visualizar margem do pedido','Pedidos',100,'/pedidos','financeiro,comercial,representante,estoque,expedicao'),
  ('frete_pedido_editar','Editar custo do transporte do pedido','Pedidos',101,'/pedidos',''),
  ('reposicao_ver','Consultar reposição inteligente','Compras',102,'/planejamento-compras','financeiro,comercial,representante,estoque,expedicao'),
  ('comercial_acompanhar','Registrar e concluir acompanhamento comercial','Agenda comercial',103,'/agenda-comercial','comercial,representante'),
  ('cobranca_acompanhar','Registrar cobrança e promessa de pagamento','Agenda de cobrança',104,'/cobranca','financeiro'),
  ('entrega_registrar','Registrar entrega, comprovante e ocorrência','Entregas',105,'/expedicao','expedicao,estoque'),
  ('carga_capacidade_editar','Editar capacidade do veículo','Entregas',106,'/cargas','expedicao,estoque'),
  ('devolucao_operar','Operar devoluções e condição dos produtos','Devoluções',107,'/devolucoes',''),
  ('troca_vincular','Vincular novo pedido à troca','Devoluções',108,'/devolucoes',''),
  ('comissao_ajustes_ver','Visualizar ajustes de comissão','Comissões',109,'/comissoes','financeiro,comercial,representante,estoque,expedicao'),
  ('comissao_ajustes_conferir','Conferir ajuste de comissão paga','Comissões',110,'/comissoes','financeiro'),
  ('extrato_ver','Visualizar extrato bancário importado','Extrato',111,'/movimentacoes','financeiro'),
  ('extrato_importar','Importar extrato bancário CSV','Extrato',112,'/movimentacoes','financeiro'),
  ('extrato_conciliar','Conciliar linha com movimento financeiro','Extrato',113,'/movimentacoes','financeiro'),
  ('extrato_desconciliar','Desfazer conciliação com justificativa','Extrato',114,'/movimentacoes','financeiro'),
  ('configuracao_rotinas_editar','Alterar margem mínima e regra de comissão','Configurações',115,'/configuracoes','')
 ) c(codigo,nome,grupo,ordem,modulo,padroes) loop
  novo := null;
  insert into public.permissoes(codigo,nome,grupo,ordem,modulo)
  values(r.codigo,r.nome,r.grupo,r.ordem,r.modulo)
  on conflict(codigo) do nothing returning codigo into novo;
  if novo is not null then
   insert into public.role_permissoes(role,permissao)
   select papel,r.codigo from unnest(string_to_array(r.padroes,',')) papel
   where papel<>'' and exists(select 1 from public.papeis p where p.codigo=papel)
   on conflict do nothing;
  end if;
  update public.permissoes set nome=r.nome,grupo=r.grupo,ordem=r.ordem,modulo=r.modulo
  where codigo=r.codigo;
 end loop;
end $$;

create or replace function public.pode_rotina(_acao text)
returns boolean language sql stable security definer set search_path=public as $$
 select public.usuario_ativo() and exists(
  select 1 from public.permissoes p where p.codigo=_acao and p.modulo is not null and (
   public.can_manage(auth.uid()) or (
    exists(select 1 from public.user_roles u join public.role_permissoes r on r.role=u.role::text where u.user_id=auth.uid() and r.permissao=_acao)
    and exists(select 1 from public.user_roles u join public.role_menus r on r.role::text=u.role::text where u.user_id=auth.uid() and r.path=p.modulo)
   )
  )
 );
$$;
revoke all on function public.pode_rotina(text) from public,anon;
grant execute on function public.pode_rotina(text) to authenticated;

-- Um único save transacional, inclusive se o perfil ficar sem menus/permissões.
create or replace function public.admin_salvar_acesso(_role text,_menus text[],_permissoes text[])
returns void language plpgsql security definer set search_path=public as $$
declare antes jsonb; tipo_role text;
begin
 if not public.usuario_ativo() or not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador ativo pode alterar acessos'; end if;
 if _role in ('admin','gestor') or not exists(select 1 from public.papeis where codigo=_role) then raise exception 'Perfil inválido ou de acesso total'; end if;
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
revoke insert,update,delete on public.role_menus,public.role_permissoes from authenticated;

-- A API administrativa antiga também exige administrador ativo e valores válidos.
create or replace function public.definir_permissao(_role text,_permissao text,_conceder boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.usuario_ativo() or not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador ativo pode alterar acessos'; end if;
 if _role in ('admin','gestor') or not exists(select 1 from public.papeis where codigo=_role) or _conceder is null or not exists(select 1 from public.permissoes where codigo=_permissao) then raise exception 'Perfil ou permissão inválidos'; end if;
 perform pg_advisory_xact_lock(hashtextextended('acesso_perfil:'||_role,0));
 if _conceder then insert into public.role_permissoes(role,permissao) values(_role,_permissao) on conflict do nothing;
 else delete from public.role_permissoes where role=_role and permissao=_permissao; end if;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('role_permissoes',null,'definir_acesso',auth.uid(),jsonb_build_object('role',_role,'permissao',_permissao,'conceder',_conceder));
end $$;
revoke all on function public.definir_permissao(text,text,boolean) from public,anon;
grant execute on function public.definir_permissao(text,text,boolean) to authenticated;

-- Guards no início preservam corpos, assinaturas, ACLs e verificações originais.
do $$ declare r record; assinatura regprocedure; definicao text; guard text; begin
 for r in select * from (values
 ('definir_custo_frete_pedido(uuid,numeric)','frete_pedido_editar'),
 ('registrar_entrega(uuid,text,text,text,text)','entrega_registrar'),
 ('definir_capacidade_carga(uuid,numeric)','carga_capacidade_editar'),
 ('vincular_pedido_troca(uuid,uuid)','troca_vincular'),
 ('conferir_ajuste_comissao(uuid,text)','comissao_ajustes_conferir'),
 ('importar_extrato_bancario(uuid,jsonb)','extrato_importar'),
 ('conciliar_extrato(uuid,uuid)','extrato_conciliar'),
 ('desconciliar_extrato(uuid,text)','extrato_desconciliar'),
 ('confirmar_devolucao(uuid)','devolucao_operar'),
 ('cancelar_devolucao(uuid)','devolucao_operar')
 ) x(assinatura,acao) loop
  assinatura:=to_regprocedure('public.'||r.assinatura);
  if assinatura is null then raise exception 'Rotina ausente: %',r.assinatura; end if;
  definicao:=pg_get_functiondef(assinatura);
  if position('acao_guard_211' in definicao)=0 then
   guard:=format(E'BEGIN
 -- acao_guard_211
 if not public.pode_rotina(%L) then raise exception ''Ação não liberada para seu perfil''; end if;
',r.acao);
   execute regexp_replace(definicao,'\mBEGIN\M',guard,'i');
  end if;
 end loop;
 for r in select * from (values
  ('registrar_acompanhamento(uuid,uuid,text,date,text,text,date,numeric)', 'case when _tipo=''comercial'' then ''comercial_acompanhar'' else ''cobranca_acompanhar'' end'),
  ('concluir_acompanhamento(uuid)', '(select case when tipo=''comercial'' then ''comercial_acompanhar'' else ''cobranca_acompanhar'' end from public.acompanhamentos where id=_id)')
 ) x(assinatura,expressao) loop
  assinatura:=to_regprocedure('public.'||r.assinatura);
  if assinatura is null then raise exception 'Rotina ausente: %',r.assinatura; end if;
  definicao:=pg_get_functiondef(assinatura);
  if position('acao_guard_211' in definicao)=0 then
   guard:=format(E'BEGIN
 -- acao_guard_211
 if not public.pode_rotina(%s) then raise exception ''Ação não liberada para seu perfil''; end if;
',r.expressao);
   execute regexp_replace(definicao,'\mBEGIN\M',guard,'i');
  end if;
 end loop;
end $$;

-- Leitura continua invoker e também exige a opção específica.
do $$ declare r record; definicao text; begin
 for r in select * from (values
 ('vw_margem_pedido_209','margem_pedido_ver'),('vw_reposicao_209','reposicao_ver'),
 ('vw_carteira_comercial_209','comercial_acompanhar'),('vw_cobranca_clientes_209','cobranca_acompanhar')
 ) x(nome,acao) loop
  definicao:=pg_get_viewdef(to_regclass('public.'||r.nome),true);
  if position('pode_rotina' in definicao)=0 then
   execute format('create or replace view public.%I with(security_invoker=on,security_barrier=on) as select * from (%s) fonte where public.pode_rotina(%L)',r.nome,regexp_replace(trim(definicao),';$',''),r.acao);
  end if;
 end loop;
end $$;
drop policy if exists acompanhamento_acesso_211 on public.acompanhamentos;
create policy acompanhamento_acesso_211 on public.acompanhamentos as restrictive for select to authenticated
using(public.pode_rotina(case when tipo='comercial' then 'comercial_acompanhar' else 'cobranca_acompanhar' end));
drop policy if exists extrato_acesso_211 on public.extrato_bancario_linhas;
create policy extrato_acesso_211 on public.extrato_bancario_linhas as restrictive for select to authenticated using(public.pode_rotina('extrato_ver'));
drop policy if exists entrega_acesso_211 on public.entrega_registros;
create policy entrega_acesso_211 on public.entrega_registros as restrictive for select to authenticated using(public.pode_rotina('entrega_registrar'));
drop policy if exists comissao_acesso_211 on public.comissao_ajustes;
create policy comissao_acesso_211 on public.comissao_ajustes as restrictive for select to authenticated using(public.pode_rotina('comissao_ajustes_ver'));

create or replace function public.validar_acesso_operacao_211()
returns trigger language plpgsql set search_path=public as $$
begin
 if tg_table_name='parametros' then
  if ((tg_op<>'INSERT' and old.chave in ('margem_liquida_minima','comissao_fato_gerador')) or (tg_op<>'DELETE' and new.chave in ('margem_liquida_minima','comissao_fato_gerador'))) and not public.pode_rotina('configuracao_rotinas_editar') then raise exception 'Configuração não liberada para seu perfil'; end if;
 elsif not public.pode_rotina('devolucao_operar') then raise exception 'Devolução não liberada para seu perfil'; end if;
 return coalesce(new,old);
end $$;
revoke all on function public.validar_acesso_operacao_211() from public,anon,authenticated;
drop trigger if exists operacao_acesso_211 on public.parametros;
create trigger operacao_acesso_211 before insert or update or delete on public.parametros for each row execute function public.validar_acesso_operacao_211();
drop trigger if exists operacao_acesso_211 on public.devolucoes;
create trigger operacao_acesso_211 before insert or update or delete on public.devolucoes for each row execute function public.validar_acesso_operacao_211();
drop trigger if exists operacao_acesso_211 on public.devolucao_itens;
create trigger operacao_acesso_211 before insert or update or delete on public.devolucao_itens for each row execute function public.validar_acesso_operacao_211();
notify pgrst,'reload schema';
commit;
