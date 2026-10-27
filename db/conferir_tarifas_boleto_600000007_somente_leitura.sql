-- Somente leitura: resultado específico do boleto e acompanhamento por data.
-- Não exibe credenciais, segredo de agendamento ou dados do pagador.
with alvo as (
 select id,cooperativa,posto,codigo_beneficiario,data_emissao from public.boletos
 where nosso_numero='600000007' and banco='sicredi' and canal='api' and ambiente='producao'
), dias as (
 select b.*,d::date as dia from alvo b cross join lateral generate_series(
 greatest(b.data_emissao,(now() at time zone 'America/Sao_Paulo')::date-30),
 (now() at time zone 'America/Sao_Paulo')::date,interval '1 day') d
)
select d.id as boleto_id,d.dia as data_lancamento,
 case when f.lease_ate>now() then 'EM_CONSULTA'
 when f.erro is not null then 'FALHA_NA_CONSULTA'
 when f.proxima_consulta<=now() then 'AGUARDANDO_CONSULTA'
 when f.consultado_em is null then 'NAO_CONSULTADO'
 when t.boleto_id is null then 'CONSULTADO_SEM_DEBITOS_VINCULADOS'
 else 'RETORNO_DISPONIVEL' end as acompanhamento,
 f.consultado_em as ultima_consulta_da_data,f.erro as erro_da_consulta,
 t.consultado_em as retorno_salvo_em,t.tarifa_total as tarifas_identificadas_na_api,
 t.outros_debitos as quantidade_debitos_a_conferir,t.debitos as debitos_retornados_pelo_banco
from dias d
left join public.sicredi_tarifas_fila_280 f on f.cooperativa=d.cooperativa and f.posto=d.posto and f.beneficiario=d.codigo_beneficiario and f.dia=d.dia
left join public.sicredi_tarifas_api_280 t on t.boleto_id=d.id and t.data_lancamento=d.dia
order by d.id,d.dia;
