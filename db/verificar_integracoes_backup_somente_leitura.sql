-- ETAPA1: inventário de estruturas, SOMENTE LEITURA.
-- Execute no SQL Editor administrativo e exporte o resultado CSV.
-- Funciona mesmo quando as tabelas das integrações ainda não existem.
-- Não lê credenciais/conteúdo das tabelas, não cria estruturas e não chama serviços.
-- Presença de uma estrutura não comprova configuração, execução ou homologação.
with tabelas(area,nome,fase,colunas) as (
 values
 ('Backup','public.backup_execucoes_268','268',array['estado','copia_externa_verificada','finalizado_em','solicitado_em']::text[]),
 ('Forecast','public.forecast_credenciais_262','262',array['centro_id','cnpj','ambiente_declarado']::text[]),
 ('Forecast','public.forecast_liberacao_hml_266','266',array['centro_id','liberado']::text[]),
 ('Forecast','public.forecast_homologacoes_266','266',array['nota_id','centro_id','estado','envio_iniciado_em']::text[]),
 ('Forecast','public.forecast_documentos_hml_267','267',array['nota_id','tipo']::text[]),
 ('Sicredi','public.sicredi_auto_config_247','247',array['id','ativo','ultima_chamada']::text[]),
 ('Sicredi','public.sicredi_auto_fila_247','247',array['ultima_consulta','erro']::text[]),
 ('Sicredi','public.boletos','cobrança/API',array['id','centro_id','banco','canal','ambiente','status']::text[]),
 ('Cadastro','public.centros','lojas',array['id','nome','ativo','cnpj']::text[])
), funcoes(area,assinatura,fase) as (
 values
 ('Backup','public.solicitar_backup_268()','268'),
 ('Backup','public.listar_backups_268()','268'),
 ('Backup','public.assumir_backup_268(boolean)','268'),
 ('Backup','public.finalizar_backup_268(uuid,uuid,boolean,text)','268'),
 ('Forecast','public.estado_conexao_forecast_262(uuid)','262'),
 ('Forecast','public.estado_homologacao_forecast_266(uuid)','266'),
 ('Forecast','public.status_hml_forecast_266(uuid)','266'),
 ('Forecast','public.documentos_hml_forecast_267(uuid)','267'),
 ('Sicredi','public.sicredi_auto_status_247(uuid)','247'),
 ('Sicredi','public.sicredi_auto_disparar_247()','247')
), estruturas as (
 select t.*,to_regclass(t.nome) as relacao,
 array(select col from unnest(t.colunas) col where not exists(
   select 1 from pg_attribute a where a.attrelid=to_regclass(t.nome)
   and a.attname=col and a.attnum>0 and not a.attisdropped
 )) as colunas_ausentes
 from tabelas t
), linhas as (
 select area,nome as objeto,'Estrutura e colunas necessárias'::text as verificacao,
 case when relacao is null then 'AUSENTE — conferir implantação da fase '||fase
 when cardinality(colunas_ausentes)>0 then 'INCOMPLETA — faltam colunas: '||array_to_string(colunas_ausentes,', ')
 else 'PRESENTE — execução/configuração ainda precisam ser conferidas' end as resultado
 from estruturas
 union all
 select area,assinatura,'Função necessária',
 case when to_regprocedure(assinatura) is null then 'AUSENTE — conferir implantação da fase '||fase
 else 'PRESENTE — presença não valida corpo nem execução' end
 from funcoes
 union all
 select 'Infraestrutura','pg_cron','Extensão de agendamento',
 case when exists(select 1 from pg_extension where extname='pg_cron')
 then 'PRESENTE — não comprova agendamento ativo' else 'AUSENTE — não comprova ausência de outro agendador externo' end
)
select area,objeto,verificacao,resultado from linhas order by area,objeto;
