-- Fase237: cobrança por centro. Sicredi API; Sicoob aguardando definição.
-- Aplicar após236. Não altera boletos emitidos, credenciais ou contadores existentes.
begin;
do $$ begin
 if to_regprocedure('public.acompanhar_pedido_236(uuid)') is null or
    to_regprocedure('public.sicredi_liquidar_api_224(uuid,uuid,jsonb)') is null then
  raise exception 'Aplique as fases224 e236 antes da fase237'; end if;
end $$;
create table if not exists public.cobranca_centros(
 centro_id uuid primary key references public.centros(id),
 banco text not null default 'indefinido' check(banco in ('indefinido','sicredi','sicoob')),
 canal text not null default 'pendente' check(canal in ('pendente','api')),
 ativo boolean not null default false,
 conta_financeira_id uuid references public.contas_financeiras(id),
 updated_at timestamptz not null default now(),
 check((banco='sicredi' and canal='api') or (banco<>'sicredi' and canal='pendente' and not ativo)),
 check(not ativo or conta_financeira_id is not null)
);
-- Um convênio Sicredi preservado, vinculado a um único centro. Outros bancos são independentes.
create unique index if not exists cobranca_um_sicredi_237 on public.cobranca_centros(banco) where banco='sicredi';
alter table public.cobranca_centros enable row level security;
revoke all on public.cobranca_centros from public,anon,authenticated;
grant select on public.cobranca_centros to authenticated;
grant all on public.cobranca_centros to service_role;
drop policy if exists cobranca_leitura_237 on public.cobranca_centros;
create policy cobranca_leitura_237 on public.cobranca_centros for select to authenticated using(
 public.usuario_ativo() and public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id)
);
alter table public.boletos add column if not exists conta_cobranca_id uuid references public.contas_financeiras(id);
-- Os centros são escolhidos no formulário: não adivinha Ferragem pelo nome nem atribui históricos.
do $$ declare nova text; begin
 insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values
 ('centros_cobranca_configurar','Configurar banco e cobrança do centro (administrador)','Centros de custo',150,'/centros')
 on conflict do nothing returning codigo into nova;
 if nova is not null then insert into public.role_permissoes(role,permissao)
 select role::text,'centros_cobranca_configurar' from public.role_menus where path='/centros' and role::text='admin'
 on conflict do nothing; end if;
end $$;
create or replace function public.validar_cobranca_centro_237(_actor uuid,_centro uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' or not exists(select 1 from public.profiles where id=_actor and ativo)
 or not public.ator_financeiro_pode_acessar_centro(_actor,_centro)
 or not exists(select 1 from public.centros where id=_centro and ativo) then
  raise exception 'Centro de custo indisponivel ou sem acesso'; end if;
end $$;
revoke all on function public.validar_cobranca_centro_237(uuid,uuid) from public,anon,authenticated;
grant execute on function public.validar_cobranca_centro_237(uuid,uuid) to service_role;

create or replace function public.salvar_cobranca_centro_237(
 _actor uuid,_centro uuid,_banco text,_ativo boolean,_conta uuid,_api jsonb
) returns void language plpgsql security definer set search_path=public as $$
declare a public.sicredi_config; v public.sicredi_config; c public.cobranca_centros;
begin
 perform public.validar_cobranca_centro_237(_actor,_centro);
 if not public.has_role(_actor,'admin') then raise exception 'Somente administrador configura a cobranca'; end if;
 -- Mesmo mutex usado nas configurações antigas. Não há redefinição de sequências.
 perform pg_advisory_xact_lock(748208);
 select * into a from public.sicredi_config for update;
 select * into c from public.cobranca_centros where centro_id=_centro for update;
 if _banco is null or _banco not in ('sicredi','sicoob','indefinido') or _ativo is null then raise exception 'Banco ou ativacao invalidos'; end if;
 if _banco<>'sicredi' and _ativo then raise exception 'Integracao Sicoob ainda nao implementada. Mantenha pendente'; end if;
 if _conta is not null and not exists(select 1 from public.contas_financeiras where id=_conta and ativo and (centro_id is null or centro_id=_centro))
 then raise exception 'Selecione conta financeira ativa deste centro ou compartilhada'; end if;
 if _ativo and _conta is null then raise exception 'Informe a conta financeira de recebimento'; end if;
 if c.banco='sicredi' and _banco<>'sicredi' and exists(select 1 from public.boletos where banco='sicredi' and centro_id=_centro)
 then raise exception 'Centro possui historico Sicredi. Desative novas emissoes preservando o banco'; end if;
 if _banco='sicredi' then
  if exists(select 1 from public.cobranca_centros where banco='sicredi' and centro_id<>_centro) then
   raise exception 'O convenio Sicredi ja esta vinculado a outro centro'; end if;
  if jsonb_typeof(_api) is distinct from 'object' then raise exception 'Parametros da API invalidos'; end if;
  v:=jsonb_populate_record(coalesce(a,null::public.sicredi_config),_api);
  if v.cooperativa is null or v.cooperativa !~ '^[0-9]{4}$' or v.posto is null or v.posto !~ '^[0-9]{2}$'
   or v.codigo_beneficiario is null or v.codigo_beneficiario !~ '^[0-9]{5}$' then raise exception 'Confira cooperativa, posto e beneficiario'; end if;
  if v.ambiente is null or v.ambiente not in ('homologacao','producao') or v.tipo_cobranca is distinct from 'NORMAL'
   or v.tipo_juro is null or v.tipo_juro not in ('ISENTO','PERCENTUAL','VALOR')
   or v.tipo_desconto is null or v.tipo_desconto not in ('NAO_TEM_DESCONTO','PERCENTUAL','VALOR')
   or v.tipo_protesto is null or v.tipo_protesto not in ('SEM_PROTESTO','PROTESTAR','NEGATIVAR') then raise exception 'Regras da API invalidas. Utilize boleto normal'; end if;
  if v.juros is null or v.multa is null or v.valor_desconto1 is null or
   least(v.juros,v.multa,v.valor_desconto1)<0 or v.multa>100 or
   v.juros::text in ('NaN','Infinity','-Infinity') or v.multa::text in ('NaN','Infinity','-Infinity') or v.valor_desconto1::text in ('NaN','Infinity','-Infinity') or
   row(v.juros,v.multa,v.valor_desconto1) is distinct from row(round(v.juros,2),round(v.multa,2),round(v.valor_desconto1,2)) or
   v.dias_multa is null or v.dias_multa<0 or v.dias_desconto1 is null or v.dias_desconto1<0 or
   v.dias_protesto is null or v.dias_protesto not between 0 and 99 or
   v.validade_apos_vencimento is null or v.validade_apos_vencimento not between 0 and 9999
  then raise exception 'Valores ou prazos de cobranca invalidos'; end if;
  if exists(select 1 from public.boletos where banco='sicredi' and coalesce(ambiente,'producao')='producao' and
    row(cooperativa,posto,codigo_beneficiario) is distinct from row(v.cooperativa,v.posto,v.codigo_beneficiario)) then
   raise exception 'Preserve a identificacao do convenio dos boletos de producao existentes'; end if;
  -- Mudanças de ambiente/identidade durante envio inconclusivo impediriam sua recuperação.
  if exists(select 1 from public.boletos where banco='sicredi' and canal='api' and status in ('pendente','em_processamento','erro')
    and row(ambiente,cooperativa,posto,codigo_beneficiario) is distinct from
     row(v.ambiente,case when v.ambiente='homologacao' then '6789' else v.cooperativa end,
      case when v.ambiente='homologacao' then '03' else v.posto end,case when v.ambiente='homologacao' then '12345' else v.codigo_beneficiario end))
  then raise exception 'Existe emissao pendente em outro ambiente. Concilie antes de trocar'; end if;
  v.api_key:=coalesce(nullif(btrim(_api->>'api_key'),''),a.api_key);
  v.sandbox_api_key:=coalesce(nullif(btrim(_api->>'sandbox_api_key'),''),a.sandbox_api_key);
  v.password:=coalesce(nullif(_api->>'password',''),a.password);
  if _ativo and ((v.ambiente='homologacao' and nullif(v.sandbox_api_key,'') is null) or
    (v.ambiente='producao' and (nullif(v.api_key,'') is null or nullif(v.password,'') is null or v.username is distinct from v.codigo_beneficiario||v.cooperativa)))
  then raise exception 'Preencha as credenciais do ambiente selecionado antes de ativar'; end if;
  insert into public.sicredi_config(id,sandbox_api_key,api_key,username,password,cooperativa,posto,codigo_beneficiario,
    ambiente,tipo_cobranca,especie_documento,tipo_juro,juros,multa,dias_multa,tipo_desconto,
    valor_desconto1,dias_desconto1,tipo_protesto,dias_protesto,validade_apos_vencimento,informativo,mensagem)
  values(coalesce(a.id,gen_random_uuid()),v.sandbox_api_key,v.api_key,v.username,v.password,v.cooperativa,v.posto,v.codigo_beneficiario,
    v.ambiente,v.tipo_cobranca,v.especie_documento,v.tipo_juro,v.juros,v.multa,v.dias_multa,v.tipo_desconto,
    v.valor_desconto1,v.dias_desconto1,v.tipo_protesto,v.dias_protesto,v.validade_apos_vencimento,v.informativo,v.mensagem)
  on conflict(id) do update set sandbox_api_key=excluded.sandbox_api_key,api_key=excluded.api_key,username=excluded.username,password=excluded.password,
    cooperativa=excluded.cooperativa,posto=excluded.posto,codigo_beneficiario=excluded.codigo_beneficiario,
    ambiente=excluded.ambiente,tipo_cobranca=excluded.tipo_cobranca,especie_documento=excluded.especie_documento,
    tipo_juro=excluded.tipo_juro,juros=excluded.juros,multa=excluded.multa,dias_multa=excluded.dias_multa,
    tipo_desconto=excluded.tipo_desconto,valor_desconto1=excluded.valor_desconto1,dias_desconto1=excluded.dias_desconto1,
    tipo_protesto=excluded.tipo_protesto,dias_protesto=excluded.dias_protesto,
    validade_apos_vencimento=excluded.validade_apos_vencimento,informativo=excluded.informativo,
    mensagem=excluded.mensagem,updated_at=clock_timestamp();
 end if;
 insert into public.cobranca_centros(centro_id,banco,canal,ativo,conta_financeira_id)
 values(_centro,_banco,case when _banco='sicredi' then 'api' else 'pendente' end,_ativo,_conta)
 on conflict(centro_id) do update set banco=excluded.banco,canal=excluded.canal,ativo=excluded.ativo,
 conta_financeira_id=excluded.conta_financeira_id,updated_at=clock_timestamp();
 insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
 values('cobranca_centros',_centro,'configurar_cobranca_centro',jsonb_build_object('banco',_banco,'ativo',_ativo,'conta',_conta),_actor);
end $$;
revoke all on function public.salvar_cobranca_centro_237(uuid,uuid,text,boolean,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.salvar_cobranca_centro_237(uuid,uuid,text,boolean,uuid,jsonb) to service_role;
-- Formulário anterior deixa de ser um caminho paralelo de configuração.
create or replace function public.sicredi_salvar_convenio_223(_actor uuid,_api jsonb,_cnab jsonb,_confirmar boolean default false)
returns void language plpgsql security definer set search_path=public as $$
begin raise exception 'Configure a cobranca em Centros de custo (fase237)'; end $$;
revoke all on function public.sicredi_salvar_convenio_223(uuid,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.sicredi_salvar_convenio_223(uuid,jsonb,jsonb,boolean) to service_role;

-- Conserva a preparação224/idempotência131 e acrescenta o roteamento pelo centro real do título.
do $$ begin
 if to_regprocedure('public.preparar_boleto_sicredi_fase224(uuid,uuid)') is null then
  alter function public.preparar_boleto_sicredi_servidor(uuid,uuid) rename to preparar_boleto_sicredi_fase224;
 end if;
end $$;
revoke all on function public.preparar_boleto_sicredi_fase224(uuid,uuid) from public,anon,authenticated,service_role;
create or replace function public.preparar_boleto_sicredi_servidor(_actor_id uuid,_conta_id uuid) returns public.boletos
language plpgsql security definer set search_path=public as $$
declare cr public.contas_receber; c public.cobranca_centros; b public.boletos;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operacao exclusiva do servidor'; end if;
 -- Ordem: API config, cobrança do centro, título e boleto. A gravação usa a mesma ordem.
 perform 1 from public.sicredi_config for share;
 select cc.* into c from public.cobranca_centros cc join public.contas_receber t on t.centro_id=cc.centro_id
 where t.id=_conta_id for share of cc;
 if c.centro_id is null or c.banco<>'sicredi' or c.canal<>'api' or not c.ativo then
  raise exception 'Sicredi API nao habilitado para o centro deste titulo. Configure em Centros de custo'; end if;
 perform public.validar_cobranca_centro_237(_actor_id,c.centro_id);
 select * into cr from public.contas_receber where id=_conta_id for update;
 if cr.centro_id is distinct from c.centro_id then raise exception 'Centro do titulo alterado. Atualize antes de emitir'; end if;
 if not exists(select 1 from public.contas_financeiras where id=c.conta_financeira_id and ativo and (centro_id is null or centro_id=c.centro_id))
 then raise exception 'Conta financeira do convenio indisponivel'; end if;
 b:=public.preparar_boleto_sicredi_fase224(_actor_id,_conta_id);
 -- Cada ciclo conserva a conta de recebimento, mesmo após alterar a configuração do centro.
 update public.boletos set conta_cobranca_id=coalesce(conta_cobranca_id,c.conta_financeira_id) where id=b.id returning * into b;
 return b;
end $$;
revoke all on function public.preparar_boleto_sicredi_servidor(uuid,uuid) from public,anon,authenticated;
grant execute on function public.preparar_boleto_sicredi_servidor(uuid,uuid) to service_role;
-- A baixa usa a conta gravada na emissão. Boletos antigos mantêm a regra anterior como fallback.
do $$ declare d text; alvo text:='conta:=coalesce(cr.conta_financeira_id,(select conta_financeira_id from public.sicredi_cnab_config));'; begin
 d:=pg_get_functiondef('public.sicredi_liquidar_api_224(uuid,uuid,jsonb)'::regprocedure);
 if position('b.conta_cobranca_id' in d)=0 then
  if position(alvo in d)=0 then raise exception 'Regra de conta de liquidacao224 nao localizada'; end if;
  execute replace(d,alvo,'conta:=coalesce(b.conta_cobranca_id,cr.conta_financeira_id,(select conta_financeira_id from public.sicredi_cnab_config));');
 end if;
end $$;
-- Não gera novos ciclos Sicredi CNAB. Retornos e downloads históricos continuam disponíveis.
create or replace function public.bloquear_novo_cnab_237() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if tg_table_name='sicredi_cnab_arquivos' then
 if new.tipo='remessa' then raise exception 'Sicredi utiliza somente API. Novas remessas CNAB desabilitadas'; end if;
 else
 if new.banco='sicredi' and new.canal='cnab240' then raise exception 'Sicredi utiliza somente API. Novos boletos CNAB desabilitados'; end if;
 end if;
 return new;
end $$;
revoke all on function public.bloquear_novo_cnab_237() from public,anon,authenticated;
drop trigger if exists bloquear_novo_cnab_237 on public.boletos;
create trigger bloquear_novo_cnab_237 before insert on public.boletos for each row execute function public.bloquear_novo_cnab_237();
drop trigger if exists bloquear_novo_cnab_237 on public.sicredi_cnab_arquivos;
create trigger bloquear_novo_cnab_237 before insert on public.sicredi_cnab_arquivos for each row execute function public.bloquear_novo_cnab_237();
notify pgrst,'reload schema';
commit;
