-- Somente leitura. Execute completo no SQL Editor do projeto CaparaoSystem.
-- Não consulta chaves, senhas, tokens ou o segredo do agendamento.
select 'rotinas' as diagnostico, jsonb_agg(jsonb_build_object(
  'rotina', assinatura, 'existe', to_regprocedure(assinatura) is not null
)) as resultado
from (values
 ('public.sicredi_liquidar_api_224(uuid,uuid,jsonb)'),
 ('public.sincronizar_boleto_sicredi_servidor(uuid,uuid,text,jsonb)'),
 ('public.sicredi_token_reservar_224(text)'),
 ('public.sicredi_auto_finalizar_247(uuid,uuid,text,jsonb)'),
 ('public.receber_titulo(uuid,numeric,date,uuid,uuid,numeric,numeric,numeric,text)')
) v(assinatura)
union all
select 'consulta_automatica', jsonb_agg(jsonb_build_object(
 'documento', b.documento, 'nosso_numero', b.nosso_numero,
 'situacao_boleto', b.status, 'situacao_titulo', cr.status,
 'valor', b.valor, 'valor_pago', cr.valor_pago,
 'ultima_consulta', f.ultima_consulta, 'resultado', f.resultado,
 'erro', f.erro, 'proxima_consulta', f.proxima_consulta,
 'conta_no_titulo', cr.conta_financeira_id is not null,
 'conta_no_convenio', exists(select 1 from public.sicredi_cnab_config where conta_financeira_id is not null)
))
from public.boletos b
left join public.contas_receber cr on cr.id=b.conta_receber_id
left join public.sicredi_auto_fila_247 f on f.boleto_id=b.id
where b.banco='sicredi' and b.ambiente='producao' and b.canal='api';
