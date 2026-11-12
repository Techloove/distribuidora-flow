-- Coletor assíncrono LIQUI: não emite/baixa boletos no banco. Usa credenciais da cobrança de cada loja.
begin;
do $$begin
 if to_regclass('public.sicoob_auto_config_358') is null or to_regprocedure('public.receber_titulo(uuid,numeric,date,uuid,uuid,numeric,numeric,numeric,text)') is null then
  raise exception 'Aplique a fase358 e as rotinas financeiras antes da fase359';end if;
end $$;
alter table public.boletos add column if not exists sicoob_recebimento_359 jsonb;
create table if not exists public.sicoob_liqui_config_359(
 centro_id uuid primary key references public.centros(id),ativo boolean not null default true,
 cursor date,recente boolean not null default true,proxima_consulta timestamptz not null default now(),ultima_consulta timestamptz,erro text
);
create table if not exists public.sicoob_liqui_jobs_359(
 id uuid primary key default gen_random_uuid(),centro_id uuid not null references public.centros(id),actor uuid not null references public.profiles(id),
 versao int not null,numero_cliente bigint not null,numero_conta bigint not null,contrato bigint,conta_id uuid not null references public.contas_financeiras(id),
 inicio date not null,fim date not null,recente boolean not null,estado text not null default 'solicitar',codigo bigint,
 arquivos bigint[] not null default '{}',feitos bigint[] not null default '{}',lease uuid,lease_ate timestamptz,
 proxima timestamptz not null default now(),erros int not null default 0,erro text,diagnostico jsonb,updated_at timestamptz not null default now(),check(fim>=inicio and fim-inicio<=1)
);
create unique index if not exists sicoob_liqui_job_pendente_359 on public.sicoob_liqui_jobs_359(centro_id) where estado in('solicitar','aguardar','baixar');
create table if not exists public.sicoob_liqui_eventos_359(
 centro_id uuid not null references public.centros(id),chave text not null,boleto_id uuid not null references public.boletos(id),
 dados jsonb not null,estado text not null,motivo text,created_at timestamptz not null default now(),primary key(centro_id,chave)
);
alter table public.sicoob_liqui_config_359 enable row level security;
alter table public.sicoob_liqui_jobs_359 enable row level security;
alter table public.sicoob_liqui_eventos_359 enable row level security;
revoke all on public.sicoob_liqui_config_359,public.sicoob_liqui_jobs_359,public.sicoob_liqui_eventos_359 from public,anon,authenticated;
grant all on public.sicoob_liqui_config_359,public.sicoob_liqui_jobs_359,public.sicoob_liqui_eventos_359 to service_role;
insert into public.sicoob_liqui_config_359(centro_id) select centro_id from public.cobranca_centros where banco='sicoob' and canal='api' on conflict do nothing;
create or replace function public.sicoob_liqui_loja_359() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if new.banco='sicoob' and new.canal='api' then insert into sicoob_liqui_config_359(centro_id) values(new.centro_id) on conflict do nothing;end if;
 return new;
end $$;
drop trigger if exists sicoob_liqui_loja_359 on public.cobranca_centros;
create trigger sicoob_liqui_loja_359 after insert or update on public.cobranca_centros for each row execute function public.sicoob_liqui_loja_359();
create or replace function public.sicoob_liqui_validar_359(j public.sicoob_liqui_jobs_359) returns void
language plpgsql security definer set search_path=public as $$begin
 perform validar_sicoob_316(j.actor,j.centro_id,true);
 if not exists(select 1 from sicoob_liqui_config_359 where centro_id=j.centro_id and ativo) or not exists(select 1 from sicoob_auto_config_358 where id and ativo) then raise exception 'CONFIG_ALTERADA';end if;
 if not exists(select 1 from sicoob_config_316 c join cobranca_centros cc using(centro_id)
  where c.centro_id=j.centro_id and c.ambiente='producao' and c.ativo and c.versao=j.versao and c.autenticado_versao=c.versao
  and c.numero_cliente=j.numero_cliente and c.numero_conta=j.numero_conta and c.numero_contrato is not distinct from j.contrato
  and cc.banco='sicoob' and cc.canal='api' and cc.ativo and cc.conta_financeira_id=j.conta_id)
  or not exists(select 1 from contas_financeiras f where f.id=j.conta_id and f.ativo and (f.centro_id is null or f.centro_id=j.centro_id))
 then raise exception 'CONFIG_ALTERADA';end if;
end $$;
create or replace function public.sicoob_liqui_reservar_359(_segredo text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare j sicoob_liqui_jobs_359;r record;ator uuid;primeira date;hoje date:=(now() at time zone 'America/Sao_Paulo')::date;begin
 if coalesce(auth.role(),'')<>'service_role' or not exists(select 1 from sicoob_auto_config_358 where id and ativo and segredo=_segredo) then raise exception 'Agendamento não autorizado';end if;
 perform pg_advisory_xact_lock(359,1);
 if exists(select 1 from sicoob_liqui_jobs_359 where lease_ate>now()) then return '{}'::jsonb;end if;
 select x.* into j from sicoob_liqui_jobs_359 x join sicoob_liqui_config_359 c using(centro_id) where c.ativo and x.estado in('solicitar','aguardar','baixar') and x.proxima<=now() order by x.proxima,x.id limit 1 for update of x;
 if j.id is null then
  for r in select c.*,b.versao,b.numero_cliente,b.numero_conta,b.numero_contrato,cc.conta_financeira_id from sicoob_liqui_config_359 c
   join sicoob_config_316 b on b.centro_id=c.centro_id and b.ambiente='producao' and b.ativo and b.autenticado_versao=b.versao
   join cobranca_centros cc on cc.centro_id=c.centro_id and cc.banco='sicoob' and cc.canal='api' and cc.ativo
   where c.ativo and c.proxima_consulta<=now() and cc.conta_financeira_id is not null
   and not exists(select 1 from sicoob_liqui_jobs_359 x where x.centro_id=c.centro_id and x.estado in('solicitar','aguardar','baixar'))
   order by c.proxima_consulta,c.centro_id loop
   select min(z.data_emissao) into primeira from boletos z where z.centro_id=r.centro_id and z.banco='sicoob' and z.canal='api' and z.ambiente='producao'
    and z.status in('registrado','liquidado') and z.nosso_numero is not null and z.sicoob_recebimento_359 is null
    and not exists(select 1 from sicoob_liqui_eventos_359 e where e.boleto_id=z.id and e.estado='conferir')
    and exists(select 1 from sicoob_operacoes_316 o where o.boleto_id=z.id and o.tipo='emissao' and o.estado='confirmado');
   if primeira is null or primeira>hoje then continue;end if;
   select p.id into ator from profiles p where p.ativo and not coalesce(p.precisa_completar_cadastro,false) and has_role(p.id,'admin') and ator_financeiro_pode_acessar_centro(p.id,r.centro_id) order by p.id limit 1;
   if ator is null then continue;end if;
   insert into sicoob_liqui_jobs_359(centro_id,actor,versao,numero_cliente,numero_conta,contrato,conta_id,inicio,fim,recente)
    values(r.centro_id,ator,r.versao,r.numero_cliente,r.numero_conta,r.numero_contrato,r.conta_financeira_id,
     case when r.recente then greatest(primeira,hoje-1) else case when r.cursor is null or r.cursor>hoje then primeira else greatest(primeira,r.cursor) end end,
     case when r.recente then hoje else least(case when r.cursor is null or r.cursor>hoje then primeira else greatest(primeira,r.cursor) end+1,hoje) end,r.recente) returning * into j;
   exit;
  end loop;
 end if;
 if j.id is null then return '{}'::jsonb;end if;
 select p.id into ator from profiles p where p.ativo and not coalesce(p.precisa_completar_cadastro,false) and has_role(p.id,'admin') and ator_financeiro_pode_acessar_centro(p.id,j.centro_id) order by p.id limit 1;
 if ator is null then
  update sicoob_liqui_jobs_359 set proxima=now()+interval '15 minutes' where id=j.id;
  update sicoob_liqui_config_359 set erro='SEM_ADMINISTRADOR_AUTORIZADO' where centro_id=j.centro_id;return '{}'::jsonb;
 end if;
 update sicoob_liqui_jobs_359 set actor=ator,lease=gen_random_uuid(),lease_ate=now()+interval '3 minutes' where id=j.id returning * into j;
 return to_jsonb(j);
end $$;
create or replace function public.sicoob_liqui_receber_359(j public.sicoob_liqui_jobs_359,_boleto uuid,d jsonb) returns text
language plpgsql security definer set search_path=public as $$
declare b boletos;t contas_receber;v numeric;m numeric;ds numeric;a numeric;n numeric;dt date;saldo numeric;cl text;su text;ro text;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 perform sicoob_liqui_validar_359(j);
 select * into b from boletos where id=_boleto for update;
 if b.sicoob_recebimento_359 is not null then
  if b.sicoob_recebimento_359->>'chave'=d->>'chave' then return 'repetido';end if;
  raise exception 'RECEBIMENTO_ANTERIOR_DIVERGENTE';end if;
 if b.banco<>'sicoob' or b.canal<>'api' or b.ambiente<>'producao' or b.status not in('registrado','liquidado') or b.centro_id<>j.centro_id
  or not exists(select 1 from sicoob_operacoes_316 where boleto_id=b.id and tipo='emissao' and estado='confirmado')
  or ltrim(b.nosso_numero,'0') is distinct from (d->>'nossoNumero') or b.seu_numero is distinct from (d->>'seuNumero') or b.codigo_barras is distinct from (d->>'codigoBarras')
  or (b.sicoob_snapshot_316->>'numero_cliente')::bigint is distinct from j.numero_cliente or (b.sicoob_snapshot_316->>'numero_conta')::bigint is distinct from j.numero_conta
  or (b.sicoob_snapshot_316->>'numero_contrato')::bigint is distinct from j.contrato or b.conta_cobranca_id is distinct from j.conta_id
 then raise exception 'IDENTIDADE_DIVERGENTE';end if;
 v:=(d->>'valor')::numeric;m:=(d->>'mora')::numeric;ds:=(d->>'desconto')::numeric;a:=(d->>'abatimento')::numeric;n:=(d->>'nominal')::numeric;dt:=(d->>'data')::date;
 if least(v,n)<=0 or least(m,ds,a)<0 or v is null or n is null or m is null or ds is null or a is null or dt is null
  or v::text in('NaN','Infinity','-Infinity') or n::text in('NaN','Infinity','-Infinity') or m::text in('NaN','Infinity','-Infinity') or ds::text in('NaN','Infinity','-Infinity') or a::text in('NaN','Infinity','-Infinity')
  or row(v,n,m,ds,a) is distinct from row(round(v,2),round(n,2),round(m,2),round(ds,2),round(a,2))
  or n is distinct from b.valor or v is distinct from round(n+m-ds-a,2) or dt<b.data_emissao or (d->>'dataMovimento') is null or (d->>'dataMovimento')::date<j.inicio or (d->>'dataMovimento')::date>j.fim or dt>(now() at time zone 'America/Sao_Paulo')::date
  then raise exception 'VALORES_OU_DATA_DIVERGENTES';end if;
 select * into t from contas_receber where id=b.conta_receber_id for update;
 saldo:=round(coalesce(t.valor,0)+coalesce(t.juros,0)+coalesce(t.multa,0)+coalesce(t.acrescimo,0)-coalesce(t.desconto,0)-coalesce(t.valor_pago,0),2);
 if t.id is null or t.centro_id is distinct from b.centro_id or t.status not in('aberto','parcial') or saldo is distinct from b.valor
  or coalesce(t.valor_pago,0)<>0 or exists(select 1 from movimentos_financeiros where conta_receber_id=t.id)
  then raise exception 'TITULO_REQUER_CONFERENCIA';end if;
 -- O LIQUI informa mora agregada; preserva-a como acréscimo, sem inventar divisão entre juros e multa.
 update contas_receber set acrescimo=coalesce(acrescimo,0)+m where id=t.id;
 cl:=current_setting('request.jwt.claims',true);su:=current_setting('request.jwt.claim.sub',true);ro:=current_setting('request.jwt.claim.role',true);
 begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',j.actor,'role','authenticated')::text,true);perform set_config('request.jwt.claim.sub',j.actor::text,true);perform set_config('request.jwt.claim.role','authenticated',true);
  perform receber_titulo(t.id,v,dt,j.conta_id,null,0,0,ds+a,'Liquidação Sicoob LIQUI - nosso número '||b.nosso_numero);
 exception when others then
  perform set_config('request.jwt.claims',coalesce(cl,''),true);perform set_config('request.jwt.claim.sub',coalesce(su,''),true);perform set_config('request.jwt.claim.role',coalesce(ro,''),true);raise;
 end;
 perform set_config('request.jwt.claims',coalesce(cl,''),true);perform set_config('request.jwt.claim.sub',coalesce(su,''),true);perform set_config('request.jwt.claim.role',coalesce(ro,''),true);
 update sicoob_operacoes_316 set estado='encerrado',nota='Liquidação confirmada por LIQUI',updated_at=now() where id=b.sicoob_pendente_316;
 update boletos set status='liquidado',valor_liquidado=v,data_liquidacao=dt,sicoob_recebimento_359=d,sicoob_pendente_316=null,erro=null where id=b.id;
 insert into auditoria(tabela,registro_id,acao,user_id,detalhe) values('boletos',b.id,'receber_sicoob_liqui_359',j.actor,d);
 return 'baixado';
end $$;
create or replace function public.sicoob_liqui_concluir_359(j public.sicoob_liqui_jobs_359) returns void
language plpgsql security definer set search_path=public as $$begin
 update sicoob_liqui_jobs_359 set estado='concluido',lease=null,lease_ate=null,updated_at=now(),erro=null where id=j.id;
 update sicoob_liqui_config_359 set ultima_consulta=now(),proxima_consulta=now()+interval '15 minutes',erro=null,recente=not j.recente,
  cursor=case when j.recente then cursor else j.fim+1 end where centro_id=j.centro_id;
end $$;
create or replace function public.sicoob_liqui_etapa_359(_job uuid,_lease uuid,_acao text,_dados jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare j sicoob_liqui_jobs_359;ids bigint[];v record;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 select * into j from sicoob_liqui_jobs_359 where id=_job for update;
 if _lease is null or j.lease is distinct from _lease or j.lease_ate<now() then raise exception 'Reserva expirada';end if;
 if _acao='erro' then
  update sicoob_liqui_jobs_359 set estado=case when _dados->>'codigo'='CONFIG_ALTERADA' then 'conferir' else estado end,erros=erros+1,erro=left(_dados->>'codigo',80),diagnostico=_dados->'diagnostico',proxima=now()+least(240,5*(erros+1))*interval '1 minute',lease=null,lease_ate=null,updated_at=now() where id=j.id;
  update sicoob_liqui_config_359 set erro=left(_dados->>'codigo',80),proxima_consulta=now()+interval '5 minutes' where centro_id=j.centro_id;
  return '{}';
 end if;
 perform sicoob_liqui_validar_359(j);
 if _acao='solicitacao' and j.estado='solicitar' and (_dados->>'codigo')~'^[1-9][0-9]{0,14}$' then
  update sicoob_liqui_jobs_359 set codigo=(_dados->>'codigo')::bigint,estado='aguardar',proxima=now()+interval '5 minutes',lease=null,lease_ate=null,updated_at=now(),erro=null where id=j.id;
 elsif _acao='aguardar' and j.estado='aguardar' then
  update sicoob_liqui_jobs_359 set proxima=now()+interval '5 minutes',lease=null,lease_ate=null,updated_at=now() where id=j.id;
 elsif _acao='arquivos' and j.estado='aguardar' and jsonb_typeof(_dados->'ids')='array' and jsonb_array_length(_dados->'ids')<=20 then
  for v in select value #>> '{}' as id from jsonb_array_elements(_dados->'ids') loop
   if v.id!~'^[1-9][0-9]{0,14}$' then raise exception 'Arquivo inválido';end if;
  end loop;
  select coalesce(array_agg((value #>> '{}')::bigint),'{}'::bigint[]) into ids from jsonb_array_elements(_dados->'ids');
  if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'Arquivos duplicados';end if;
  update sicoob_liqui_jobs_359 set arquivos=ids,estado='baixar',proxima=now(),lease=null,lease_ate=null,updated_at=now(),erro=null where id=j.id;
  if cardinality(ids)=0 then perform sicoob_liqui_concluir_359(j);end if;
 else raise exception 'Etapa inválida';end if;
 return '{}';
end $$;
create or replace function public.sicoob_liqui_identificar_359(_job uuid,_lease uuid,_referencias jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$declare j sicoob_liqui_jobs_359;resultado jsonb;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 select * into j from sicoob_liqui_jobs_359 where id=_job;
 if _lease is null or j.lease is distinct from _lease or j.lease_ate<now() or j.estado<>'baixar' then raise exception 'Reserva expirada';end if;
 perform sicoob_liqui_validar_359(j);
 if jsonb_typeof(_referencias) is distinct from 'array' or jsonb_array_length(_referencias)>10000 then raise exception 'Referências inválidas';end if;
 select coalesce(jsonb_agg(jsonb_build_object('nossoNumero',x.nn,'seuNumero',x.seu)),'[]') into resultado from (
  select distinct ltrim(b.nosso_numero,'0') as nn,b.seu_numero as seu
  from jsonb_array_elements(_referencias) d join boletos b on b.centro_id=j.centro_id and ltrim(b.nosso_numero,'0')=d->>'nossoNumero' and b.seu_numero=d->>'seuNumero'
  where (d->>'numeroCliente')::bigint=j.numero_cliente and (d->>'numeroConta')::bigint=j.numero_conta and d->>'modalidade'='1'
  and b.banco='sicoob' and b.canal='api' and b.ambiente='producao'
  and exists(select 1 from sicoob_operacoes_316 o where o.boleto_id=b.id and o.tipo='emissao' and o.estado='confirmado')
 ) x;
 return resultado;
end $$;
create or replace function public.sicoob_liqui_arquivo_359(_job uuid,_lease uuid,_arquivo bigint,_registros jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare j sicoob_liqui_jobs_359;d jsonb;b boletos;estado text;motivo text;novos int:=0;conferir int:=0;ignorados int:=0;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 select * into j from sicoob_liqui_jobs_359 where id=_job for update;
 if _lease is null or j.lease is distinct from _lease or j.lease_ate<now() or j.estado<>'baixar' or not _arquivo=any(j.arquivos) then raise exception 'Reserva ou arquivo inválido';end if;
 perform sicoob_liqui_validar_359(j);
 if _arquivo=any(j.feitos) then return jsonb_build_object('repetido',true);end if;
 if jsonb_typeof(_registros) is distinct from 'array' or jsonb_array_length(_registros)>10000 then raise exception 'Registros inválidos';end if;
 for d in select value from jsonb_array_elements(_registros) loop
  if (d->>'numeroCliente')::bigint is distinct from j.numero_cliente or (d->>'numeroConta')::bigint is distinct from j.numero_conta then ignorados:=ignorados+1;continue;end if;
  if d->>'chave'!~'^[a-f0-9]{64}$' then raise exception 'Chave inválida';end if;
  if exists(select 1 from sicoob_liqui_eventos_359 where centro_id=j.centro_id and chave=d->>'chave') then continue;end if;
  select * into b from boletos z where z.centro_id=j.centro_id and z.banco='sicoob' and z.canal='api' and z.ambiente='producao'
   and ltrim(z.nosso_numero,'0')=d->>'nossoNumero'
   and exists(select 1 from sicoob_operacoes_316 o where o.boleto_id=z.id and o.tipo='emissao' and o.estado='confirmado') order by z.created_at desc limit 1 for update;
  if b.id is null then ignorados:=ignorados+1;continue;end if;
  estado:='baixado';motivo:=null;
  begin
   if j.contrato is not null and d->>'contratoCobranca' is not null and (d->>'contratoCobranca')::bigint is distinct from j.contrato then raise exception 'CONTRATO_DIVERGENTE';end if;
   estado:=sicoob_liqui_receber_359(j,b.id,d);
  exception when sqlstate 'P0001' then estado:='conferir';motivo:=left(sqlerrm,200);
  end;
  insert into sicoob_liqui_eventos_359(centro_id,chave,boleto_id,dados,estado,motivo) values(j.centro_id,d->>'chave',b.id,d,estado,motivo);
  if estado='baixado' then novos:=novos+1;elsif estado='conferir' then conferir:=conferir+1;end if;
 end loop;
 update sicoob_liqui_jobs_359 set feitos=array_append(feitos,_arquivo),lease=null,lease_ate=null,proxima=now(),erro=null,updated_at=now() where id=j.id returning * into j;
 if cardinality(j.feitos)=cardinality(j.arquivos) then perform sicoob_liqui_concluir_359(j);end if;
 return jsonb_build_object('baixados',novos,'conferir',conferir,'ignorados',ignorados);
end $$;
create or replace function public.sicoob_liqui_disparar_359() returns void
language plpgsql security definer set search_path=public as $$declare s text;begin
 if not exists(select 1 from sicoob_liqui_config_359 where ativo) then return;end if;
 select segredo into s from sicoob_auto_config_358 where id and ativo;
 if s is null then return;end if;
 perform net.http_post(url:='https://caparaosystem.com.br/api/sicoob/liquidacoes',headers:=jsonb_build_object('X-Sicoob-Automacao',s,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;
create or replace function public.sicoob_auto_status_358(_actor uuid,_centro uuid) returns jsonb
language plpgsql security definer set search_path=public as $$begin
 perform validar_sicoob_316(_actor,_centro);
 return jsonb_build_object('ativo',(select ativo from sicoob_auto_config_358 where id),
 'ultimaConsulta',(select max(f.ultima_consulta) from sicoob_auto_fila_358 f join boletos b on b.id=f.boleto_id where b.centro_id=_centro),
 'falhas',(select count(*) from sicoob_auto_fila_358 f join boletos b on b.id=f.boleto_id where b.centro_id=_centro and f.erros>0),
 'baixarFinanceiro',exists(select 1 from sicoob_liqui_config_359 l join cobranca_centros cc using(centro_id) join sicoob_config_316 c using(centro_id) where l.centro_id=_centro and l.ativo and cc.banco='sicoob' and cc.canal='api' and cc.ativo and c.ambiente='producao' and c.ativo and c.autenticado_versao=c.versao and exists(select 1 from sicoob_auto_config_358 where id and ativo)),
 'ultimaLiqui',(select ultima_consulta from sicoob_liqui_config_359 where centro_id=_centro),
 'erroLiqui',(select erro from sicoob_liqui_config_359 where centro_id=_centro),
 'pendenciasLiqui',(select count(*) from sicoob_liqui_eventos_359 where centro_id=_centro and estado='conferir'));
end $$;
do $$declare f regprocedure;begin
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in('sicoob_liqui_validar_359','sicoob_liqui_reservar_359','sicoob_liqui_receber_359','sicoob_liqui_concluir_359','sicoob_liqui_etapa_359','sicoob_liqui_arquivo_359','sicoob_liqui_disparar_359','sicoob_liqui_identificar_359','sicoob_liqui_loja_359','sicoob_auto_status_358') loop
 execute format('revoke all on function %s from public,anon,authenticated',f);execute format('grant execute on function %s to service_role',f);end loop;
 if not exists(select 1 from cron.job where jobname='sicoob-liqui-359') then perform cron.schedule('sicoob-liqui-359','*/5 * * * *','select public.sicoob_liqui_disparar_359()');end if;
end $$;
notify pgrst,'reload schema';
commit;
