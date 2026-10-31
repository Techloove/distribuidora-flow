-- A modalidade é um recorte analítico; a segurança continua no RLS original.
-- Filtro somente de leitura: tabelas, validação de crédito e RPCs de gravação ficam intactas.
begin;
create or replace function public.modalidade_filtro_300() returns text
language plpgsql stable security invoker set search_path=public as $$declare m text;begin
 m:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-modalidade-venda',substring(nullif(current_setting('request.headers',true),'')::jsonb->>'x-client-info' from '^caparao-modalidade/(.*)$'),'todos');
 if m not in('todos','estoque','intermediacao') then raise exception 'Filtro de modalidade inválido';end if;
 return m;
end $$;
revoke all on function public.modalidade_filtro_300() from public,anon;
grant execute on function public.modalidade_filtro_300() to authenticated;
create or replace function public.pedido_modalidade_300(_pedido uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select public.usuario_ativo() and (public.modalidade_filtro_300()='todos' or exists(select 1 from public.pedidos p where p.id=_pedido and p.modalidade_venda=public.modalidade_filtro_300() and public.usuario_pode_acessar_centro(p.centro_id) and (not public.escopo_representante() or public.documento_na_minha_carteira('pedidos',p.id))));
$$;
revoke all on function public.pedido_modalidade_300(uuid) from public,anon;
grant execute on function public.pedido_modalidade_300(uuid) to authenticated;
-- Resolve o conjunto autorizado uma vez por consulta, em vez de consultar
-- permissões novamente para cada título, boleto ou movimento de caixa.
create or replace function public.pedidos_permitidos_modalidade_300() returns setof uuid
language sql stable security definer set search_path=public as $$
 select p.id from public.pedidos p where public.usuario_ativo()
 and (public.modalidade_filtro_300()='todos' or p.modalidade_venda=public.modalidade_filtro_300())
 and public.usuario_pode_acessar_centro(p.centro_id)
 and (not public.escopo_representante() or public.documento_na_minha_carteira('pedidos',p.id));
$$;
revoke all on function public.pedidos_permitidos_modalidade_300() from public,anon;
grant execute on function public.pedidos_permitidos_modalidade_300() to authenticated;
-- Um pagamento misto de comissão não recebe atribuição arbitrária a uma modalidade.
create or replace function public.pagamento_modalidade_300(_pagamento uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select public.usuario_ativo() and (public.modalidade_filtro_300()='todos' or (
 exists(select 1 from public.comissao_pagamento_itens i join public.comissoes c on c.id=i.comissao_id where i.pagamento_id=_pagamento and coalesce(c.pedido_id in(select public.pedidos_permitidos_modalidade_300()),false)) and
 not exists(select 1 from public.comissao_pagamento_itens i join public.comissoes c on c.id=i.comissao_id where i.pagamento_id=_pagamento and not coalesce(c.pedido_id in(select public.pedidos_permitidos_modalidade_300()),false))));
$$;
revoke all on function public.pagamento_modalidade_300(uuid) from public,anon;
grant execute on function public.pagamento_modalidade_300(uuid) to authenticated;
-- Títulos de comissão só entram no recorte se todos os seus vínculos concordarem.
create or replace function public.conta_pagar_modalidade_300(_titulo uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select public.usuario_ativo() and (public.modalidade_filtro_300()='todos' or coalesce((
 select bool_and(coalesce(v.pedido_id in(select public.pedidos_permitidos_modalidade_300()),false)) from (
  select c.pedido_id from public.comissao_pagamentos pg join public.comissao_pagamento_itens i on i.pagamento_id=pg.id join public.comissoes c on c.id=i.comissao_id where pg.conta_pagar_id=_titulo
  union all select c.pedido_id from public.comissao_parcelas i join public.comissoes c on c.id=i.comissao_id where i.conta_pagar_id=_titulo
 ) v),false));
$$;
revoke all on function public.conta_pagar_modalidade_300(uuid) from public,anon;
grant execute on function public.conta_pagar_modalidade_300(uuid) to authenticated;
create or replace view public.pedidos_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.pedidos x where ((select public.modalidade_filtro_300())='todos' or x.modalidade_venda=(select public.modalidade_filtro_300()));
revoke all on public.pedidos_mod_300 from public,anon;grant select on public.pedidos_mod_300 to authenticated;
create or replace view public.pedido_itens_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.pedido_itens x where ((select public.modalidade_filtro_300())='todos' or coalesce(x.pedido_id in(select public.pedidos_permitidos_modalidade_300()),false));
revoke all on public.pedido_itens_mod_300 from public,anon;grant select on public.pedido_itens_mod_300 to authenticated;
create or replace view public.contas_receber_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.contas_receber x where ((select public.modalidade_filtro_300())='todos' or coalesce(x.pedido_id in(select public.pedidos_permitidos_modalidade_300()),false));
revoke all on public.contas_receber_mod_300 from public,anon;grant select on public.contas_receber_mod_300 to authenticated;
create or replace view public.boletos_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.boletos x where ((select public.modalidade_filtro_300())='todos' or coalesce(coalesce(x.pedido_id,(select r.pedido_id from public.contas_receber r where r.id=x.conta_receber_id)) in(select public.pedidos_permitidos_modalidade_300()),false));
revoke all on public.boletos_mod_300 from public,anon;grant select on public.boletos_mod_300 to authenticated;
create or replace view public.comissoes_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.comissoes x where ((select public.modalidade_filtro_300())='todos' or coalesce(x.pedido_id in(select public.pedidos_permitidos_modalidade_300()),false));
revoke all on public.comissoes_mod_300 from public,anon;grant select on public.comissoes_mod_300 to authenticated;
create or replace view public.devolucoes_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.devolucoes x where ((select public.modalidade_filtro_300())='todos' or coalesce(x.pedido_id in(select public.pedidos_permitidos_modalidade_300()),false));
revoke all on public.devolucoes_mod_300 from public,anon;grant select on public.devolucoes_mod_300 to authenticated;
create or replace view public.devolucao_itens_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.devolucao_itens x where ((select public.modalidade_filtro_300())='todos' or exists(select 1 from public.devolucoes d where d.id=x.devolucao_id and coalesce(d.pedido_id in(select public.pedidos_permitidos_modalidade_300()),false)));
revoke all on public.devolucao_itens_mod_300 from public,anon;grant select on public.devolucao_itens_mod_300 to authenticated;
create or replace view public.expedicoes_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.expedicoes x where ((select public.modalidade_filtro_300())='todos' or coalesce(x.pedido_id in(select public.pedidos_permitidos_modalidade_300()),false));
revoke all on public.expedicoes_mod_300 from public,anon;grant select on public.expedicoes_mod_300 to authenticated;
create or replace view public.carga_pedidos_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.carga_pedidos x where ((select public.modalidade_filtro_300())='todos' or coalesce(x.pedido_id in(select public.pedidos_permitidos_modalidade_300()),false));
revoke all on public.carga_pedidos_mod_300 from public,anon;grant select on public.carga_pedidos_mod_300 to authenticated;
create or replace view public.pedido_separacoes_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.pedido_separacoes x where ((select public.modalidade_filtro_300())='todos' or coalesce(x.pedido_id in(select public.pedidos_permitidos_modalidade_300()),false));
revoke all on public.pedido_separacoes_mod_300 from public,anon;grant select on public.pedido_separacoes_mod_300 to authenticated;
create or replace view public.entrega_registros_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.entrega_registros x where ((select public.modalidade_filtro_300())='todos' or coalesce(x.pedido_id in(select public.pedidos_permitidos_modalidade_300()),false));
revoke all on public.entrega_registros_mod_300 from public,anon;grant select on public.entrega_registros_mod_300 to authenticated;
create or replace view public.comissao_pagamentos_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.comissao_pagamentos x where (public.pagamento_modalidade_300(x.id));
revoke all on public.comissao_pagamentos_mod_300 from public,anon;grant select on public.comissao_pagamentos_mod_300 to authenticated;
create or replace view public.comissao_pagamento_itens_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.comissao_pagamento_itens x where ((select public.modalidade_filtro_300())='todos' or exists(select 1 from public.comissoes c where c.id=x.comissao_id and coalesce(c.pedido_id in(select public.pedidos_permitidos_modalidade_300()),false)));
revoke all on public.comissao_pagamento_itens_mod_300 from public,anon;grant select on public.comissao_pagamento_itens_mod_300 to authenticated;
create or replace view public.comissao_ajustes_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.comissao_ajustes x where ((select public.modalidade_filtro_300())='todos' or coalesce(x.pedido_id in(select public.pedidos_permitidos_modalidade_300()),false));
revoke all on public.comissao_ajustes_mod_300 from public,anon;grant select on public.comissao_ajustes_mod_300 to authenticated;
create or replace view public.creditos_clientes_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.creditos_clientes x where ((select public.modalidade_filtro_300())='todos' or exists(select 1 from public.devolucoes d where d.id=x.devolucao_id and coalesce(d.pedido_id in(select public.pedidos_permitidos_modalidade_300()),false)));
revoke all on public.creditos_clientes_mod_300 from public,anon;grant select on public.creditos_clientes_mod_300 to authenticated;
create or replace view public.contas_pagar_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.contas_pagar x where (public.conta_pagar_modalidade_300(x.id));
revoke all on public.contas_pagar_mod_300 from public,anon;grant select on public.contas_pagar_mod_300 to authenticated;
create or replace view public.movimentos_financeiros_mod_300 with(security_invoker=true,security_barrier=false) as
 select x.* from public.movimentos_financeiros x where (select public.modalidade_filtro_300())='todos'
 or exists(select 1 from public.contas_receber_mod_300 r where r.id=x.conta_receber_id)
 or exists(select 1 from public.contas_pagar_mod_300 p where p.id=x.conta_pagar_id)
 or exists(select 1 from public.sicredi_tarifas_279 t join public.boletos_mod_300 b on b.id=t.boleto_id where t.movimento_id=x.id)
 or exists(select 1 from public.movimentos_financeiros origem where origem.id=x.estorno_de and (
 exists(select 1 from public.contas_receber_mod_300 r where r.id=origem.conta_receber_id) or exists(select 1 from public.contas_pagar_mod_300 p where p.id=origem.conta_pagar_id)));
revoke all on public.movimentos_financeiros_mod_300 from public,anon;grant select on public.movimentos_financeiros_mod_300 to authenticated;
create or replace view public.contas_financeiras_mod_300 with(security_invoker=true) as select x.id, x.codigo, x.nome, x.tipo, x.banco, x.agencia, x.conta, case when (select public.modalidade_filtro_300())='todos' then x.saldo_inicial else 0 end as saldo_inicial, x.data_saldo_inicial, x.centro_id, x.observacoes, x.ativo, x.created_at, x.updated_at, x.chave_pix, x.pix_beneficiario, x.pix_cidade from public.contas_financeiras x;
revoke all on public.contas_financeiras_mod_300 from public,anon;grant select on public.contas_financeiras_mod_300 to authenticated;
create or replace view public.cargas_mod_300 with(security_invoker=true,security_barrier=false) as select x.id, x.numero, x.rota_id, x.centro_id, x.data, x.responsavel, x.motorista, x.placa, x.transportadora_id, (case when (select public.modalidade_filtro_300())='todos' then x.volumes else (select coalesce(sum(cp.volumes),0) from public.carga_pedidos_mod_300 cp where cp.carga_id=x.id) end)::int4 as volumes, (case when (select public.modalidade_filtro_300())='todos' then x.peso_kg else (select coalesce(sum(i.quantidade*case when upper(trim(pr.unidade))='KG' then 1 else coalesce(pr.peso_kg,0) end),0) from public.carga_pedidos_mod_300 cp join public.pedido_itens i on i.pedido_id=cp.pedido_id join public.produtos pr on pr.id=i.produto_id where cp.carga_id=x.id) end)::numeric as peso_kg, (case when (select public.modalidade_filtro_300())='todos' then x.valor_total else (select coalesce(sum(p.total_liquido),0) from public.carga_pedidos_mod_300 cp join public.pedidos_mod_300 p on p.id=cp.pedido_id where cp.carga_id=x.id) end)::numeric as valor_total, x.status, x.observacoes, x.created_by, x.created_at, x.updated_at, x.capacidade_kg from public.cargas x where (select public.modalidade_filtro_300())='todos' or exists(select 1 from public.carga_pedidos_mod_300 cp where cp.carga_id=x.id);
revoke all on public.cargas_mod_300 from public,anon;grant select on public.cargas_mod_300 to authenticated;
create or replace view public.rota_despesas_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.rota_despesas x where ((select public.modalidade_filtro_300())='todos');
revoke all on public.rota_despesas_mod_300 from public,anon;grant select on public.rota_despesas_mod_300 to authenticated;
create or replace view public.comissao_parcelas_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.comissao_parcelas x where ((select public.modalidade_filtro_300())='todos' or exists(select 1 from public.comissoes c where c.id=x.comissao_id and coalesce(c.pedido_id in(select public.pedidos_permitidos_modalidade_300()),false)));
revoke all on public.comissao_parcelas_mod_300 from public,anon;grant select on public.comissao_parcelas_mod_300 to authenticated;
create or replace view public.extrato_bancario_linhas_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.extrato_bancario_linhas x where ((select public.modalidade_filtro_300())='todos' or exists(select 1 from public.movimentos_financeiros_mod_300 m where m.id=x.movimento_id));
revoke all on public.extrato_bancario_linhas_mod_300 from public,anon;grant select on public.extrato_bancario_linhas_mod_300 to authenticated;
create or replace view public.sicredi_boleto_alteracoes_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.sicredi_boleto_alteracoes x where ((select public.modalidade_filtro_300())='todos' or exists(select 1 from public.boletos_mod_300 b where b.id=x.boleto_id));
revoke all on public.sicredi_boleto_alteracoes_mod_300 from public,anon;grant select on public.sicredi_boleto_alteracoes_mod_300 to authenticated;
create or replace view public.sicredi_tarifas_279_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.sicredi_tarifas_279 x where ((select public.modalidade_filtro_300())='todos' or exists(select 1 from public.boletos_mod_300 b where b.id=x.boleto_id));
revoke all on public.sicredi_tarifas_279_mod_300 from public,anon;grant select on public.sicredi_tarifas_279_mod_300 to authenticated;
create or replace view public.sicredi_tarifas_api_280_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.sicredi_tarifas_api_280 x where ((select public.modalidade_filtro_300())='todos' or exists(select 1 from public.boletos_mod_300 b where b.id=x.boleto_id));
revoke all on public.sicredi_tarifas_api_280_mod_300 from public,anon;grant select on public.sicredi_tarifas_api_280_mod_300 to authenticated;
create or replace view public.sicredi_tarifas_financeiro_282_mod_300 with(security_invoker=true,security_barrier=false) as select x.* from public.sicredi_tarifas_financeiro_282 x where ((select public.modalidade_filtro_300())='todos' or exists(select 1 from public.boletos_mod_300 b where b.id=x.boleto_id));
revoke all on public.sicredi_tarifas_financeiro_282_mod_300 from public,anon;grant select on public.sicredi_tarifas_financeiro_282_mod_300 to authenticated;

-- Reescreve somente identificadores SQL; textos de permissões/carteira e comentários
-- permanecem literais. A função é privada e não executa SQL fornecido pelo navegador.
create or replace function public.reescrever_leitura_300(_src text,_map jsonb) returns text
language plpgsql immutable security invoker set search_path=public as $$
declare i int:=1;j int;n int:=length(_src);c text;token text;saida text:='';nivel int;
 textos text[]:='{}';tipos text[]:='{}';tipo text;anteriores int[]:='{}';proximos int[]:='{}';ultimo int:=0;k int;ant int;prox int;qualificado boolean;relacao boolean;chave text;ctes text[]:='{}';m text[];
begin
 for m in select regexp_matches(_src,'(?:with|,)[[:space:]]*([a-z_][a-z_0-9]*)[[:space:]]+as[[:space:]]*\(','gi') loop ctes:=array_append(ctes,lower(m[1]));end loop;
 while i<=n loop
  c:=substr(_src,i,1);tipo:='outro';j:=i+1;
  if c='''' then
   while j<=n loop if substr(_src,j,1)='''' then if substr(_src,j+1,1)='''' then j:=j+2;continue;else j:=j+1;exit;end if;end if;j:=j+1;end loop;
  elsif substr(_src,i,2)='--' then
   j:=strpos(substr(_src,i),chr(10));if j=0 then j:=n+1;else j:=i+j;end if;tipo:='espaco';
  elsif substr(_src,i,2)='/*' then
   j:=i+2;nivel:=1;while j<=n and nivel>0 loop if substr(_src,j,2)='/*' then nivel:=nivel+1;j:=j+2;elsif substr(_src,j,2)='*/' then nivel:=nivel-1;j:=j+2;else j:=j+1;end if;end loop;tipo:='espaco';
  elsif c='"' then
   while j<=n loop if substr(_src,j,1)='"' then if substr(_src,j+1,1)='"' then j:=j+2;continue;else j:=j+1;exit;end if;end if;j:=j+1;end loop;tipo:='ident';
  elsif c~'^[a-zA-Z_]$' then
   while j<=n and substr(_src,j,1)~'^[a-zA-Z_0-9$]$' loop j:=j+1;end loop;tipo:='ident';
  elsif c~'[[:space:]]' then while j<=n and substr(_src,j,1)~'[[:space:]]' loop j:=j+1;end loop;tipo:='espaco';
  end if;
  textos:=array_append(textos,substr(_src,i,j-i));tipos:=array_append(tipos,tipo);i:=j;
 end loop;
 n:=coalesce(array_length(textos,1),0);
 for k in 1..n loop anteriores[k]:=ultimo;if tipos[k]<>'espaco' then ultimo:=k;end if;end loop;
 ultimo:=0;for k in reverse n..1 loop proximos[k]:=ultimo;if tipos[k]<>'espaco' then ultimo:=k;end if;end loop;
 for k in 1..n loop
  token:=textos[k];chave:=lower(trim(both '"' from token));ant:=anteriores[k];prox:=proximos[k];relacao:=false;qualificado:=false;
  if tipos[k]='ident' and _map ? chave then
   if prox>0 and textos[prox]='(' then token:=quote_ident(_map->>chave);
   else
    if ant>0 and lower(textos[ant]) in('from','join') then relacao:=true;
    elsif ant>0 and textos[ant]='.' and anteriores[ant]>0 and lower(trim(both '"' from textos[anteriores[ant]]))='public' then
     j:=anteriores[anteriores[ant]];if j>0 and lower(textos[j]) in('from','join') then relacao:=true;qualificado:=true;end if;
    end if;
    if prox>0 and textos[prox]='.' then relacao:=false;end if;
    if relacao and (qualificado or not(chave=any(ctes))) then
     token:=quote_ident(_map->>chave);
     if prox=0 or tipos[prox]<>'ident' or lower(textos[prox]) in('where','join','left','right','full','inner','outer','cross','group','order','having','limit','offset','union','except','intersect','on','window','for','loop','then','returning') then token:=token||' as '||quote_ident(chave);end if;
    end if;
   end if;
  end if;
  saida:=saida||token;
 end loop;return saida;
end $$;
revoke all on function public.reescrever_leitura_300(text,jsonb) from public,anon,authenticated,service_role;

do $migration$declare mapa jsonb:=$map${"pedidos":"pedidos_mod_300","pedido_itens":"pedido_itens_mod_300","contas_receber":"contas_receber_mod_300","contas_pagar":"contas_pagar_mod_300","boletos":"boletos_mod_300","comissoes":"comissoes_mod_300","movimentos_financeiros":"movimentos_financeiros_mod_300","contas_financeiras":"contas_financeiras_mod_300","devolucoes":"devolucoes_mod_300","devolucao_itens":"devolucao_itens_mod_300","expedicoes":"expedicoes_mod_300","cargas":"cargas_mod_300","carga_pedidos":"carga_pedidos_mod_300","pedido_separacoes":"pedido_separacoes_mod_300","entrega_registros":"entrega_registros_mod_300","comissao_pagamentos":"comissao_pagamentos_mod_300","comissao_pagamento_itens":"comissao_pagamento_itens_mod_300","comissao_ajustes":"comissao_ajustes_mod_300","creditos_clientes":"creditos_clientes_mod_300","vw_resultado_estimado_215":"vw_resultado_estimado_215_mod_300","vw_rota_resultado":"vw_rota_resultado_mod_300","vw_dre_base":"vw_dre_base_mod_300","vw_comissao_proporcional_217":"vw_comissao_proporcional_217_mod_300","vw_lead_rota":"vw_lead_rota_mod_300","vw_lead_pedidos":"vw_lead_pedidos_mod_300","vw_lead_produtos_cliente":"vw_lead_produtos_cliente_mod_300","vw_boletos_pendentes":"vw_boletos_pendentes_mod_300","vw_titulos_receber":"vw_titulos_receber_mod_300","vw_titulos_pagar":"vw_titulos_pagar_mod_300","vw_fluxo_realizado":"vw_fluxo_realizado_mod_300","vw_rentabilidade_item":"vw_rentabilidade_item_mod_300","vw_fluxo_previsto":"vw_fluxo_previsto_mod_300","vw_despesas_categoria":"vw_despesas_categoria_mod_300","vw_carga_pedidos":"vw_carga_pedidos_mod_300","vw_comissoes_resumo":"vw_comissoes_resumo_mod_300","vw_cpv":"vw_cpv_mod_300","vw_cliente_titulos":"vw_cliente_titulos_mod_300","vw_vendas_mensal":"vw_vendas_mensal_mod_300","vw_top_produtos":"vw_top_produtos_mod_300","vw_top_clientes":"vw_top_clientes_mod_300","vw_comissoes_representante":"vw_comissoes_representante_mod_300","vw_fluxo_caixa":"vw_fluxo_caixa_mod_300","vw_metas_acompanhamento":"vw_metas_acompanhamento_mod_300","vw_margem_pedido_209":"vw_margem_pedido_209_mod_300","vw_cliente_historico":"vw_cliente_historico_mod_300","vw_clientes_inativos":"vw_clientes_inativos_mod_300","vw_carteira_comercial_209":"vw_carteira_comercial_209_mod_300","vw_lead_rota_metas":"vw_lead_rota_metas_mod_300","vw_historico_cliente":"vw_historico_cliente_mod_300","vw_extrato_conta":"vw_extrato_conta_mod_300","vw_conta_saldo":"vw_conta_saldo_mod_300","vw_pedidos_para_carga":"vw_pedidos_para_carga_mod_300","vw_fluxo_operacional":"vw_fluxo_operacional_mod_300","vw_conciliacao_creditos_dev":"vw_conciliacao_creditos_dev_mod_300","vw_cargas":"vw_cargas_mod_300","vw_separacao":"vw_separacao_mod_300","vw_comissoes_detalhe":"vw_comissoes_detalhe_mod_300","vw_relatorio_vendas":"vw_relatorio_vendas_mod_300","vw_receita_vendas":"vw_receita_vendas_mod_300","vw_vendas_rota":"vw_vendas_rota_mod_300","vw_vendas_rota_cidade":"vw_vendas_rota_cidade_mod_300","vw_produtos_rota":"vw_produtos_rota_mod_300","vw_vendas_representante_rota":"vw_vendas_representante_rota_mod_300","vw_contas_receber_efetivas_299":"vw_contas_receber_efetivas_299_mod_300","contas_receber_efetivas_internas_299":"contas_receber_efetivas_internas_299_mod_300","vw_rentabilidade_pedido":"vw_rentabilidade_pedido_mod_300","vw_cobranca_clientes_209":"vw_cobranca_clientes_209_mod_300","vw_dre_mensal":"vw_dre_mensal_mod_300","dashboard_resumo":"dashboard_resumo_mod_300","dashboard_financeiro":"dashboard_financeiro_mod_300","dashboard_rankings":"dashboard_rankings_mod_300","comparativo_centros_220":"comparativo_centros_220_mod_300","relatorio_vendas_230":"relatorio_vendas_230_mod_300","painel_vendas_representante_284":"painel_vendas_representante_284_mod_300","resumo_comissoes_loja_295":"resumo_comissoes_loja_295_mod_300","agenda_clientes_228":"agenda_clientes_228_mod_300","agenda_titulos_228":"agenda_titulos_228_mod_300","agenda_leads_base_229":"agenda_leads_base_229_mod_300","agenda_leads_229":"agenda_leads_229_mod_300","entregas_listar_232":"entregas_listar_232_mod_300","rota_despesas":"rota_despesas_mod_300","comissao_parcelas":"comissao_parcelas_mod_300","extrato_bancario_linhas":"extrato_bancario_linhas_mod_300","sicredi_boleto_alteracoes":"sicredi_boleto_alteracoes_mod_300","sicredi_tarifas_279":"sicredi_tarifas_279_mod_300","sicredi_tarifas_api_280":"sicredi_tarifas_api_280_mod_300","sicredi_tarifas_financeiro_282":"sicredi_tarifas_financeiro_282_mod_300","vw_rota_despesas":"vw_rota_despesas_mod_300"}$map$::jsonb;
 nome text;novo text;def text;r record;begin
 foreach nome in array array['vw_rota_despesas','contas_receber_efetivas_internas_299','vw_boletos_pendentes','vw_carga_pedidos','vw_cargas','vw_carteira_comercial_209','vw_cliente_historico','vw_cliente_titulos','vw_clientes_inativos','vw_comissao_proporcional_217','vw_comissoes_detalhe','vw_comissoes_representante','vw_conciliacao_creditos_dev','vw_conta_saldo','vw_contas_receber_efetivas_299','vw_cpv','vw_despesas_categoria','vw_extrato_conta','vw_fluxo_caixa','vw_fluxo_operacional','vw_fluxo_realizado','vw_historico_cliente','vw_lead_pedidos','vw_lead_produtos_cliente','vw_lead_rota','vw_lead_rota_metas','vw_margem_pedido_209','vw_metas_acompanhamento','vw_pedidos_para_carga','vw_produtos_rota','vw_receita_vendas','vw_relatorio_vendas','vw_rentabilidade_item','vw_separacao','vw_titulos_pagar','vw_titulos_receber','vw_top_clientes','vw_top_produtos','vw_vendas_mensal','vw_vendas_representante_rota','vw_vendas_rota','vw_vendas_rota_cidade','vw_cobranca_clientes_209','vw_comissoes_resumo','vw_dre_base','vw_fluxo_previsto','vw_rentabilidade_pedido','vw_resultado_estimado_215','vw_dre_mensal','vw_rota_resultado'] loop
  novo:=mapa->>nome;
  select pg_get_viewdef(('public.'||nome)::regclass,true) into def;
  def:=public.reescrever_leitura_300(def,mapa);
  -- A projeção por visão perde a dependência funcional da PK; mantém as mesmas
  -- linhas agrupando explicitamente as colunas que já eram determinadas por ela.
  if nome in('vw_cargas','vw_conta_saldo') then
   def:=replace(def,'GROUP BY c.id','GROUP BY c.id, '||(select string_agg('c.'||quote_ident(a.attname),', ' order by a.attnum) from pg_attribute a where a.attrelid=(case when nome='vw_cargas' then 'public.cargas' else 'public.contas_financeiras' end)::regclass and a.attnum>0 and not a.attisdropped and a.attname<>'id'));
  end if;
  execute format('create or replace view public.%I with(security_invoker=true,security_barrier=false) as %s',novo,def);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',novo);
  if has_table_privilege('authenticated',('public.'||nome)::regclass,'SELECT') then execute format('grant select on public.%I to authenticated',novo);end if;
  if has_table_privilege('service_role',('public.'||nome)::regclass,'SELECT') then execute format('grant select on public.%I to service_role',novo);end if;
 end loop;
 foreach nome in array array['agenda_leads_base_229','agenda_clientes_228','agenda_titulos_228','agenda_leads_229','dashboard_resumo','dashboard_financeiro','dashboard_rankings','comparativo_centros_220','relatorio_vendas_230','painel_vendas_representante_284','resumo_comissoes_loja_295','entregas_listar_232'] loop
  for r in select p.oid,p.prosrc,pg_get_function_identity_arguments(p.oid) args from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=nome and p.prokind='f' loop
   novo:=mapa->>nome;def:=pg_get_functiondef(r.oid);
   -- Somente motores de leitura enumerados; nunca clonar uma rotina de gravação.
   if r.prosrc ~* '\m(insert[[:space:]]+into|update[[:space:]]+public\.|delete[[:space:]]+from)\M' then raise exception 'Motor % contém gravação; filtro recusado',nome;end if;
   def:=replace(def,r.prosrc,public.reescrever_leitura_300(r.prosrc,mapa));
   def:=regexp_replace(def,'FUNCTION public\.'||nome||'\(', 'FUNCTION public.'||novo||'(');
   execute def;
   execute format('revoke all on function public.%I(%s) from public,anon,authenticated,service_role',novo,r.args);
   if has_function_privilege('authenticated',r.oid,'EXECUTE') then execute format('grant execute on function public.%I(%s) to authenticated',novo,r.args);end if;
   if has_function_privilege('service_role',r.oid,'EXECUTE') then execute format('grant execute on function public.%I(%s) to service_role',novo,r.args);end if;
  end loop;
 end loop;
end $migration$;
notify pgrst,'reload schema';
commit;
