-- Somente leitura, após aplicar fase358 e aguardar a rotina agendada.
-- Não consulta/exibe segredos, certificado, token ou dados do pagador.
select b.nosso_numero,b.status,b.valor,b.vencimento,f.ultima_consulta,
 f.proxima_consulta,f.resultado,f.erros,f.diagnostico
from public.boletos b left join public.sicoob_auto_fila_358 f on f.boleto_id=b.id
where b.banco='sicoob' and b.canal='api' and b.ambiente='producao'
order by b.created_at desc limit 20;
select jobname,schedule,active from cron.job
where jobname in('sicoob-consulta-358','sicoob-tarifas-355');
select centro_id,ativo,inicio,ultima_consulta,proxima_consulta,erro
from public.sicoob_tarifas_config_355;
