-- Consulta automática de títulos Sicoob emitidos pelo ERP, sem filtro de vencimento.
-- Esta fase sincroniza situação bancária. Não inventa valor/data nem realiza baixa financeira.
begin;
create table if not exists public.sicoob_auto_config_358(
 id boolean primary key default true check(id), ativo boolean not null default true,
 segredo text not null default(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','')),
 ultima_chamada timestamptz,bloqueado_ate timestamptz
);
insert into public.sicoob_auto_config_358(id) values(true) on conflict do nothing;
create table if not exists public.sicoob_auto_fila_358(
 boleto_id uuid primary key references public.boletos(id) on delete cascade,
 proxima_consulta timestamptz not null default now(),ultima_consulta timestamptz,
 lease uuid,lease_ate timestamptz,actor uuid references public.profiles(id),config_versao int,
 resultado text,erros int not null default 0,diagnostico jsonb
);
create index if not exists boletos_sicoob_auto_358 on public.boletos(id,centro_id)
 where banco='sicoob' and canal='api' and ambiente='producao' and status in('registrado','liquidado') and nullif(nosso_numero,'') is not null;
create index if not exists sicoob_emissoes_confirmadas_358 on public.sicoob_operacoes_316(boleto_id) where tipo='emissao' and estado='confirmado';
alter table public.sicoob_auto_config_358 enable row level security;
alter table public.sicoob_auto_fila_358 enable row level security;
revoke all on public.sicoob_auto_config_358,public.sicoob_auto_fila_358 from public,anon,authenticated;
grant all on public.sicoob_auto_config_358,public.sicoob_auto_fila_358 to service_role;
create or replace function public.sicoob_auto_reservar_358(_segredo text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare cfg sicoob_auto_config_358;b record;ator uuid;chave uuid:=gen_random_uuid();itens jsonb:='[]';begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 select * into cfg from sicoob_auto_config_358 where id for update;
 if _segredo is null or _segredo is distinct from cfg.segredo then raise exception 'Agendamento não autorizado';end if;
 if not cfg.ativo or cfg.bloqueado_ate>now() then return jsonb_build_object('itens',itens);end if;
 update sicoob_auto_config_358 set ultima_chamada=now(),bloqueado_ate=now()+interval '90 seconds' where id;
 for b in select z.*,c.versao as config_versao from boletos z
 join sicoob_config_316 c on c.centro_id=z.centro_id and c.ambiente='producao' and c.ativo and c.autenticado_versao=c.versao
 join cobranca_centros cc on cc.centro_id=z.centro_id and cc.banco='sicoob' and cc.canal='api' and cc.ativo
 left join sicoob_auto_fila_358 f on f.boleto_id=z.id
 where z.banco='sicoob' and z.canal='api' and z.ambiente='producao' and z.status in('registrado','liquidado')
 and nullif(z.nosso_numero,'') is not null
 and exists(select 1 from sicoob_operacoes_316 o where o.boleto_id=z.id and o.tipo='emissao' and o.estado='confirmado')
 and coalesce(f.proxima_consulta,'epoch'::timestamptz)<=now() and coalesce(f.lease_ate,'epoch'::timestamptz)<=now()
 order by coalesce(f.proxima_consulta,'epoch'::timestamptz),z.id limit 5 for update of z skip locked loop
  select p.id into ator from profiles p where p.ativo and not coalesce(p.precisa_completar_cadastro,false)
    and has_role(p.id,'admin') and ator_financeiro_pode_acessar_centro(p.id,b.centro_id) order by p.id limit 1;
  if ator is null then continue;end if;
  insert into sicoob_auto_fila_358(boleto_id,lease,lease_ate,actor,config_versao)
   values(b.id,chave,now()+interval '3 minutes',ator,b.config_versao)
   on conflict(boleto_id) do update set lease=excluded.lease,lease_ate=excluded.lease_ate,actor=excluded.actor,config_versao=excluded.config_versao;
  itens:=itens||jsonb_build_object('id',b.id,'centro_id',b.centro_id,'actor',ator,'nosso_numero',b.nosso_numero,'versao',b.config_versao,'pagador_documento',b.sicoob_snapshot_316->>'pagador_documento');
 end loop;
 return jsonb_build_object('lease',chave,'itens',itens);
end $$;
create or replace function public.sicoob_auto_finalizar_358(_lease uuid,_boleto uuid,_banco jsonb default null,_diagnostico jsonb default null,_erro text default null) returns void
language plpgsql security definer set search_path=public as $$
declare f sicoob_auto_fila_358;b boletos;c sicoob_config_316;mudou boolean;begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 select * into b from boletos where id=_boleto for update;
 select * into f from sicoob_auto_fila_358 where boleto_id=_boleto for update;
 if f.lease is distinct from _lease or _lease is null or f.lease_ate<now() then raise exception 'Reserva expirada';end if;
 if _erro is not null then
  update sicoob_auto_fila_358 set ultima_consulta=now(),resultado=left(_erro,60),diagnostico=coalesce(_diagnostico,diagnostico),erros=erros+1,
    proxima_consulta=now()+least(240,15*(erros+1))*interval '1 minute',lease=null,lease_ate=null where boleto_id=_boleto;return;
 end if;
 perform validar_sicoob_316(f.actor,b.centro_id);
 select * into c from sicoob_config_316 where centro_id=b.centro_id and ambiente='producao' for share;
 if not coalesce(c.ativo,false) or c.versao is distinct from f.config_versao
  or c.numero_cliente is distinct from (b.sicoob_snapshot_316->>'numero_cliente')::bigint
  or c.numero_conta is distinct from (b.sicoob_snapshot_316->>'numero_conta')::bigint
  or c.numero_contrato is distinct from (b.sicoob_snapshot_316->>'numero_contrato')::bigint
  or not exists(select 1 from cobranca_centros where centro_id=b.centro_id and banco='sicoob' and canal='api' and ativo)
  then raise exception 'Configuração ou convênio mudou';end if;
 if b.banco<>'sicoob' or b.canal<>'api' or b.ambiente<>'producao' or b.nosso_numero is distinct from (_banco->>'nossoNumero')
  then raise exception 'Boleto divergente';end if;
 -- A sincronização existente valida modalidade, identidade, valor e códigos e impede regressão de estados terminais.
 mudou:=b.retorno is distinct from _banco or b.sicoob_pendente_316 is not null;
 if mudou then perform sicoob_sincronizar_316(f.actor,b.id,_banco);end if;
 update sicoob_auto_fila_358 set ultima_consulta=now(),resultado=_banco->>'situacao',erros=0,
   diagnostico=_diagnostico,proxima_consulta=now()+case when _banco->>'situacao'='EM ABERTO' then interval '15 minutes' else interval '6 hours' end,
   lease=null,lease_ate=null where boleto_id=_boleto;
end $$;
create or replace function public.sicoob_auto_status_358(_actor uuid,_centro uuid) returns jsonb
language plpgsql security definer set search_path=public as $$begin
 perform validar_sicoob_316(_actor,_centro);
 return jsonb_build_object('ativo',(select ativo from sicoob_auto_config_358 where id),
 'ultimaConsulta',(select max(f.ultima_consulta) from sicoob_auto_fila_358 f join boletos b on b.id=f.boleto_id where b.centro_id=_centro),
 'falhas',(select count(*) from sicoob_auto_fila_358 f join boletos b on b.id=f.boleto_id where b.centro_id=_centro and f.erros>0),
 'baixarFinanceiro',false);
end $$;
create or replace function public.sicoob_auto_disparar_358() returns void
language plpgsql security definer set search_path=public as $$declare s text;begin
 select segredo into s from sicoob_auto_config_358 where id and ativo and coalesce(bloqueado_ate,'epoch'::timestamptz)<=now();
 if s is null then return;end if;
 if not exists(select 1 from boletos b left join sicoob_auto_fila_358 f on f.boleto_id=b.id
   where b.banco='sicoob' and b.canal='api' and b.ambiente='producao' and b.status in('registrado','liquidado')
   and nullif(b.nosso_numero,'') is not null
   and exists(select 1 from sicoob_operacoes_316 o where o.boleto_id=b.id and o.tipo='emissao' and o.estado='confirmado')
   and coalesce(f.proxima_consulta,'epoch'::timestamptz)<=now() and coalesce(f.lease_ate,'epoch'::timestamptz)<=now()) then return;end if;
 perform net.http_post(url:='https://caparaosystem.com.br/api/sicoob/sincronizar',headers:=jsonb_build_object('X-Sicoob-Automacao',s,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;
do $$declare f regprocedure;begin
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in('sicoob_auto_reservar_358','sicoob_auto_finalizar_358','sicoob_auto_disparar_358','sicoob_auto_status_358') loop
 execute format('revoke all on function %s from public,anon,authenticated',f);execute format('grant execute on function %s to service_role',f);end loop;
 if not exists(select 1 from cron.job where jobname='sicoob-consulta-358') then perform cron.schedule('sicoob-consulta-358','*/5 * * * *','select public.sicoob_auto_disparar_358()');end if;
end $$;
notify pgrst,'reload schema';
commit;
