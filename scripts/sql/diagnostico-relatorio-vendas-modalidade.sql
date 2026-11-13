-- Somente metadados de leitura. Não consulta clientes, vendas, credenciais nem altera dados.
select jsonb_build_object(
 'funcoes',coalesce((select jsonb_agg(jsonb_build_object('nome',p.proname,'argumentos',pg_get_function_arguments(p.oid),'retorno',pg_get_function_result(p.oid),'acesso_autenticado',has_function_privilege('authenticated',p.oid,'EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('relatorio_vendas_230','relatorio_vendas_230_mod_300','relatorio_vendas_filtros_230','modalidade_filtro_300','reescrever_leitura_300')),'[]'::jsonb),
 'visoes', (select jsonb_object_agg(nome,to_regclass('public.'||nome) is not null) from unnest(array['pedidos_mod_300','pedido_itens_mod_300','devolucoes_mod_300','devolucao_itens_mod_300','comissoes_mod_300']) nome)
) as diagnostico;
