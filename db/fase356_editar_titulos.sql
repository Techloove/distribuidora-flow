-- Edição controlada de títulos em aberto. Não altera dados durante a instalação.
begin;
insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values('receber_editar','Editar dados de título a receber','Financeiro',182,'/receber'),('pagar_editar','Editar dados de título a pagar','Financeiro',183,'/pagar') on conflict do nothing;
insert into public.role_permissoes(role,permissao) select distinct m.role::text,p.codigo from public.role_menus m join public.permissoes p on p.modulo=m.path and p.codigo in('receber_editar','pagar_editar') where m.role::text in('admin','gestor','financeiro') on conflict do nothing;
create or replace function public.editar_titulo_356(_tabela text,_id uuid,_dados jsonb default null,_versao text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r jsonb;novo jsonb;vinculado boolean;doc text;emissao date;vence date;valor numeric;categoria uuid;descricao text;observacao text;hash text;v_tipo text;
begin
 if _tabela is null or _tabela not in('contas_receber','contas_pagar') then raise exception 'Tipo de título inválido';end if;
 if not coalesce(public.usuario_ativo(),false) or not coalesce(public.can_finance(auth.uid()),false) or not coalesce(public.pode_rotina(case when _tabela='contas_receber' then 'receber_editar' else 'pagar_editar' end),false) or public.escopo_representante() then raise exception 'Sem permissão para editar títulos';end if;
 execute format('select to_jsonb(t) from public.%I t where id=$1 for update',_tabela) into r using _id;
 if r is null or not coalesce(public.usuario_pode_acessar_centro((r->>'centro_id')::uuid),false) then raise exception 'Título indisponível ou sem acesso à loja';end if;
 if coalesce(r->>'status','') not in('aberto','vencido') or coalesce((r->>'valor_pago')::numeric,0)<>0 then raise exception 'Somente títulos em aberto e sem pagamentos podem ser editados';end if;
 if exists(select 1 from movimentos_financeiros m where m.conta_receber_id=case when _tabela='contas_receber' then _id end or m.conta_pagar_id=case when _tabela='contas_pagar' then _id end) then raise exception 'Título com histórico de baixa não pode ser editado por esta opção';end if;
 if _tabela='contas_receber' and exists(select 1 from boletos b where b.conta_receber_id=_id and (b.status is distinct from 'erro' or nullif(b.nosso_numero,'') is not null)) then raise exception 'Título com boleto emitido ou em processamento não pode ser editado. Utilize as opções do boleto';end if;
 vinculado:=nullif(r->>'pedido_id','') is not null or nullif(r->>'compra_id','') is not null or nullif(r->>'acordo_id','') is not null or nullif(r->>'nf_entrada_id','') is not null;
 hash:=md5(r::text);
 if _dados is null then return jsonb_build_object('registro',r,'versao',hash,'vinculado',vinculado);end if;
 if _versao is distinct from hash then raise exception 'Título alterado em outra sessão. Feche e abra a edição novamente';end if;
 if jsonb_typeof(_dados) is distinct from 'object' or exists(select 1 from jsonb_object_keys(_dados) k where k not in('documento','data_emissao','vencimento','valor','categoria_id','descricao','observacao')) then raise exception 'Campos de edição inválidos';end if;
 doc:=btrim(coalesce(_dados->>'documento',r->>'documento',''));
 emissao:=case when _dados?'data_emissao' then nullif(_dados->>'data_emissao','')::date else (r->>'data_emissao')::date end;
 vence:=coalesce((_dados->>'vencimento')::date,(r->>'vencimento')::date);
 valor:=coalesce((_dados->>'valor')::numeric,(r->>'valor')::numeric);
 categoria:=case when _dados?'categoria_id' then nullif(_dados->>'categoria_id','')::uuid else (r->>'categoria_id')::uuid end;
 descricao:=case when _dados?'descricao' then nullif(btrim(_dados->>'descricao'),'') else r->>'descricao' end;
 observacao:=case when _dados?'observacao' then nullif(btrim(_dados->>'observacao'),'') else r->>'observacao' end;
 if length(doc) not between 1 and 120 or vence is null or valor is null or valor<=0 or valor>999999999999.99 or valor<>round(valor,2) or length(coalesce(descricao,''))>2000 or length(coalesce(observacao,''))>4000 then raise exception 'Confira documento, datas, valor positivo com duas casas e tamanho das observações';end if;
 if valor+coalesce((r->>'juros')::numeric,0)+coalesce((r->>'multa')::numeric,0)+coalesce((r->>'acrescimo')::numeric,0)-coalesce((r->>'desconto')::numeric,0)<=0 then raise exception 'O valor atualizado deve manter saldo positivo após os ajustes do título';end if;
 if vinculado and (valor is distinct from (r->>'valor')::numeric or categoria is distinct from (r->>'categoria_id')::uuid) then raise exception 'Valor e categoria de título vinculado devem ser corrigidos na origem';end if;
 v_tipo:=case when _tabela='contas_receber' then 'receita' else 'despesa' end;
 if categoria is not null and categoria is distinct from (r->>'categoria_id')::uuid and not exists(select 1 from categorias_financeiras c where c.id=categoria and c.ativo and c.tipo=v_tipo) then raise exception 'Selecione uma categoria ativa compatível com o título';end if;
 execute format('update public.%I set documento=$1,data_emissao=$2,vencimento=$3,valor=$4,categoria_id=$5,descricao=$6,observacao=$7,updated_at=now() where id=$8 returning to_jsonb(%I)',_tabela,_tabela) into novo using doc,emissao,vence,valor,categoria,descricao,observacao,_id;
 insert into auditoria(tabela,registro_id,acao,user_id,detalhe) values(_tabela,_id,'editar_dados_titulo_356',auth.uid(),jsonb_build_object('anterior',r,'novo',novo));
 return jsonb_build_object('registro',novo,'versao',md5(novo::text),'vinculado',vinculado);
end $$;
revoke all on function public.editar_titulo_356(text,uuid,jsonb,text) from public,anon;
grant execute on function public.editar_titulo_356(text,uuid,jsonb,text) to authenticated;
notify pgrst,'reload schema';
commit;
