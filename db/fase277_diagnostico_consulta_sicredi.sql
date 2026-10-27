-- Executar inteiro no Supabase antes de publicar a versão1.3.4.
-- Apenas acrescenta diagnóstico técnico às próximas consultas automáticas.
-- Não limpa erros/leases, não antecipa consultas, não altera boletos/títulos nem efetua baixas.
begin;
do $$begin
 if to_regclass('public.sicredi_auto_fila_247') is null
 or to_regprocedure('public.sicredi_auto_finalizar_247(uuid,uuid,text,jsonb)') is null then
   raise exception 'Confira a implantação da fase247 antes da fase277';
 end if;
end $$;
alter table public.sicredi_auto_fila_247 add column if not exists diagnostico_277 jsonb;
create or replace function public.sicredi_diagnostico_seguro_277(_dados jsonb) returns jsonb
language plpgsql immutable set search_path=public as $$
declare d jsonb:=_dados->'diagnostico';r jsonb;begin
 if d is null or jsonb_typeof(d)<>'object'
 or coalesce(d->>'etapa','') not in('token','consulta')
 or coalesce(d->>'tipo','') not in('http','timeout','rede','retorno_invalido','nao_identificada') then return null;end if;
 r:=jsonb_build_object('etapa',d->>'etapa','tipo',d->>'tipo');
 if d->>'tipo'='http' and coalesce(d->>'http_status','') ~ '^[45][0-9]{2}$' then
   r:=r||jsonb_build_object('http_status',(d->>'http_status')::integer);
 end if;
 return r;
end $$;
revoke all on function public.sicredi_diagnostico_seguro_277(jsonb) from public,anon,authenticated,service_role;
-- Preserva o corpo instalado: guardas, liquidação, conciliação e espera da fase247.
do $$declare d text;padrao text:='(update\s+(?:public\.)?sicredi_auto_fila_247\s+set\s+)';n integer;begin
 select pg_get_functiondef('public.sicredi_auto_finalizar_247(uuid,uuid,text,jsonb)'::regprocedure) into d;
 if position('diagnostico_277' in d)=0 then
   select count(*) into n from regexp_matches(d,padrao,'gi');
   if n<>1 then raise exception 'Finalizador Sicredi incompatível; nenhuma alteração da fase277 foi aplicada';end if;
   d:=regexp_replace(d,padrao,
     $inj$\1diagnostico_277=case when estado='consulta_falhou' then public.sicredi_diagnostico_seguro_277(_dados) else null end, $inj$,'i');
   execute d;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
