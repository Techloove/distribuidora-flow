-- Somente tarifas vinculadas a novas emissões reais do ERP. Instalação não ativa nem lança despesas.
begin;
create table if not exists public.sicoob_tarifas_config_355(
 centro_id uuid primary key references public.centros(id),conta_id uuid not null references public.contas_financeiras(id),categoria_id uuid not null references public.categorias_financeiras(id),inicio date not null,ativo boolean not null default false,responsavel uuid not null references public.profiles(id),versao int not null default 1,proxima_consulta timestamptz not null default now(),ultima_consulta timestamptz,erro text,mes_cursor date,lease uuid,lease_ate timestamptz,lease_extrato_versao int,lease_config_versao int,lease_mes date
);
create table if not exists public.sicoob_tarifas_financeiro_355(
 numero_conta text not null,transaction_id text not null,centro_id uuid not null references public.centros(id),boleto_id uuid not null references public.boletos(id),data_lancamento date not null,valor numeric(14,2) not null,assinatura text not null,estado text not null,movimento_id uuid unique references public.movimentos_financeiros(id),conta_id uuid not null references public.contas_financeiras(id),categoria_id uuid not null references public.categorias_financeiras(id),updated_at timestamptz not null default now(),primary key(numero_conta,transaction_id)
);
create table if not exists public.sicoob_tarifas_job_355(id boolean primary key default true check(id),segredo text not null default (replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','')));
insert into public.sicoob_tarifas_job_355(id) values(true) on conflict do nothing;
alter table public.sicoob_tarifas_config_355 enable row level security;
alter table public.sicoob_tarifas_financeiro_355 enable row level security;
alter table public.sicoob_tarifas_job_355 enable row level security;
revoke all on public.sicoob_tarifas_config_355,public.sicoob_tarifas_financeiro_355,public.sicoob_tarifas_job_355 from public,anon,authenticated;
grant all on public.sicoob_tarifas_config_355,public.sicoob_tarifas_financeiro_355,public.sicoob_tarifas_job_355 to service_role;
create or replace function public.sicoob_tarifas_get_355(_actor uuid,_centro uuid) returns jsonb
language plpgsql security definer set search_path=public as $$declare c sicoob_tarifas_config_355;begin
 perform validar_sicoob_316(_actor,_centro,true);
 select * into c from sicoob_tarifas_config_355 where centro_id=_centro;
 return jsonb_build_object('ativo',coalesce(c.ativo,false),'inicio',coalesce(c.inicio,(now() at time zone 'America/Sao_Paulo')::date),'categoriaId',c.categoria_id,'versao',coalesce(c.versao,0),'ultimaConsulta',c.ultima_consulta,'erro',c.erro,
 'conta',(select jsonb_build_object('id',f.id,'nome',f.nome) from cobranca_centros cc join contas_financeiras f on f.id=cc.conta_financeira_id where cc.centro_id=_centro and cc.banco='sicoob' and f.ativo and (f.centro_id is null or f.centro_id=_centro)),
 'categorias',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'nome',x.nome) order by x.nome) from categorias_financeiras x left join categorias_financeiras p on p.id=x.parent_id where x.ativo and x.tipo='despesa' and coalesce(p.grupo_dre,x.grupo_dre)='despesa_financeira' and (p.id is null or p.ativo)),'[]'::jsonb),
 'lancados',(select count(*) from sicoob_tarifas_financeiro_355 where centro_id=_centro and movimento_id is not null),'conferir',(select count(*) from sicoob_tarifas_financeiro_355 where centro_id=_centro and estado<>'lancado'));
end $$;
create or replace function public.sicoob_tarifas_salvar_355(_actor uuid,_centro uuid,_categoria uuid,_inicio date,_ativo boolean,_versao int) returns void
language plpgsql security definer set search_path=public as $$declare c sicoob_tarifas_config_355;cc cobranca_centros;e sicoob_extrato_config_352;begin
 perform validar_sicoob_316(_actor,_centro,true);
 perform pg_advisory_xact_lock(355,1);
 select * into c from sicoob_tarifas_config_355 where centro_id=_centro for update;
 if coalesce(c.versao,0) is distinct from _versao then raise exception 'Configuração alterada em outra sessão. Atualize';end if;
 if _ativo is null or _inicio is null or _inicio>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Confira a data inicial';end if;
 if c.centro_id is not null and not _ativo then update sicoob_tarifas_config_355 set ativo=false,versao=versao+1,lease=null,lease_ate=null where centro_id=_centro;insert into auditoria(tabela,registro_id,acao,user_id,detalhe) values('centros',_centro,'pausar_tarifas_sicoob_355',_actor,'{}');return;end if;
 select * into cc from cobranca_centros where centro_id=_centro for share;
 select * into e from sicoob_extrato_config_352 where centro_id=_centro for share;
 if cc.banco is distinct from 'sicoob' or cc.conta_financeira_id is null or not exists(select 1 from contas_financeiras f where f.id=cc.conta_financeira_id and f.ativo and (f.centro_id is null or f.centro_id=_centro)) then raise exception 'Configure a conta financeira do Sicoob na cobrança da loja';end if;
 if e.segredo_id is null or e.client_id='' or not exists(select 1 from sicoob_config_316 b where b.centro_id=_centro and b.ambiente='producao' and b.numero_conta::text=ltrim(e.numero_conta,'0')) then raise exception 'Confira se extrato e cobrança utilizam a mesma conta Sicoob';end if;
 if not exists(select 1 from categorias_financeiras x left join categorias_financeiras p on p.id=x.parent_id where x.id=_categoria and x.ativo and x.tipo='despesa' and coalesce(p.grupo_dre,x.grupo_dre)='despesa_financeira' and (p.id is null or p.ativo)) then raise exception 'Selecione categoria de despesa financeira';end if;
 if c.conta_id is not null and c.conta_id<>cc.conta_financeira_id and exists(select 1 from sicoob_tarifas_financeiro_355 where centro_id=_centro) then raise exception 'Conta com histórico de tarifas exige conferência antes de substituição';end if;
 insert into sicoob_tarifas_config_355(centro_id,conta_id,categoria_id,inicio,ativo,responsavel) values(_centro,cc.conta_financeira_id,_categoria,_inicio,_ativo,_actor)
 on conflict(centro_id) do update set categoria_id=excluded.categoria_id,conta_id=excluded.conta_id,inicio=excluded.inicio,ativo=excluded.ativo,responsavel=_actor,versao=sicoob_tarifas_config_355.versao+1,proxima_consulta=now(),mes_cursor=null,lease=null,lease_ate=null;
 insert into auditoria(tabela,registro_id,acao,user_id,detalhe) values('centros',_centro,'configurar_tarifas_sicoob_355',_actor,jsonb_build_object('ativo',_ativo,'categoria',_categoria,'inicio',_inicio,'somente_emissoes_erp',true));
end $$;
create or replace function public.sicoob_tarifas_reservar_355(_segredo text default null,_actor uuid default null,_centro uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c sicoob_tarifas_config_355;r jsonb;e sicoob_extrato_config_352;mes date;hoje date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 if _segredo is not null then
  if _actor is not null or _centro is not null or not exists(select 1 from sicoob_tarifas_job_355 where id and segredo=_segredo) then raise exception 'Agendamento não autorizado';end if;
 else perform validar_sicoob_316(_actor,_centro,true);end if;
 perform pg_advisory_xact_lock(355,1);
 if exists(select 1 from sicoob_tarifas_config_355 where lease_ate>now()) then return '{}'::jsonb;end if;
 select * into c from sicoob_tarifas_config_355 where ativo and (_centro is null or centro_id=_centro) and (_centro is not null or proxima_consulta<=now()) order by proxima_consulta,centro_id limit 1 for update;
 if not found then return '{}'::jsonb;end if;
 perform validar_sicoob_316(c.responsavel,c.centro_id,true);
 if not exists(select 1 from boletos b where b.centro_id=c.centro_id and b.banco='sicoob' and b.canal='api' and b.ambiente='producao' and b.data_emissao>=c.inicio and exists(select 1 from sicoob_operacoes_316 o where o.boleto_id=b.id and o.tipo='emissao')) then update sicoob_tarifas_config_355 set proxima_consulta=now()+interval '15 minutes' where centro_id=c.centro_id;return '{}'::jsonb;end if;
 select * into e from sicoob_extrato_config_352 where centro_id=c.centro_id;
 mes:=coalesce(c.mes_cursor,date_trunc('month',hoje)::date);
 if mes<greatest(date_trunc('month',c.inicio)::date,(date_trunc('month',hoje)-interval '3 months')::date) or mes>hoje then mes:=date_trunc('month',hoje)::date;end if;
 r:=sicoob_extrato_reservar_352(c.responsavel,c.centro_id);
 update sicoob_tarifas_config_355 set lease=gen_random_uuid(),lease_ate=now()+interval '2 minutes',lease_mes=mes,lease_extrato_versao=e.versao,lease_config_versao=versao,proxima_consulta=now()+interval '15 minutes' where centro_id=c.centro_id returning lease into c.lease;
 return r||jsonb_build_object('lease',c.lease,'mes',to_char(mes,'YYYY-MM'),'inicio',greatest(c.inicio,mes),'fim',least(hoje,(mes+interval '1 month - 1 day')::date));
end $$;
create or replace function public.sicoob_tarifas_finalizar_355(_lease uuid,_movimentos jsonb default '[]'::jsonb,_erro text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c sicoob_tarifas_config_355;e sicoob_extrato_config_352;v jsonb;f sicoob_tarifas_financeiro_355;b boletos;m movimentos_financeiros;numero text;chave text;sig text;descricao text;dia date;total numeric;novos int:=0;ignorados int:=0;revisar int:=0;old_claims text;old_sub text;old_role text;hoje date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 select * into c from sicoob_tarifas_config_355 where lease=_lease and lease_ate>now() for update;
 if not found then raise exception 'Consulta expirada; nenhuma contabilização realizada';end if;
 if _erro is not null then update sicoob_tarifas_config_355 set erro='Consulta bancária não concluída; nova tentativa agendada',lease=null,lease_ate=null where centro_id=c.centro_id;return jsonb_build_object('lancados',0);end if;
 select * into e from sicoob_extrato_config_352 where centro_id=c.centro_id for share;
 if not c.ativo or c.versao<>c.lease_config_versao or e.versao<>c.lease_extrato_versao or not exists(select 1 from cobranca_centros cc join contas_financeiras a on a.id=cc.conta_financeira_id where cc.centro_id=c.centro_id and cc.banco='sicoob' and cc.conta_financeira_id=c.conta_id and a.ativo and (a.centro_id is null or a.centro_id=c.centro_id)) then raise exception 'Configuração mudou durante a consulta';end if;
 perform validar_sicoob_316(c.responsavel,c.centro_id,true);
 if jsonb_typeof(_movimentos) is distinct from 'array' or jsonb_array_length(_movimentos)>10000 then raise exception 'Retorno de tarifas inválido';end if;
 if exists(select 1 from jsonb_array_elements(_movimentos) x group by x->>'id' having count(distinct x)>1) then raise exception 'Identificador bancário com retornos conflitantes';end if;
 numero:=ltrim(e.numero_conta,'0');
 old_claims:=current_setting('request.jwt.claims',true);old_sub:=current_setting('request.jwt.claim.sub',true);old_role:=current_setting('request.jwt.claim.role',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',c.responsavel,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',c.responsavel::text,true);perform set_config('request.jwt.claim.role','authenticated',true);
 if not coalesce(usuario_ativo(),false) or not coalesce(can_finance(auth.uid()),false) or not coalesce(pode_rotina('boletos_tarifa_registrar'),false) or not coalesce(usuario_pode_acessar_centro(c.centro_id),false) then raise exception 'Responsável sem acesso à contabilização';end if;
 if not exists(select 1 from categorias_financeiras x left join categorias_financeiras p on p.id=x.parent_id where x.id=c.categoria_id and x.ativo and x.tipo='despesa' and coalesce(p.grupo_dre,x.grupo_dre)='despesa_financeira' and (p.id is null or p.ativo)) then raise exception 'Categoria financeira indisponível';end if;
 for v in select value from jsonb_array_elements(_movimentos) loop
  chave:=v->>'id';
  if chave is null or chave!~'^[A-Za-z0-9._:-]{6,120}$' then ignorados:=ignorados+1;continue;end if;
  sig:=md5(v::text);
  select * into f from sicoob_tarifas_financeiro_355 where numero_conta=numero and transaction_id=chave for update;
  if f.transaction_id is not null then
   if f.centro_id<>c.centro_id then ignorados:=ignorados+1;continue;end if;
   if f.movimento_id is not null then
    select * into m from movimentos_financeiros where id=f.movimento_id;
    update sicoob_tarifas_financeiro_355 set estado=case when m.status is distinct from 'ativo' then 'estornado' when m.conta_id is distinct from f.conta_id or m.categoria_id is distinct from f.categoria_id or m.data is distinct from f.data_lancamento or m.valor is distinct from f.valor or m.tipo is distinct from 'saida' then 'movimento_divergente' when sig<>f.assinatura then 'retorno_divergente' else 'lancado' end,updated_at=now() where numero_conta=numero and transaction_id=chave;
   end if;
   continue;
  end if;
  descricao:=upper(translate(coalesce(v->>'descricao',''),'ÁÀÃÂÉÊÍÓÔÕÚÇáàãâéêíóôõúç','AAAAEEIOOOUCaaaaeeiooouc'));
  if v->>'tipo' is distinct from 'DEBITO' or descricao!~'(TARIFA|TAR\.|TAXA|CUSTA|EMOLUMENTO)' or (descricao~'^ *(ESTORNO|ESTORNAD|DEVOLUCAO DE TARIFA)' or descricao~'ESTORNAD[OA]') then ignorados:=ignorados+1;continue;end if;
  if coalesce(v->>'data','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or coalesce(v->>'valor','')!~'^[0-9]+(\.[0-9]{1,2})?$' then ignorados:=ignorados+1;continue;end if;
  dia:=(v->>'data')::date;total:=(v->>'valor')::numeric;
  if dia<c.inicio or dia<c.lease_mes or dia>=c.lease_mes+interval '1 month' or dia>hoje or total<=0 then ignorados:=ignorados+1;continue;end if;
  -- Documento do extrato sozinho NÃO comprova nosso número. Exige referência explícita vinda do banco.
  if coalesce(v->>'nosso_numero','')!~'^[0-9]{1,18}$' then ignorados:=ignorados+1;continue;end if;
  select * into b from boletos z where z.centro_id=c.centro_id and z.banco='sicoob' and z.canal='api' and z.ambiente='producao' and z.status in('registrado','liquidado','baixado','cancelado') and ltrim(z.nosso_numero,'0')=ltrim(v->>'nosso_numero','0') and z.data_emissao>=c.inicio and z.data_emissao<=dia and z.conta_cobranca_id=c.conta_id and z.sicoob_snapshot_316->>'numero_conta'=numero and exists(select 1 from sicoob_operacoes_316 o where o.boleto_id=z.id and o.tipo='emissao') order by z.id limit 1;
  if b.id is null then ignorados:=ignorados+1;continue;end if;
  insert into sicoob_tarifas_financeiro_355(numero_conta,transaction_id,centro_id,boleto_id,data_lancamento,valor,assinatura,estado,conta_id,categoria_id) values(numero,chave,c.centro_id,b.id,dia,total,sig,'pendente',c.conta_id,c.categoria_id);
  if exists(select 1 from movimentos_financeiros x where x.conta_id=c.conta_id and x.centro_id=c.centro_id and x.data=dia and x.tipo='saida' and x.valor=total and x.status='ativo' and not exists(select 1 from sicoob_tarifas_financeiro_355 y where y.movimento_id=x.id)) then
   update sicoob_tarifas_financeiro_355 set estado='conferir_preexistente' where numero_conta=numero and transaction_id=chave;revisar:=revisar+1;
  else
   select * into m from lancar_movimento(c.conta_id,'saida',total,dia,c.categoria_id,c.centro_id,'Tarifa Sicoob — boleto ERP '||b.nosso_numero,'SICOOB-TARIFA-'||md5(numero||':'||chave));
   update sicoob_tarifas_financeiro_355 set movimento_id=m.id,estado='lancado' where numero_conta=numero and transaction_id=chave;
   novos:=novos+1;
   insert into auditoria(tabela,registro_id,acao,user_id,detalhe) values('boletos',b.id,'tarifa_sicoob_355',c.responsavel,jsonb_build_object('movimento',m.id,'valor',total,'data',dia,'evento',chave));
  end if;
 end loop;
 perform set_config('request.jwt.claims',coalesce(old_claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claim.role',coalesce(old_role,''),true);
 update sicoob_tarifas_config_355 set ultima_consulta=now(),erro=case when ignorados>0 or revisar>0 then format('%s movimento(s) sem vínculo/requisitos para importação; %s para conferir preexistência.',ignorados,revisar) else null end,mes_cursor=case when (c.lease_mes-interval '1 month')::date>=greatest(date_trunc('month',c.inicio)::date,(date_trunc('month',hoje)-interval '3 months')::date) then (c.lease_mes-interval '1 month')::date else date_trunc('month',hoje)::date end,lease=null,lease_ate=null where centro_id=c.centro_id;
 return jsonb_build_object('lancados',novos,'ignorados',ignorados,'conferir',revisar);
end $$;
create or replace function public.sicoob_tarifas_disparar_355() returns void
language plpgsql security definer set search_path=public as $$declare s text;begin
 if not exists(select 1 from sicoob_tarifas_config_355 where ativo and proxima_consulta<=now()) then return;end if;
 select segredo into s from sicoob_tarifas_job_355 where id;
 perform net.http_post(url:='https://caparaosystem.com.br/api/sicoob/tarifas',headers:=jsonb_build_object('X-Sicoob-Automacao',s,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;
do $$declare f regprocedure;begin
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in('sicoob_tarifas_get_355','sicoob_tarifas_salvar_355','sicoob_tarifas_reservar_355','sicoob_tarifas_finalizar_355','sicoob_tarifas_disparar_355') loop
  execute format('revoke all on function %s from public,anon,authenticated',f);execute format('grant execute on function %s to service_role',f);
 end loop;
 if not exists(select 1 from cron.job where jobname='sicoob-tarifas-355') then perform cron.schedule('sicoob-tarifas-355','*/15 * * * *','select public.sicoob_tarifas_disparar_355()');end if;
end $$;
notify pgrst,'reload schema';
commit;
