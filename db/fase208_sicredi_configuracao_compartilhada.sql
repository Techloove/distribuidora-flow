-- Fase208, após fase207: um convênio CNAB e sequenciais globais.
-- Não reinicia números nem altera o centro das vendas/boletos/movimentos.
begin;
lock table public.sicredi_cnab_config, public.sicredi_cnab_arquivos, public.boletos in share row exclusive mode;

-- Convênios diferentes não podem ser fundidos silenciosamente.
do $$ begin
  if (select count(*) from public.sicredi_cnab_config)>1 then
    raise exception 'Existem configuracoes Sicredi distintas. Unifique os dados do convenio com a cooperativa antes de executar a fase208';
  end if;
end $$;
create unique index if not exists sicredi_cnab_config_unica on public.sicredi_cnab_config ((true));
-- centro_id da configuração fica apenas como proveniência da instalação.
-- Os arquivos devem poder pertencer a qualquer centro, independentemente da configuração.
alter table public.sicredi_cnab_arquivos drop constraint if exists sicredi_cnab_arquivos_centro_id_fkey;
alter table public.sicredi_cnab_arquivos add constraint sicredi_cnab_arquivos_centro_id_fkey
  foreign key(centro_id) references public.centros(id);

-- Todos os números reservados, inclusive de homologação, erro ou baixa, são preservados.
update public.sicredi_cnab_config c set
  proxima_remessa=greatest(c.proxima_remessa,coalesce((select max(sequencia)+1 from public.sicredi_cnab_arquivos where tipo='remessa'),1)),
  proximo_nosso_numero=greatest(c.proximo_nosso_numero,coalesce((select max(substring(nosso_numero from 4 for 5)::integer)+1
    from public.boletos where banco='sicredi' and canal='cnab240' and nosso_numero ~ '^[0-9]{9}$'
      and cooperativa=c.cooperativa and posto=c.posto and codigo_beneficiario=c.beneficiario),1));

-- A conta de recebimento já cadastrada passa a ser compartilhada. Os movimentos
-- mantêm seu centro de origem e suas políticas de acesso existentes.
update public.contas_financeiras set centro_id=null
  where id in (select conta_financeira_id from public.sicredi_cnab_config) and centro_id is not null;

-- Histórico anterior continua disponível. A restrição global vale para novas remessas.
alter table public.sicredi_cnab_arquivos add column if not exists sequencia_global boolean not null default false;
alter table public.sicredi_cnab_arquivos alter column sequencia_global set default true;
create unique index if not exists sicredi_cnab_remessa_global_uniq
  on public.sicredi_cnab_arquivos(sequencia) where tipo='remessa' and sequencia_global;
alter table public.sicredi_cnab_arquivos add column if not exists centros_retorno uuid[] not null default '{}';

drop policy if exists cnab_config_read on public.sicredi_cnab_config;
create policy cnab_config_read on public.sicredi_cnab_config for select to authenticated
  using(public.can_finance(auth.uid()));
drop policy if exists cnab_arquivos_read on public.sicredi_cnab_arquivos;
create policy cnab_arquivos_read on public.sicredi_cnab_arquivos for select to authenticated
  using(public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id)
    and not exists(select 1 from unnest(centros_retorno) as centros(id) where not public.usuario_pode_acessar_centro(centros.id)));

create or replace function public.cnab_salvar_config(_actor uuid,_config jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare c public.sicredi_cnab_config; v public.sicredi_cnab_config;
begin
  if coalesce(auth.role(),'')<>'service_role' or not public.has_role(_actor,'admin')
    or not exists(select 1 from public.profiles where id=_actor and ativo=true)
    then raise exception 'Somente administrador ativo configura o convenio compartilhado'; end if;
  perform pg_advisory_xact_lock(748208);
  select * into c from public.sicredi_cnab_config for update;
  v := jsonb_populate_record(null::public.sicredi_cnab_config,_config);
  v.centro_id := coalesce(c.centro_id,v.centro_id,(select id from public.centros order by id limit 1));
  if v.centro_id is null then raise exception 'Cadastre ao menos um centro de custo'; end if;
  v.tipo_cobranca := coalesce(v.tipo_cobranca,'NORMAL');
  if c.centro_id is null then
    v.proxima_remessa := greatest(v.proxima_remessa,coalesce((select max(sequencia)+1 from public.sicredi_cnab_arquivos where tipo='remessa'),1));
    v.proximo_nosso_numero := greatest(v.proximo_nosso_numero,coalesce((select max(substring(nosso_numero from 4 for 5)::integer)+1
      from public.boletos where banco='sicredi' and canal='cnab240' and nosso_numero ~ '^[0-9]{9}$'
        and cooperativa=v.cooperativa and posto=v.posto and codigo_beneficiario=v.beneficiario),1));
  end if;
  if not exists(select 1 from public.contas_financeiras where id=v.conta_financeira_id and ativo and centro_id is null)
    then raise exception 'Selecione uma conta financeira compartilhada, sem centro exclusivo'; end if;
  if v.categoria_tarifa_id is not null and not exists(select 1 from public.categorias_financeiras where id=v.categoria_tarifa_id and tipo='despesa')
    then raise exception 'Selecione categoria de despesa para tarifas'; end if;
  if c.centro_id is not null then
    if v.proxima_remessa<c.proxima_remessa or v.proximo_nosso_numero<c.proximo_nosso_numero
      then raise exception 'Sequenciais compartilhados nao podem retroceder'; end if;
    if exists(select 1 from public.sicredi_cnab_arquivos)
      and row(v.documento,v.cooperativa,v.posto,v.beneficiario,v.conta,v.conta_dv)
        is distinct from row(c.documento,c.cooperativa,c.posto,c.beneficiario,c.conta,c.conta_dv)
      then raise exception 'Convenio possui historico. Nao altere a identificacao bancaria'; end if;
  end if;
  insert into public.sicredi_cnab_config(centro_id,nome,documento,cooperativa,posto,beneficiario,conta,conta_dv,
    proxima_remessa,proximo_nosso_numero,homologado,juros_mensal,multa_percentual,conta_financeira_id,categoria_tarifa_id,tipo_cobranca,chave_pix)
  values(v.centro_id,v.nome,v.documento,v.cooperativa,v.posto,v.beneficiario,v.conta,v.conta_dv,
    v.proxima_remessa,v.proximo_nosso_numero,v.homologado,v.juros_mensal,v.multa_percentual,v.conta_financeira_id,v.categoria_tarifa_id,v.tipo_cobranca,v.chave_pix)
  on conflict(centro_id) do update set nome=excluded.nome,documento=excluded.documento,
    cooperativa=excluded.cooperativa,posto=excluded.posto,beneficiario=excluded.beneficiario,
    conta=excluded.conta,conta_dv=excluded.conta_dv,proxima_remessa=excluded.proxima_remessa,
    proximo_nosso_numero=excluded.proximo_nosso_numero,homologado=excluded.homologado,
    juros_mensal=excluded.juros_mensal,multa_percentual=excluded.multa_percentual,
    conta_financeira_id=excluded.conta_financeira_id,categoria_tarifa_id=excluded.categoria_tarifa_id,
    tipo_cobranca=excluded.tipo_cobranca,chave_pix=excluded.chave_pix,updated_at=clock_timestamp();
  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
    values('sicredi_cnab_config',v.centro_id,'configurar_cnab_compartilhado',jsonb_build_object('homologado',v.homologado),_actor);
end;
$$;

-- Altera SOMENTE a localização da configuração/lock. Mantém os guards de
-- carteira da fase206 e toda a conciliação financeira das fases204/205.
do $$
declare assinatura text; definicao text;
begin
  foreach assinatura in array array[
    'public.cnab_gravar_remessa(uuid,uuid,timestamp with time zone,integer,integer,text,text,text,jsonb)',
    'public.cnab_gravar_retorno_fase204(uuid,uuid,text,text,text,jsonb)',
    'public.sicredi_solicitar_vencimento(uuid,uuid,date,date,jsonb)',
    'public.sicredi_finalizar_vencimento(uuid,uuid,text,date)'
  ] loop
    definicao := pg_get_functiondef(assinatura::regprocedure);
    definicao := replace(definicao,'public.sicredi_cnab_config where centro_id=_centro for update','public.sicredi_cnab_config for update');
    definicao := replace(definicao,'public.sicredi_cnab_config where centro_id=b.centro_id for update','public.sicredi_cnab_config for update');
    definicao := replace(definicao,'public.sicredi_cnab_config where centro_id=s.centro_id for update','public.sicredi_cnab_config for update');
    definicao := replace(definicao,'updated_at=clock_timestamp() where centro_id=_centro','updated_at=clock_timestamp()');
    definicao := replace(definicao,'updated_at=clock_timestamp() where centro_id=b.centro_id','updated_at=clock_timestamp()');
    execute definicao;
  end loop;
end $$;

-- Retorno de um convênio único pode conter títulos de vários centros.
-- Preserva o wrapper de vencimento anterior como auxiliar privado.
do $$ begin
  if to_regprocedure('public.cnab_gravar_retorno_fase205(uuid,uuid,text,text,text,jsonb)') is null then
    alter function public.cnab_gravar_retorno(uuid,uuid,text,text,text,jsonb) rename to cnab_gravar_retorno_fase205;
  end if;
end $$;
create or replace function public.cnab_gravar_retorno(
  _actor uuid,_centro uuid,_nome text,_conteudo text,_sha256 text,_eventos jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare c public.sicredi_cnab_config; b public.boletos; item jsonb; centros uuid[]; centro uuid;
  grupos jsonb := '{}'; arquivo uuid; primeiro uuid;
begin
  perform public.cnab_validar_ator(_actor,_centro);
  select * into c from public.sicredi_cnab_config for update;
  if c.centro_id is null or not c.homologado then raise exception 'Confirme a homologacao na configuracao'; end if;
  if jsonb_typeof(_eventos) is distinct from 'array' or jsonb_array_length(_eventos) not between 1 and 500
    then raise exception 'Quantidade de eventos invalida'; end if;
  for item in select value from jsonb_array_elements(_eventos) loop
    select * into b from public.boletos where canal='cnab240' and cooperativa=c.cooperativa
      and posto=c.posto and codigo_beneficiario=c.beneficiario and nosso_numero=item->>'nosso_numero';
    if b.id is null then raise exception 'Nosso numero nao encontrado no convenio: %',item->>'nosso_numero'; end if;
    perform public.cnab_validar_ator(_actor,b.centro_id);
    grupos := jsonb_set(grupos,array[b.centro_id::text],coalesce(grupos->b.centro_id::text,'[]') || jsonb_build_array(item));
  end loop;
  select array_agg(key::uuid order by key) into centros from jsonb_each(grupos);
  foreach centro in array centros loop
    arquivo := public.cnab_gravar_retorno_fase205(_actor,centro,_nome,_conteudo,_sha256,grupos->centro::text);
    -- A cópia de um retorno misto só pode ser lida por quem acessa todos os centros envolvidos.
    update public.sicredi_cnab_arquivos set centros_retorno=centros where id=arquivo;
    primeiro := coalesce(primeiro,arquivo);
  end loop;
  return primeiro;
end;
$$;
revoke all on function public.cnab_gravar_retorno_fase205(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.cnab_gravar_retorno(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.cnab_gravar_retorno(uuid,uuid,text,text,text,jsonb) to service_role;
revoke all on function public.cnab_salvar_config(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cnab_salvar_config(uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
