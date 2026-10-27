-- SOMENTE LEITURA. Não consulta o banco Sicredi nem repete cobrança/baixa.
-- Lista códigos conhecidos da fila; mensagens desconhecidas são ocultadas.
-- A pendência usa a mesma regra do painel: erro em boleto não liquidado,
-- ainda registrado ou cujo resultado exige conferência. Erros históricos são separados.
with erros as (
 select f.boleto_id,b.centro_id,c.nome as loja,b.status as estado_boleto,
 b.ambiente,b.canal,b.conta_receber_id,t.status as estado_titulo,
 f.actor is not null as responsavel_definido,coalesce(p.ativo,false) as responsavel_ativo,
 f.ultima_consulta,f.proxima_consulta,
 case when f.erro in('SITUACAO_DIVERGENTE','CONFERENCIA_FINANCEIRA','CONSULTA_FALHOU',
 'CONVENIO_DIVERGENTE','SEM_RESPONSAVEL','DADOS_INCOMPLETOS') then f.erro
 else 'OUTRO_CODIGO_NAO_EXIBIDO' end as codigo_erro,
 case when f.resultado in('pendente','adiado','liquidado','baixado','ja_processado',
 'conferencia','consulta_falhou','convenio_divergente','sem_responsavel','dados_incompletos')
 then f.resultado else 'OUTRO_RESULTADO_NAO_EXIBIDO' end as resultado_automatico,
 coalesce(b.status<>'liquidado' and (b.status='registrado' or f.resultado='conferencia'),false) as pendente_no_painel
 from public.sicredi_auto_fila_247 f
 left join public.boletos b on b.id=f.boleto_id
 left join public.centros c on c.id=b.centro_id
 left join public.contas_receber t on t.id=b.conta_receber_id
 left join public.profiles p on p.id=f.actor
 where f.erro is not null
)
select loja,boleto_id,conta_receber_id,
 case when pendente_no_painel then 'PENDÊNCIA ATUAL' else 'HISTÓRICO — conferir estado atual' end as classificacao,
 codigo_erro,resultado_automatico,estado_boleto,estado_titulo,ambiente,canal,
 responsavel_definido,responsavel_ativo,
 ultima_consulta at time zone 'America/Sao_Paulo' as ultima_consulta_brasilia,
 proxima_consulta at time zone 'America/Sao_Paulo' as proxima_consulta_brasilia,
 case codigo_erro
 when 'SEM_RESPONSAVEL' then 'Conferir administrador ativo autorizado para o financeiro desta loja.'
 when 'CONVENIO_DIVERGENTE' then 'Conferir identificação do convênio e ambiente do boleto com o retorno bancário.'
 when 'DADOS_INCOMPLETOS' then 'Conferir os dados necessários para consultar o boleto.'
 when 'CONSULTA_FALHOU' then 'Investigar falha da consulta no servidor; este código não identifica sozinho a causa.'
 when 'CONFERENCIA_FINANCEIRA' then 'Retorno bancário exige revisão do lançamento financeiro antes de efetivar a baixa.'
 when 'SITUACAO_DIVERGENTE' then 'Boleto cancelado/baixado com retorno de liquidação; conferir o histórico.'
 else 'Código não previsto; revisar no ambiente administrativo sem compartilhar credenciais.' end as orientacao
from erros
order by pendente_no_painel desc,loja,ultima_consulta desc,boleto_id;
