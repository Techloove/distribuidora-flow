-- Executar inteiro no SQL Editor do Supabase, após publicar versão1.5.0 ou superior.
-- Prioriza consultas GET da Francesinha desde a emissão deste boleto até hoje (máximo31 datas).
-- Atualiza somente a fila de consulta/cache. Não altera boletos, títulos ou movimentos financeiros.
begin;
do $$declare b public.boletos;hoje date:=(now() at time zone 'America/Sao_Paulo')::date;begin
 if to_regclass('public.sicredi_tarifas_fila_280') is null or to_regprocedure('public.sicredi_tarifas_disparar_280()') is null then
 raise exception 'Aplique a fase280 antes desta consulta';end if;
 if (select count(*) from public.boletos where nosso_numero='600000007' and banco='sicredi' and canal='api' and ambiente='producao')<>1 then
 raise exception 'Boleto600000007 ausente ou ambíguo. Confira a identificação antes de consultar';end if;
 select * into b from public.boletos where nosso_numero='600000007' and banco='sicredi' and canal='api' and ambiente='producao';
 if b.data_emissao is null or b.data_emissao>hoje or hoje-b.data_emissao>30 then
 raise exception 'Confira o período: esta consulta admite até31 datas desde a emissão';end if;
 if not exists(select 1 from public.sicredi_auto_config_247 where id and ativo) then
 raise exception 'A automação Sicredi precisa estar ativa para consultar';end if;
 if (select count(*) from public.sicredi_config)<>1 or not exists(select 1 from public.sicredi_config c where c.ambiente='producao'
 and c.cooperativa=b.cooperativa and c.posto=b.posto and c.codigo_beneficiario=b.codigo_beneficiario) then
 raise exception 'O convênio ativo não corresponde ao boleto. Não altere credenciais para executar esta consulta';end if;
 perform pg_advisory_xact_lock(hashtext('sicredi-tarifas-280'));
 insert into public.sicredi_tarifas_fila_280(cooperativa,posto,beneficiario,dia,proxima_consulta)
 select b.cooperativa,b.posto,b.codigo_beneficiario,d::date,
 timestamptz '1900-01-01 00:00:00+00'+(d::date-b.data_emissao)*interval '1 second'
 from generate_series(b.data_emissao,hoje,interval '1 day') d
 on conflict(cooperativa,posto,beneficiario,dia) do update set proxima_consulta=least(sicredi_tarifas_fila_280.proxima_consulta,excluded.proxima_consulta);
 -- Disparo assíncrono: consulta a primeira data elegível. As demais seguem no cron existente.
 perform public.sicredi_tarifas_disparar_280();
end $$;
commit;
select 'Consulta solicitada. Aguarde1–2 minutos e execute conferir_tarifas_boleto_600000007_somente_leitura.sql. As demais datas seguem a cada15 minutos.' as orientacao;
