-- SOMENTE LEITURA. Execute no SQL Editor administrativo e exporte o resultado CSV.
-- Não emite notas, não registra boletos, não baixa títulos e não inicia backups.
-- Não retorna token, senha, segredo, conteúdo fiscal ou caminhos dos arquivos.
-- Registro no banco é evidência de execução, não certificação do serviço externo.
with linhas as (
 select 'Backup'::text as area,'Todas as lojas'::text as loja,
 'Cópias com sucesso e verificação externa registrada'::text as verificacao,
 count(*)::text as resultado from public.backup_execucoes_268 where estado='sucesso' and copia_externa_verificada
 union all
 select 'Backup','Todas as lojas','Última cópia com verificação externa registrada (Brasília)',
 coalesce(to_char(max(finalizado_em) at time zone 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS'),'Nenhum registro')
 from public.backup_execucoes_268 where estado='sucesso' and copia_externa_verificada
 union all
 select 'Backup','Todas as lojas','Solicitações aguardando executor',count(*)::text from public.backup_execucoes_268 where estado='pendente'
 union all
 select 'Backup','Todas as lojas','Execuções em andamento',count(*)::text from public.backup_execucoes_268 where estado='executando'
 union all
 select 'Backup','Todas as lojas','Execuções com falha nos últimos 7 dias',count(*)::text from public.backup_execucoes_268
 where estado='falha' and solicitado_em>=now()-interval '7 days'
 union all
 select 'Forecast',c.nome,'Credencial cadastrada',case when f.centro_id is not null then 'Sim' else 'Não' end
 from public.centros c left join public.forecast_credenciais_262 f on f.centro_id=c.id where c.ativo
 union all
 select 'Forecast',c.nome,'Ambiente declarado na credencial',coalesce(f.ambiente_declarado,'Não configurado')
 from public.centros c left join public.forecast_credenciais_262 f on f.centro_id=c.id where c.ativo
 union all
 select 'Forecast',c.nome,'CNPJ da credencial coincide com cadastro atual',case when f.centro_id is null then 'Sem credencial'
 when f.cnpj=upper(regexp_replace(coalesce(c.cnpj,''),'[^A-Za-z0-9]','','g')) then 'Sim' else 'Não' end
 from public.centros c left join public.forecast_credenciais_262 f on f.centro_id=c.id where c.ativo
 union all
 select 'Forecast',c.nome,'Tentativas de homologação com envio iniciado',count(h.nota_id)::text
 from public.centros c left join public.forecast_homologacoes_266 h on h.centro_id=c.id and h.envio_iniciado_em is not null
 where c.ativo group by c.id,c.nome
 union all
 select 'Forecast',c.nome,'Homologações com estado autorizada registrado',count(h.nota_id)::text
 from public.centros c left join public.forecast_homologacoes_266 h on h.centro_id=c.id and h.estado='autorizada'
 where c.ativo group by c.id,c.nome
 union all
 select 'Forecast',c.nome,'XML de homologação armazenado',count(d.nota_id)::text
 from public.centros c left join public.forecast_homologacoes_266 h on h.centro_id=c.id
 left join public.forecast_documentos_hml_267 d on d.nota_id=h.nota_id and d.tipo='xml'
 where c.ativo group by c.id,c.nome
 union all
 select 'Sicredi','Todas as lojas','Consulta automática marcada como ativa',
 case when exists(select 1 from public.sicredi_auto_config_247 where id and ativo) then 'Sim' else 'Não' end
 union all
 select 'Sicredi','Todas as lojas','Última chamada aceita pela rotina (Brasília)',
 coalesce(to_char(max(ultima_chamada) at time zone 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS'),'Nenhum registro')
 from public.sicredi_auto_config_247
 union all
 select 'Sicredi','Todas as lojas','Última consulta de boleto concluída pela rotina (Brasília)',
 coalesce(to_char(max(ultima_consulta) at time zone 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS'),'Nenhum registro')
 from public.sicredi_auto_fila_247
 union all
 select 'Sicredi','Todas as lojas','Consultas com erro registrado na fila',count(*)::text from public.sicredi_auto_fila_247 where erro is not null
 union all
 select 'Sicredi',c.nome,'Boletos API de produção registrados (ainda não liquidados)',count(b.id)::text
 from public.centros c left join public.boletos b on b.centro_id=c.id and b.banco='sicredi'
 and b.canal='api' and b.ambiente='producao' and b.status='registrado'
 where c.ativo group by c.id,c.nome
 union all
 select 'Sicredi',c.nome,'Boletos API de produção com estado liquidado registrado',count(b.id)::text
 from public.centros c left join public.boletos b on b.centro_id=c.id and b.banco='sicredi'
 and b.canal='api' and b.ambiente='producao' and b.status='liquidado'
 where c.ativo group by c.id,c.nome
 union all
 select 'Infraestrutura','Banco','Extensão pg_cron instalada (não comprova agendamento ativo)',
 case when exists(select 1 from pg_extension where extname='pg_cron') then 'Sim' else 'Não' end
)
select area,loja,verificacao,resultado from linhas order by area,loja,verificacao;
