-- Somente leitura; não exibe certificado, senha, token, segredo ou dados pessoais do pagador.
select b.nosso_numero,b.status,b.valor,b.valor_liquidado,b.data_liquidacao,
 b.sicoob_recebimento_359,c.status as situacao_titulo,c.valor_pago,c.conta_financeira_id
from public.boletos b left join public.contas_receber c on c.id=b.conta_receber_id
where b.banco='sicoob' and b.ambiente='producao' order by b.created_at desc limit 20;
select centro_id,inicio,fim,estado,codigo,arquivos,feitos,proxima,erros,erro,diagnostico
from public.sicoob_liqui_jobs_359 order by updated_at desc limit 10;
select centro_id,estado,motivo,dados from public.sicoob_liqui_eventos_359
where estado='conferir' order by created_at desc limit 20;
select jobname,schedule,active from cron.job where jobname in('sicoob-liqui-359','sicoob-consulta-358','sicoob-tarifas-355');
