-- Corrige a triagem: arquivos bancários podem conter boletos anteriores feitos fora do ERP.
-- Somente seleciona candidatos; os validadores de recebimento da fase359 permanecem inalterados.
begin;
do $$begin
 if to_regclass('public.sicoob_liqui_jobs_359') is null then raise exception 'Aplique a fase359 antes da fase360';end if;
end $$;
create index if not exists boletos_sicoob_seu_360 on public.boletos(centro_id,seu_numero) where banco='sicoob' and canal='api' and ambiente='producao';
create index if not exists boletos_sicoob_barras_360 on public.boletos(centro_id,codigo_barras) where banco='sicoob' and canal='api' and ambiente='producao';
create or replace function public.sicoob_liqui_identificar_360(_job uuid,_lease uuid,_referencias jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare j sicoob_liqui_jobs_359;resultado jsonb;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 select * into j from sicoob_liqui_jobs_359 where id=_job;
 if _lease is null or j.lease is distinct from _lease or j.lease_ate<now() or j.estado<>'baixar' then raise exception 'Reserva expirada';end if;
 perform sicoob_liqui_validar_359(j);
 if jsonb_typeof(_referencias) is distinct from 'array' or jsonb_array_length(_referencias)>10000 then raise exception 'Referências inválidas';end if;
 select coalesce(jsonb_agg(jsonb_build_object('nossoNumero',x.nn,'seuNumero',x.seu,'codigoBarras',x.codigo)),'[]') into resultado from (
  select distinct ltrim(b.nosso_numero,'0') as nn,b.seu_numero as seu,b.codigo_barras as codigo
  from jsonb_array_elements(_referencias) d join boletos b on b.centro_id=j.centro_id and (
   (nullif(d->>'seuNumero','') is not null and b.seu_numero=d->>'seuNumero')
   or (nullif(d->>'codigoBarras','') is not null and b.codigo_barras=d->>'codigoBarras')
  ) where b.banco='sicoob' and b.canal='api' and b.ambiente='producao'
  and exists(select 1 from sicoob_operacoes_316 o where o.boleto_id=b.id and o.tipo='emissao' and o.estado='confirmado')
 ) x;
 return resultado;
end $$;
revoke all on function public.sicoob_liqui_identificar_360(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sicoob_liqui_identificar_360(uuid,uuid,jsonb) to service_role;
-- Reagenda somente leituras que pararam no parser anterior, sem interromper reserva ativa.
-- Mantém código de solicitação, arquivo e histórico de erros; não emite nem quita diretamente.
update public.sicoob_liqui_jobs_359 set proxima=now()
where estado='baixar' and (erro like 'LIQUI_IDENTIFICACAO_INVALIDA%' or erro='LIQUI_ATUALIZAR_REFERENCIAS')
and coalesce(lease_ate,'epoch'::timestamptz)<=now();
notify pgrst,'reload schema';
commit;
