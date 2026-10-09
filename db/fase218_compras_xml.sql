-- Fase218: importação conferida de XML de compra; não emite documento fiscal.
begin;
insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values('compra_xml_importar','Importar XML conferido de compra','Compras',127,'/compras') on conflict do nothing;
do $$ begin
 if not exists(select 1 from public.auditoria where tabela='fase218' and acao='instalada') then
  insert into public.role_permissoes(role,permissao) select codigo,'compra_xml_importar' from public.papeis where codigo in ('estoque','financeiro') on conflict do nothing;
  insert into public.auditoria(tabela,acao,detalhe) values('fase218','instalada','{}');
 end if;
end $$;
create or replace function public.importar_compra_xml_218(_fornecedor uuid,_centro uuid,_dados jsonb,_itens jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare c public.compras; r record; chave text; soma numeric;
begin
 if not public.pode_rotina('compra_xml_importar') or not (public.can_stock(auth.uid()) or public.can_finance(auth.uid())) or not public.usuario_pode_acessar_centro(_centro) then raise exception 'Sem acesso à importação de compras'; end if;
 chave:=_dados->>'chave';
 if chave is null or chave!~'^[0-9]{44}$' or _itens is null or jsonb_typeof(_itens)<>'array' or jsonb_array_length(_itens) not between 1 and 500 or (_dados->>'conferido') is distinct from 'true' then raise exception 'Confira fornecedor, produtos e unidades antes de importar'; end if;
 if not exists(select 1 from public.fornecedores where id=_fornecedor and regexp_replace(coalesce(cnpj_cpf,''),'[^0-9A-Za-z]','','g')=regexp_replace(coalesce(_dados->>'documento_emitente',''),'[^0-9A-Za-z]','','g')) then raise exception 'Documento do fornecedor não corresponde ao XML'; end if;
 perform pg_advisory_xact_lock(hashtextextended('compra_xml:'||chave,0));
 select * into c from public.compras where chave_acesso=chave;
 if c.id is not null then
  if c.centro_id<>_centro or c.fornecedor_id<>_fornecedor then raise exception 'XML já usado em outro centro/fornecedor'; end if;
  return c.id;
 end if;
 if coalesce((_dados->>'frete')::numeric,-1)<0 or coalesce((_dados->>'desconto')::numeric,-1)<0 or coalesce((_dados->>'total')::numeric,-1)<=0 or (_dados->>'frete')::numeric::text in ('NaN','Infinity','-Infinity') or (_dados->>'desconto')::numeric::text in ('NaN','Infinity','-Infinity') or (_dados->>'total')::numeric::text in ('NaN','Infinity','-Infinity') then raise exception 'Totais inválidos'; end if;
 select * into c from public.criar_compra_rascunho(_fornecedor,_centro,(_dados->>'data')::date,'Importação XML conferida',_dados->>'numero',chave,0);
 for r in select * from jsonb_to_recordset(_itens) x(produto_id uuid,quantidade numeric,custo_unitario numeric) loop
  if r.produto_id is null or r.quantidade is null or r.quantidade<=0 or r.custo_unitario is null or r.custo_unitario<0 or r.quantidade::text in ('NaN','Infinity','-Infinity') or r.custo_unitario::text in ('NaN','Infinity','-Infinity') then raise exception 'Item inválido'; end if;
  perform public.adicionar_item_compra(c.id,r.produto_id,r.quantidade,r.custo_unitario,null,null);
 end loop;
 perform public.atualizar_compra_comercial(c.id,null,(_dados->>'frete')::numeric,(_dados->>'desconto')::numeric);
 select total_liquido into soma from public.compras where id=c.id;
 if abs(soma-(_dados->>'total')::numeric)>0.02 then raise exception 'Total importado (%) difere do XML (%); confira conversões e custos',soma,_dados->>'total'; end if;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('compras',c.id,'importar_xml',auth.uid(),jsonb_build_object('chave',chave,'total',soma,'itens',jsonb_array_length(_itens)));
 return c.id;
end $$;
-- O custo de aquisição inclui frete e desconto proporcionais na entrada, sem
-- alterar os preços do documento nem reprocessar compras históricas.
do $$ declare d text; begin
 select pg_get_functiondef('public.receber_compra(uuid)'::regprocedure) into d;
 if position('aquisicao_218' in d)=0 then
  d:=replace(d,'item.qtd, item.custo,','item.qtd, item.custo * case when cmp.total_itens>0 then cmp.total_liquido/cmp.total_itens else 1 end, -- aquisicao_218'||chr(10));
  if position('aquisicao_218' in d)=0 then raise exception 'Recebimento de compra incompatível para custo de aquisição'; end if;
  execute d;
 end if;
end $$;
revoke all on function public.importar_compra_xml_218(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.importar_compra_xml_218(uuid,uuid,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
