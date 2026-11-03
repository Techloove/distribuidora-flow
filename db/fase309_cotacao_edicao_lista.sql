-- Edição explícita de data/valor por produto, com histórico imutável e proteção concorrente.
begin;
create or replace function public.salvar_cotacao_lista_309(_loja uuid,_produto uuid,_dia date,_custo numeric,_ate date,_esperada uuid default null) returns public.intermediacao_cotacoes_296
language plpgsql security definer set search_path=public as $$declare vigente public.intermediacao_cotacoes_296;anterior public.intermediacao_cotacoes_296;nova public.intermediacao_cotacoes_296;rev integer;begin
 if not public.usuario_ativo() or not ((public.can_manage(auth.uid()) and public.pode_rotina('configuracao_rotinas_editar')) or (public.can_operate(auth.uid()) and public.pode_alterar_preco(auth.uid()))) or not public.intermediacao_ativa_296(_loja) then raise exception 'Sem permissão para cadastrar cotação nesta loja';end if;
 if _dia is null or _ate is null or not isfinite(_dia) or not isfinite(_ate) or _dia>_ate or _custo is null or _custo::text in('NaN','Infinity','-Infinity') or _custo<=0 or _custo>=10000000000 or round(_custo,4)<=0 or _custo<>round(_custo,4) then raise exception 'Informe data válida até a data base e custo maior que zero, com até quatro casas decimais';end if;
 perform 1 from public.centros where id=_loja for share;
 if not exists(select 1 from public.produtos p join public.loja_produtos l on l.produto_id=p.id and l.centro_id=_loja where p.id=_produto and p.ativo and l.disponivel and public.produto_categoria_loja_246(_loja,p.id)) then raise exception 'Produto indisponível nesta loja';end if;
 perform pg_advisory_xact_lock(hashtextextended(_loja::text||_produto::text,298));
 select * into vigente from public.intermediacao_cotacoes_296 where centro_id=_loja and produto_id=_produto and dia<=_ate order by dia desc,revisao desc limit 1;
 if vigente.id is distinct from _esperada then
  -- Repetir uma gravação confirmada não cria outra revisão.
  if vigente.id is not null and vigente.dia=_dia and vigente.custo_fabrica=_custo then return vigente;end if;
  raise exception 'A cotação deste produto foi alterada. Confira o último preço e descarte a edição antes de tentar novamente';
 end if;
 if vigente.id is not null and _dia<vigente.dia then raise exception 'A data não pode ser anterior ao último preço vigente';end if;
 select * into anterior from public.intermediacao_cotacoes_296 where centro_id=_loja and produto_id=_produto and dia=_dia order by revisao desc limit 1;
 if anterior.id is not null and anterior.custo_fabrica=_custo then return anterior;end if;
 select coalesce(max(revisao),0)+1 into rev from public.intermediacao_cotacoes_296 where centro_id=_loja and produto_id=_produto and dia=_dia;
 insert into public.intermediacao_cotacoes_296(centro_id,produto_id,dia,custo_fabrica,revisao,created_by) values(_loja,_produto,_dia,_custo,rev,auth.uid()) returning * into nova;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('intermediacao_cotacoes_296',nova.id,'cotacao_lista_309',auth.uid(),jsonb_build_object('anterior',to_jsonb(vigente),'nova',to_jsonb(nova),'data_explicita',true));
 return nova;
end $$;
revoke all on function public.salvar_cotacao_lista_309(uuid,uuid,date,numeric,date,uuid) from public,anon;
grant execute on function public.salvar_cotacao_lista_309(uuid,uuid,date,numeric,date,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
