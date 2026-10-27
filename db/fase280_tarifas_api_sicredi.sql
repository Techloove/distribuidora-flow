-- Execute inteiro no Supabase e depois publique a versão1.5.0.
-- Francesinha (manual3.9.1, seção7.21): somente leitura bancária e cache por boleto.
-- Não gera despesas, não altera títulos/pagamentos e não emite boletos.
begin;
do $$begin
 if to_regclass('public.sicredi_auto_config_247') is null
 or to_regprocedure('public.ator_financeiro_pode_acessar_centro(uuid,uuid)') is null then
 raise exception 'Confira a fase247 e o perímetro Sicredi antes da fase280';end if;
end $$;
create table if not exists public.sicredi_tarifas_fila_280(
 cooperativa text not null,posto text not null,beneficiario text not null,dia date not null,
 proxima_consulta timestamptz not null default 'epoch',lease uuid,lease_ate timestamptz,
 consultado_em timestamptz,erro text,
 primary key(cooperativa,posto,beneficiario,dia)
);
create table if not exists public.sicredi_tarifas_api_280(
 boleto_id uuid not null references public.boletos(id) on delete cascade,
 data_lancamento date not null,centro_id uuid not null references public.centros(id),
 debitos jsonb not null check(jsonb_typeof(debitos)='array'),
 tarifa_total numeric(14,2) not null check(tarifa_total>=0),
 outros_debitos integer not null check(outros_debitos>=0),
 consultado_em timestamptz not null default now(),
 primary key(boleto_id,data_lancamento)
);
alter table public.sicredi_tarifas_fila_280 enable row level security;
alter table public.sicredi_tarifas_api_280 enable row level security;
revoke all on public.sicredi_tarifas_fila_280,public.sicredi_tarifas_api_280 from public,anon,authenticated,service_role;
grant select on public.sicredi_tarifas_api_280 to authenticated;
drop policy if exists tarifas_api_leitura_280 on public.sicredi_tarifas_api_280;
create policy tarifas_api_leitura_280 on public.sicredi_tarifas_api_280 for select to authenticated using(
 public.usuario_ativo() and public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id)
 and (not public.escopo_representante() or public.documento_na_minha_carteira('boletos',boleto_id))
);
create or replace function public.sicredi_tarifas_reservar_280(_segredo text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare cfg public.sicredi_auto_config_247;c public.sicredi_config;f public.sicredi_tarifas_fila_280;
 chave uuid:=gen_random_uuid();hoje date:=(now() at time zone 'America/Sao_Paulo')::date;inicio date;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 select * into cfg from public.sicredi_auto_config_247 where id;
 if _segredo is null or _segredo is distinct from cfg.segredo then raise exception 'Agendamento não autorizado';end if;
 if not coalesce(cfg.ativo,false) then return '{}'::jsonb;end if;
 perform pg_advisory_xact_lock(hashtext('sicredi-tarifas-280'));
 if exists(select 1 from public.sicredi_tarifas_fila_280 where lease_ate>now()) then return '{}'::jsonb;end if;
 if (select count(*) from public.sicredi_config)<>1 then return '{}'::jsonb;end if;
 select * into c from public.sicredi_config limit 1;
 if c.ambiente is distinct from 'producao' or nullif(c.cooperativa,'') is null or nullif(c.posto,'') is null
 or nullif(c.codigo_beneficiario,'') is null then return '{}'::jsonb;end if;
 select case when min(b.data_emissao) is not null then greatest(min(b.data_emissao),hoje-90) end into inicio from public.boletos b
 where b.banco='sicredi' and b.canal='api' and b.ambiente='producao'
 and b.cooperativa=c.cooperativa and b.posto=c.posto and b.codigo_beneficiario=c.codigo_beneficiario;
 if inicio is null then return '{}'::jsonb;end if;
 insert into public.sicredi_tarifas_fila_280(cooperativa,posto,beneficiario,dia)
 select c.cooperativa,c.posto,c.codigo_beneficiario,d::date from generate_series(inicio,hoje,interval '1 day') d
 on conflict do nothing;
 select * into f from public.sicredi_tarifas_fila_280
 where cooperativa=c.cooperativa and posto=c.posto and beneficiario=c.codigo_beneficiario
 and dia between hoje-90 and hoje and proxima_consulta<=now() and coalesce(lease_ate,'epoch')<=now()
 order by proxima_consulta,dia desc limit 1 for update skip locked;
 if not found then return '{}'::jsonb;end if;
 update public.sicredi_tarifas_fila_280 set lease=chave,lease_ate=now()+interval '3 minutes'
 where cooperativa=f.cooperativa and posto=f.posto and beneficiario=f.beneficiario and dia=f.dia;
 return jsonb_build_object('lease',chave,'dia',f.dia,'cooperativa',f.cooperativa,'posto',f.posto,'beneficiario',f.beneficiario);
end $$;
revoke all on function public.sicredi_tarifas_reservar_280(text) from public,anon,authenticated;
grant execute on function public.sicredi_tarifas_reservar_280(text) to service_role;
create or replace function public.sicredi_tarifas_finalizar_280(_lease uuid,_movimentos jsonb default null,_erro text default null) returns integer
language plpgsql security definer set search_path=public as $$
declare f public.sicredi_tarifas_fila_280;b public.boletos;r jsonb;itens jsonb;total numeric;outros integer;n integer:=0;
 hoje date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 select * into f from public.sicredi_tarifas_fila_280 where lease=_lease and lease_ate>now() for update;
 if not found or _lease is null then raise exception 'Reserva expirada';end if;
 if _erro is not null then
  update public.sicredi_tarifas_fila_280 set lease=null,lease_ate=null,erro=case when _erro in('HTTP','TIMEOUT','RETORNO_INVALIDO','CONVENIO_DIVERGENTE') then _erro else 'CONSULTA_FALHOU' end,
  proxima_consulta=now()+interval '1 hour' where lease=_lease;
  return 0;
 end if;
 if not exists(select 1 from public.sicredi_config c where c.ambiente='producao' and c.cooperativa=f.cooperativa and c.posto=f.posto and c.codigo_beneficiario=f.beneficiario) then raise exception 'Convênio alterado';end if;
 if _movimentos is null or jsonb_typeof(_movimentos)<>'array' or jsonb_array_length(_movimentos)>100000 then raise exception 'Movimentos inválidos';end if;
 for r in select value from jsonb_array_elements(_movimentos) loop
  if jsonb_typeof(r)<>'object' or r->>'cooperativa' is distinct from f.cooperativa or r->>'posto' is distinct from f.posto
  or r->>'beneficiario' is distinct from f.beneficiario or r->>'dia' is distinct from f.dia::text
  or coalesce(r->>'nosso_numero','') !~ '^[0-9]{1,9}$'
  or length(coalesce(r->>'descricao','')) not between 1 and 300
  or coalesce(r->>'valor','') !~ '^[0-9]+([.][0-9]{1,2})?$' or (r->>'valor')::numeric<=0
  or (r->>'valor')::numeric>999999999999.99 then raise exception 'Débito incompatível com a reserva';end if;
 end loop;
 -- O manual não fornece identificador único do movimento. Substitui o dia completo, nunca acumula reconsultas.
 -- Ambiguidade entre boletos/lojas bloqueia o lote em vez de atribuir valor à loja errada.
 if exists(select 1 from public.boletos b2 where b2.banco='sicredi' and b2.canal='api' and b2.ambiente='producao'
  and b2.cooperativa=f.cooperativa and b2.posto=f.posto and b2.codigo_beneficiario=f.beneficiario
  and exists(select 1 from jsonb_array_elements(_movimentos) r2 where ltrim(r2->>'nosso_numero','0')=ltrim(b2.nosso_numero,'0'))
  group by ltrim(b2.nosso_numero,'0') having count(*)>1) then raise exception 'Nosso número ambíguo entre boletos';end if;
 for b in select b3.* from public.boletos b3 where b3.banco='sicredi' and b3.canal='api' and b3.ambiente='producao'
  and b3.cooperativa=f.cooperativa and b3.posto=f.posto and b3.codigo_beneficiario=f.beneficiario
  and exists(select 1 from public.profiles p where p.ativo and public.has_role(p.id,'admin') and public.ator_financeiro_pode_acessar_centro(p.id,b3.centro_id))
  for share loop
   select coalesce(jsonb_agg(jsonb_build_object('descricao',r3->>'descricao','valor',(r3->>'valor')::numeric)),'[]'::jsonb),
    coalesce(sum(case when upper(r3->>'descricao') ~ '\mTARIFA\M' then (r3->>'valor')::numeric else 0 end),0),
    count(*) filter(where upper(r3->>'descricao') !~ '\mTARIFA\M')
   into itens,total,outros from jsonb_array_elements(_movimentos) r3 where ltrim(r3->>'nosso_numero','0')=ltrim(b.nosso_numero,'0');
   if jsonb_array_length(itens)>0 then
    insert into public.sicredi_tarifas_api_280(boleto_id,data_lancamento,centro_id,debitos,tarifa_total,outros_debitos)
    values(b.id,f.dia,b.centro_id,itens,total,outros) on conflict(boleto_id,data_lancamento) do update
    set centro_id=excluded.centro_id,debitos=excluded.debitos,tarifa_total=excluded.tarifa_total,outros_debitos=excluded.outros_debitos,consultado_em=now();
    n:=n+1;
   else delete from public.sicredi_tarifas_api_280 where boleto_id=b.id and data_lancamento=f.dia;end if;
 end loop;
 update public.sicredi_tarifas_fila_280 set lease=null,lease_ate=null,erro=null,consultado_em=now(),
 proxima_consulta=now()+case when dia>=hoje-7 then interval '6 hours' else interval '7 days' end where lease=_lease;
 return n;
end $$;
revoke all on function public.sicredi_tarifas_finalizar_280(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.sicredi_tarifas_finalizar_280(uuid,jsonb,text) to service_role;
-- Indicadores sem segredo nem dados de outras lojas/carteiras.
create or replace function public.sicredi_tarifas_status_280(_centro uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$begin
 if not coalesce(public.usuario_ativo(),false) or not coalesce(public.can_finance(auth.uid()),false)
 or (_centro is not null and not coalesce(public.usuario_pode_acessar_centro(_centro),false)) then raise exception 'Sem acesso às tarifas';end if;
 return (select jsonb_build_object('ultima_consulta',max(f.consultado_em),
 'dias_pendentes',count(*) filter(where f.consultado_em is null),
 'dias_com_erro',count(*) filter(where f.erro is not null))
 from public.sicredi_tarifas_fila_280 f where exists(select 1 from public.boletos b where b.cooperativa=f.cooperativa and b.posto=f.posto and b.codigo_beneficiario=f.beneficiario
 and b.banco='sicredi' and b.canal='api' and b.ambiente='producao' and b.data_emissao<=f.dia
 and (_centro is null or b.centro_id=_centro) and public.usuario_pode_acessar_centro(b.centro_id)
 and (not public.escopo_representante() or public.documento_na_minha_carteira('boletos',b.id))));
end $$;
revoke all on function public.sicredi_tarifas_status_280(uuid) from public,anon;
grant execute on function public.sicredi_tarifas_status_280(uuid) to authenticated;
-- Mesmo segredo privado da automação existente, com endpoint independente da liquidação.
create or replace function public.sicredi_tarifas_disparar_280() returns void
language plpgsql security definer set search_path=public as $$declare c public.sicredi_auto_config_247;destino text;begin
 select * into c from public.sicredi_auto_config_247 where id;
 if not coalesce(c.ativo,false) then return;end if;
 if c.endpoint !~ '/api/sicredi/sincronizar$' then raise exception 'Revise o endpoint Sicredi antes de agendar tarifas';end if;
 destino:=regexp_replace(c.endpoint,'/api/sicredi/sincronizar$','/api/sicredi/tarifas');
 perform net.http_post(url:=destino,headers:=jsonb_build_object('Authorization','Bearer '||c.segredo,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;
revoke all on function public.sicredi_tarifas_disparar_280() from public,anon,authenticated;
grant execute on function public.sicredi_tarifas_disparar_280() to service_role;
do $$begin
 if not exists(select 1 from cron.job where jobname='sicredi-tarifas-api-280') then
 perform cron.schedule('sicredi-tarifas-api-280','*/15 * * * *','select public.sicredi_tarifas_disparar_280()');end if;
end $$;
notify pgrst,'reload schema';
commit;
