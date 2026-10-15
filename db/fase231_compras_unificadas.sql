-- Fase231: menu Compras unifica compras/entradas e planejamento/reposição.
-- Aplicar após fase230. Não movimenta estoque nem altera compras ou financeiro.
begin;
do $$ declare novo text; r record; begin
 if to_regprocedure('public.relatorio_vendas_filtros_230()') is null then raise exception 'Aplique a fase230 antes da fase231'; end if;
 for r in select * from (values
  ('compras_operar','Consultar e operar compras e entradas','/compras',133),
  ('compras_planejar','Consultar planejamento e reposição de compras','/planejamento-compras',134)
 ) x(codigo,nome,origem,ordem) loop
  novo:=null;
  insert into public.permissoes(codigo,nome,grupo,ordem,modulo)
  values(r.codigo,r.nome,'Compras',r.ordem,'/compras') on conflict(codigo) do nothing returning codigo into novo;
  if novo is not null then
   insert into public.role_permissoes(role,permissao)
   select distinct role::text,r.codigo from public.role_menus where path=r.origem on conflict do nothing;
  end if;
 end loop;
end $$;
insert into public.role_menus(role,path) select role,'/compras' from public.role_menus where path='/planejamento-compras' on conflict do nothing;
delete from public.role_menus where path='/planejamento-compras';
update public.permissoes set modulo='/compras' where modulo='/planejamento-compras';

-- Acrescenta somente o controle de acesso aos motores atualmente instalados.
-- Mantém validações de centro, capacidade operacional, status e efeitos transacionais.
do $$ declare assinatura text; oid_rotina regprocedure; definicao text; begin
 foreach assinatura in array array[
  'criar_compra_rascunho(uuid,uuid,date,text,text,text,numeric)',
  'atualizar_compra_comercial(uuid,uuid,numeric,numeric)',
  'adicionar_item_compra(uuid,uuid,numeric,numeric,text,date)',
  'atualizar_item_compra(uuid,numeric,numeric)',
  'remover_item_compra(uuid)','cancelar_compra(uuid)',
  'marcar_compra_comprada(uuid)','receber_compra(uuid)',
  'importar_compra_xml_218(uuid,uuid,jsonb,jsonb)'
 ] loop
  oid_rotina:=to_regprocedure('public.'||assinatura);
  if oid_rotina is null then raise exception 'Rotina de compras ausente: %',assinatura; end if;
  definicao:=pg_get_functiondef(oid_rotina);
  if position('compras_guard_231' in definicao)=0 then
   if definicao !~* '\mBEGIN\M' then raise exception 'Motor de compras incompatível: %',assinatura; end if;
   execute regexp_replace(definicao,'\mBEGIN\M',E'BEGIN
 -- compras_guard_231
 if not public.pode_rotina(''compras_operar'') then raise exception ''Operação de compras não liberada para seu perfil''; end if;
','i');
  end if;
  execute format('revoke all on function public.%s from public,anon',assinatura);
 end loop;
end $$;
-- Views continuam SECURITY INVOKER: conservam RLS de centro/carteira e estoque compartilhado.
do $$ declare nome text; definicao text; begin
 foreach nome in array array['vw_sugestao_compras_centro','vw_reposicao_209'] loop
  if to_regclass('public.'||nome) is null then raise exception 'Consulta de planejamento ausente: %',nome; end if;
  select pg_get_viewdef(('public.'||nome)::regclass,true) into definicao;
  if position('compras_planejar' in definicao)=0 then
   execute format('create or replace view public.%I with(security_invoker=on,security_barrier=on) as select * from (%s) planejamento where public.pode_rotina(''compras_planejar'')',nome,regexp_replace(trim(definicao),';$',''));
  end if;
 end loop;
end $$;
create or replace function public.admin_salvar_acesso(_role text,_menus text[],_permissoes text[])
returns void language plpgsql security definer set search_path=public as $$
declare antes jsonb; tipo_role text;
begin
 if not public.usuario_ativo() or not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador ativo pode alterar acessos'; end if;
 if _role in ('admin','gestor') or not exists(select 1 from public.papeis where codigo=_role) then raise exception 'Perfil inválido ou de acesso total'; end if;
 _menus:=case when _menus is null then null else array(select distinct case when m in ('/cobranca','/clientes-inativos','/lead-rota') then '/agenda-comercial' when m='/relatorios' then '/relatorio-vendas' when m='/planejamento-compras' then '/compras' else m end from unnest(_menus) m) end;
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
