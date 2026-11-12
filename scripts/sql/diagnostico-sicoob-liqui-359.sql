-- Somente leitura. Uma única consulta reúne todas as seções no mesmo resultado.
-- Não exibe certificado, senha, token, segredo ou dados pessoais do pagador.
select jsonb_build_object(
 'hora_banco',now(),
 'hora_brasilia',to_char(now() at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI:SS'),
 'boletos',coalesce((
  select jsonb_agg(jsonb_build_object(
   'nosso_numero',b.nosso_numero,'status_bancario',b.status,'valor_titulo',b.valor,
   'valor_liquidado',b.valor_liquidado,'data_liquidacao',b.data_liquidacao,
   'recebimento_liqui',b.sicoob_recebimento_359,
   'status_financeiro',c.status,'valor_pago',c.valor_pago,'conta_financeira_id',c.conta_financeira_id
  )) from public.boletos b left join public.contas_receber c on c.id=b.conta_receber_id
  where b.banco='sicoob' and b.ambiente='producao' and b.nosso_numero='3849'
 ),'[]'::jsonb),
 'ultimas_coletas',coalesce((
  select jsonb_agg(to_jsonb(x)) from (
   select centro_id,inicio,fim,estado,codigo,arquivos,feitos,proxima,erros,erro,diagnostico,updated_at,
    coalesce(lease_ate>now(),false) as reserva_ativa,lease_ate
   from public.sicoob_liqui_jobs_359 order by updated_at desc limit 5
  ) x
 ),'[]'::jsonb),
 'pendencias',coalesce((
  select jsonb_agg(to_jsonb(x)) from (
   select e.centro_id,e.estado,e.motivo,e.dados
   from public.sicoob_liqui_eventos_359 e join public.boletos b on b.id=e.boleto_id
   where e.estado='conferir' and b.banco='sicoob' and b.nosso_numero='3849'
   order by e.created_at desc limit 5
  ) x
 ),'[]'::jsonb),
 'execucoes_recentes',coalesce((
  select jsonb_agg(to_jsonb(x)) from (
   select j.jobname,r.status,r.start_time,r.end_time
   from cron.job_run_details r join cron.job j on j.jobid=r.jobid
   where j.jobname='sicoob-liqui-359' order by r.start_time desc limit 5
  ) x
 ),'[]'::jsonb),
 'agendamentos',coalesce((
  select jsonb_agg(jsonb_build_object('jobname',jobname,'schedule',schedule,'active',active))
  from cron.job where jobname in('sicoob-liqui-359','sicoob-consulta-358','sicoob-tarifas-355')
 ),'[]'::jsonb)
) as diagnostico;
