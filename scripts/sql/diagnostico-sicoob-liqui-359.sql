-- Inclui todos os boletos Sicoob de produção com emissão ERP confirmada.
-- Requer fase361. Somente leitura. Uma única consulta reúne todas as seções no mesmo resultado.
-- Não exibe certificado, senha, token, segredo ou dados pessoais do pagador.
select jsonb_build_object(
 'hora_banco',now(),
 'hora_brasilia',to_char(now() at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI:SS'),
 'boletos',coalesce((
  select jsonb_agg(jsonb_build_object(
   'nosso_numero',b.nosso_numero,'documento',b.documento,'parcela',b.parcela,'status_bancario',b.status,'valor_titulo',b.valor,
   'valor_liquidado',b.valor_liquidado,'data_liquidacao',b.data_liquidacao,
   'recebimento_liqui',b.sicoob_recebimento_359,
   'status_financeiro',c.status,'valor_pago',c.valor_pago,'conta_financeira_id',c.conta_financeira_id
  )) from public.boletos b left join public.contas_receber c on c.id=b.conta_receber_id
  where b.banco='sicoob' and b.ambiente='producao' and exists(select 1 from public.sicoob_operacoes_316 o where o.boleto_id=b.id and o.tipo='emissao' and o.estado='confirmado')
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
   where e.estado='conferir' and b.banco='sicoob' and exists(select 1 from public.sicoob_operacoes_316 o where o.boleto_id=b.id and o.tipo='emissao' and o.estado='confirmado')
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
 'tarifas_boletos',coalesce((
  select jsonb_agg(jsonb_build_object(
   'nosso_numero',b.nosso_numero,'data',t.data_lancamento,'valor',t.valor,
   'fonte',t.fonte_361,'natureza',t.natureza_361,'motivo',t.motivo_361,
   'estado_importacao',t.estado,'movimento_id',t.movimento_id,
   'status_movimento',m.status,'tipo_movimento',m.tipo,'valor_movimento',m.valor,
   'conta_id',t.conta_id,'categoria_id',t.categoria_id
  )) from public.sicoob_tarifas_financeiro_355 t
  join public.boletos b on b.id=t.boleto_id
  left join public.movimentos_financeiros m on m.id=t.movimento_id
  where b.banco='sicoob' and b.ambiente='producao' and exists(select 1 from public.sicoob_operacoes_316 o where o.boleto_id=b.id and o.tipo='emissao' and o.estado='confirmado')
 ),'[]'::jsonb),
 'configuracao_tarifas',coalesce((
  select jsonb_agg(jsonb_build_object(
   'centro_id',c.centro_id,'ativo',c.ativo,'inicio',c.inicio,
   'ultima_consulta',c.ultima_consulta,'proxima_consulta',c.proxima_consulta,'erro',c.erro,
   'ultima_tarifa_liqui',c.ultima_liqui_361,'erro_tarifa_liqui',c.erro_liqui_361
  )) from public.sicoob_tarifas_config_355 c
  where exists(select 1 from public.boletos b where b.centro_id=c.centro_id and b.banco='sicoob' and b.ambiente='producao' and exists(select 1 from public.sicoob_operacoes_316 o where o.boleto_id=b.id and o.tipo='emissao' and o.estado='confirmado'))
 ),'[]'::jsonb),
 'agendamentos',coalesce((
  select jsonb_agg(jsonb_build_object('jobname',jobname,'schedule',schedule,'active',active))
  from cron.job where jobname in('sicoob-liqui-359','sicoob-consulta-358','sicoob-tarifas-355','sicoob-tarifa-liqui-361')
 ),'[]'::jsonb)
) as diagnostico;
