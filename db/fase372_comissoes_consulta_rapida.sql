begin;
-- Somente leitura: mantém valores, situações, pagamentos, RLS e competência por ciclo.
do $$declare nome text;condicao text;begin
 if to_regprocedure('public.data_comissao_305(uuid)') is null then raise exception 'Aplique a fase305 antes da fase372';end if;
 foreach nome in array array['pedidos_competencia_372','pedidos_comissao_competencia_372','pedidos_competencia_mod_372','pedidos_comissao_competencia_mod_372'] loop
  condicao:='true';
  if nome like 'pedidos_comissao_%' then condicao:='public.status_comissao_valido_302(p.tipo_documento,p.status)';end if;
  if nome like '%_mod_372' then condicao:=condicao||' and ((select public.modalidade_filtro_300())=''todos'' or p.modalidade_venda=(select public.modalidade_filtro_300()))';end if;
  execute format('create or replace view public.%I with(security_invoker=true) as select p.*,coalesce((a.aprovada_em at time zone ''America/Sao_Paulo'')::date,p.data_pedido) as data_competencia_372 from public.pedidos p left join public.pedido_comissao_aprovacoes_305 a on a.pedido_id=p.id and a.ciclo=coalesce(p.ciclo_reabertura_289,0) where %s',nome,condicao);
  execute format('revoke all on public.%I from public,anon',nome);
  execute format('grant select on public.%I to authenticated,service_role',nome);
 end loop;
end $$;
-- O JOIN indexado substitui várias chamadas escalares por registro.
-- Mantém a ordem e os tipos das colunas das visões existentes.
do $$declare nome text;fonte text;sql text;begin
 foreach nome in array array['vw_comissoes_detalhe','vw_comissoes_detalhe_mod_300'] loop
  fonte:=case when nome like '%_mod_300' then 'pedidos_competencia_mod_372' else 'pedidos_competencia_372' end;
  sql:=format($view$
   select cm.id comissao_id,cm.representante_id,rp.nome representante,rp.pessoa_id,
    cm.pedido_id,p.numero pedido_numero,p.data_pedido,
    to_char(p.data_competencia_372,'YYYY-MM') mes,
    extract(year from p.data_competencia_372)::int ano,
    extract(month from p.data_competencia_372)::int mes_numero,
    p.status pedido_status,p.cliente_id,cl.razao_social cliente,
    coalesce(cm.centro_id,p.centro_id) centro_id,ce.nome centro,
    cm.base_calculo,cm.percentual,cm.valor,cm.status,cm.created_at,cpi.pagamento_id,
    p.data_competencia_372 data_competencia
   from public.comissoes cm join public.%I p on p.id=cm.pedido_id
   left join public.representantes rp on rp.id=cm.representante_id
   left join public.clientes cl on cl.id=p.cliente_id
   left join public.centros ce on ce.id=coalesce(cm.centro_id,p.centro_id)
   left join public.comissao_pagamento_itens cpi on cpi.comissao_id=cm.id
   where (public.status_comissao_valido_302(p.tipo_documento,p.status)
    or (p.tipo_documento='pedido' and p.status in('cancelado','recusado') and cm.status='cancelada'))
  $view$,fonte);
  if nome like '%_mod_300' then sql:=sql||' and ((select public.modalidade_filtro_300())=''todos'' or (public.usuario_pode_acessar_centro(p.centro_id) and (not public.escopo_representante() or public.documento_na_minha_carteira(''pedidos'',p.id))))';end if;
  execute format('create or replace view public.%I with(security_invoker=true,security_barrier=false) as %s',nome,sql);
 end loop;
end $$;
-- Conserva os resumos instalados e suas regras de metas, usando a mesma competência
-- em JOIN nas vendas realizadas. A reescrita preserva os aliases originais.
do $$declare nome text;d text;r record;mapa jsonb:='{"pedidos":"pedidos_competencia_372","pedidos_mod_300":"pedidos_competencia_mod_372","pedidos_comissao_302":"pedidos_comissao_competencia_372","pedidos_comissao_mod_302":"pedidos_comissao_competencia_mod_372"}';begin
 foreach nome in array array['vw_comissoes_resumo','vw_comissoes_resumo_mod_300'] loop
  select pg_get_viewdef(('public.'||nome)::regclass,true) into d;
  d:=regexp_replace(d,'(public\.)?data_comissao_305\(([a-zA-Z_][a-zA-Z_0-9]*)\.id\)','\2.data_competencia_372','g');
  d:=public.reescrever_leitura_300(d,mapa);
  if d ~ 'data_comissao_305[[:space:]]*\(' then raise exception 'Estrutura de resumo incompatível: %',nome;end if;
  execute format('create or replace view public.%I with(security_invoker=true) as %s',nome,d);
 end loop;
 foreach nome in array array['resumo_comissoes_loja_295','resumo_comissoes_loja_295_mod_300'] loop
  select prosrc,pg_get_functiondef(oid) def into strict r from pg_proc where pronamespace='public'::regnamespace and proname=nome;
  d:=regexp_replace(r.prosrc,'(public\.)?data_comissao_305\(([a-zA-Z_][a-zA-Z_0-9]*)\.id\)','\2.data_competencia_372','g');
  d:=public.reescrever_leitura_300(d,mapa);
  if d ~ 'data_comissao_305[[:space:]]*\(' then raise exception 'Estrutura de resumo incompatível: %',nome;end if;
  execute replace(r.def,r.prosrc,d);
 end loop;
end $$;
create index if not exists comissoes_centro_rep_status_372 on public.comissoes(centro_id,representante_id,status,pedido_id);
create index if not exists comissao_pag_itens_com_idx on public.comissao_pagamento_itens(comissao_id);
analyze public.comissoes;
analyze public.pedido_comissao_aprovacoes_305;
notify pgrst,'reload schema';
commit;
