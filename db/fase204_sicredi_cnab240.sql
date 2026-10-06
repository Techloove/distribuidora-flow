-- CNAB 240 Sicredi: configuração por centro, remessas/retornos auditáveis.
-- Aplicar após fase203. Arquivo 081, lote 040; homologar com a cooperativa.
begin;

create table if not exists public.sicredi_cnab_config (
  centro_id uuid primary key references public.centros(id),
  nome text not null check (length(nome) between 1 and 30),
  documento text not null check (documento ~ '^(\d{11}|\d{14})$'),
  cooperativa text not null check (cooperativa ~ '^\d{4}$'),
  posto text not null check (posto ~ '^\d{2}$'),
  beneficiario text not null check (beneficiario ~ '^\d{5}$'),
  conta text not null check (conta ~ '^\d{1,12}$'),
  conta_dv text not null check (conta_dv ~ '^\d$'),
  conta_financeira_id uuid not null references public.contas_financeiras(id),
  categoria_tarifa_id uuid references public.categorias_financeiras(id),
  proxima_remessa integer not null default 1 check (proxima_remessa between 1 and 1000000),
  proximo_nosso_numero integer not null default 1 check (proximo_nosso_numero between 1 and 100000),
  tipo_cobranca text not null default 'NORMAL' check (tipo_cobranca in ('NORMAL','HIBRIDO')),
  chave_pix text,
  check (tipo_cobranca <> 'HIBRIDO' or (chave_pix is not null and chave_pix ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')),
  homologado boolean not null default false,
  juros_mensal numeric(5,2) not null default 0 check (juros_mensal between 0 and 100),
  multa_percentual numeric(5,2) not null default 0 check (multa_percentual between 0 and 100),
  updated_at timestamptz not null default now(),
  unique (cooperativa,posto,beneficiario)
);

create table if not exists public.sicredi_cnab_arquivos (
  id uuid primary key default gen_random_uuid(),
  centro_id uuid not null references public.sicredi_cnab_config(centro_id),
  tipo text not null check (tipo in ('remessa','retorno')),
  sequencia integer,
  nome text not null,
  conteudo text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  quantidade integer not null check (quantidade between 1 and 500),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(centro_id,tipo,sha256),
  unique(centro_id,tipo,sequencia)
);

alter table public.boletos add column if not exists canal text not null default 'api';
alter table public.boletos add column if not exists cnab_remessa_id uuid references public.sicredi_cnab_arquivos(id);
create unique index if not exists boletos_cnab_nosso_numero_uniq
  on public.boletos(cooperativa,posto,codigo_beneficiario,nosso_numero) where canal='cnab240';

create table if not exists public.sicredi_cnab_eventos (
  id uuid primary key default gen_random_uuid(),
  arquivo_id uuid not null references public.sicredi_cnab_arquivos(id),
  boleto_id uuid not null references public.boletos(id),
  chave text not null unique,
  ocorrencia text not null,
  dados jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.sicredi_cnab_config enable row level security;
alter table public.sicredi_cnab_arquivos enable row level security;
alter table public.sicredi_cnab_eventos enable row level security;
drop policy if exists cnab_config_read on public.sicredi_cnab_config;
create policy cnab_config_read on public.sicredi_cnab_config for select to authenticated
  using (public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id));
drop policy if exists cnab_arquivos_read on public.sicredi_cnab_arquivos;
create policy cnab_arquivos_read on public.sicredi_cnab_arquivos for select to authenticated
  using (public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id));
drop policy if exists cnab_eventos_read on public.sicredi_cnab_eventos;
create policy cnab_eventos_read on public.sicredi_cnab_eventos for select to authenticated
  using (exists (select 1 from public.sicredi_cnab_arquivos a where a.id=arquivo_id
    and public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(a.centro_id)));
revoke all on public.sicredi_cnab_config,public.sicredi_cnab_arquivos,public.sicredi_cnab_eventos from public,anon,authenticated;
grant select on public.sicredi_cnab_config,public.sicredi_cnab_arquivos,public.sicredi_cnab_eventos to authenticated;
grant all on public.sicredi_cnab_config,public.sicredi_cnab_arquivos,public.sicredi_cnab_eventos to service_role;

create or replace function public.cnab_validar_ator(_actor uuid,_centro uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Operacao exclusiva do servidor'; end if;
  if not public.ator_financeiro_pode_acessar_centro(_actor,_centro)
    or not exists(select 1 from public.profiles where id=_actor and ativo=true)
  then raise exception 'Sem acesso financeiro ao centro'; end if;
end;
$$;

create or replace function public.cnab_salvar_config(_actor uuid,_config jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare c public.sicredi_cnab_config; v public.sicredi_cnab_config;
begin
  v := jsonb_populate_record(null::public.sicredi_cnab_config,_config);
  v.tipo_cobranca := coalesce(v.tipo_cobranca,'NORMAL');
  perform public.cnab_validar_ator(_actor,v.centro_id);
  if not (public.has_role(_actor,'admin') or public.has_role(_actor,'gestor')) then raise exception 'Somente administracao configura CNAB'; end if;
  if not exists(select 1 from public.contas_financeiras where id=v.conta_financeira_id and ativo and (centro_id is null or centro_id=v.centro_id)) then raise exception 'Conta financeira invalida para o centro'; end if;
  if v.categoria_tarifa_id is not null and not exists(select 1 from public.categorias_financeiras where id=v.categoria_tarifa_id and tipo='despesa') then raise exception 'Selecione categoria de despesa para tarifas'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v.centro_id::text,748));
  select * into c from public.sicredi_cnab_config where centro_id=v.centro_id for update;
  if c.centro_id is not null then
    if v.proxima_remessa < c.proxima_remessa or v.proximo_nosso_numero < c.proximo_nosso_numero then raise exception 'Sequenciais nao podem retroceder'; end if;
    if exists(select 1 from public.sicredi_cnab_arquivos where centro_id=v.centro_id)
      and row(v.documento,v.cooperativa,v.posto,v.beneficiario,v.conta,v.conta_dv)
        is distinct from row(c.documento,c.cooperativa,c.posto,c.beneficiario,c.conta,c.conta_dv)
    then raise exception 'Conta com historico CNAB nao pode ser substituida'; end if;
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
    conta_financeira_id=excluded.conta_financeira_id,categoria_tarifa_id=excluded.categoria_tarifa_id,tipo_cobranca=excluded.tipo_cobranca,chave_pix=excluded.chave_pix,updated_at=clock_timestamp();
  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
    values('sicredi_cnab_config',v.centro_id,'configurar_cnab',jsonb_build_object('homologado',v.homologado),_actor);
end;
$$;

create or replace function public.cnab_gravar_remessa(
  _actor uuid,_centro uuid,_versao timestamptz,_sequencia integer,_nosso_inicio integer,
  _nome text,_conteudo text,_sha256 text,_titulos jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare c public.sicredi_cnab_config; cr public.contas_receber; arquivo uuid; item jsonb; saldo numeric(14,2); n integer;
begin
  perform public.cnab_validar_ator(_actor,_centro);
  select * into c from public.sicredi_cnab_config where centro_id=_centro for update;
  if c.centro_id is null or c.updated_at is distinct from _versao or c.proxima_remessa<>_sequencia or c.proximo_nosso_numero<>_nosso_inicio
    then raise exception 'Configuracao mudou. Atualize e gere novamente'; end if;
  n := jsonb_array_length(_titulos);
  if n not between 1 and 500 or _nosso_inicio+n>100000 or _sequencia>999999 then raise exception 'Limite de sequenciais ou titulos excedido'; end if;
  insert into public.sicredi_cnab_arquivos(centro_id,tipo,sequencia,nome,conteudo,sha256,quantidade,created_by)
    values(_centro,'remessa',_sequencia,_nome,_conteudo,_sha256,n,_actor) returning id into arquivo;
  for item in select value from jsonb_array_elements(_titulos) order by value->>'conta_id' loop
    select * into cr from public.contas_receber where id=(item->>'conta_id')::uuid for update;
    if cr.id is null or cr.centro_id is distinct from _centro or cr.status not in ('aberto','parcial') then raise exception 'Titulo invalido ou sem acesso'; end if;
    saldo := round(coalesce(cr.valor,0)+coalesce(cr.juros,0)+coalesce(cr.multa,0)+coalesce(cr.acrescimo,0)-coalesce(cr.desconto,0)-coalesce(cr.valor_pago,0),2);
    if saldo<=0 or saldo is distinct from (item->>'valor')::numeric or cr.vencimento::text is distinct from item->>'vencimento' then raise exception 'Titulo mudou. Atualize e gere novamente'; end if;
    if exists(select 1 from public.boletos where conta_receber_id=cr.id and status in ('pendente','em_processamento','registrado','liquidado')) then raise exception 'Titulo ja possui boleto ativo'; end if;
    insert into public.boletos(conta_receber_id,cliente_id,centro_id,pedido_id,documento,parcela,banco,
      seu_numero,nosso_numero,valor,vencimento,status,created_by,cooperativa,posto,codigo_beneficiario,canal,cnab_remessa_id,tipo_cobranca)
    values(cr.id,cr.cliente_id,cr.centro_id,cr.pedido_id,cr.documento,cr.parcela,'sicredi',
      item->>'documento',item->>'nosso_numero',saldo,cr.vencimento,'pendente',_actor,c.cooperativa,c.posto,c.beneficiario,'cnab240',arquivo,c.tipo_cobranca);
  end loop;
  update public.sicredi_cnab_config set proxima_remessa=_sequencia+1,proximo_nosso_numero=_nosso_inicio+n,updated_at=clock_timestamp() where centro_id=_centro;
  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
    values('sicredi_cnab_arquivos',arquivo,'gerar_remessa_cnab',jsonb_build_object('quantidade',n,'sequencia',_sequencia),_actor);
  return arquivo;
end;
$$;

create or replace function public.cnab_gravar_retorno(
  _actor uuid,_centro uuid,_nome text,_conteudo text,_sha256 text,_eventos jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare c public.sicredi_cnab_config; b public.boletos; cr public.contas_receber; arquivo uuid; item jsonb; chave_evento text; evento_id uuid;
  old_claims text; old_sub text; old_role text; v_valor numeric(14,2);
begin
  perform public.cnab_validar_ator(_actor,_centro);
  select * into c from public.sicredi_cnab_config where centro_id=_centro for update;
  if c.centro_id is null or not c.homologado then raise exception 'Confirme a homologacao na configuracao antes de aplicar retornos'; end if;
  select id into arquivo from public.sicredi_cnab_arquivos where centro_id=_centro and tipo='retorno' and sha256=_sha256;
  if arquivo is not null then return arquivo; end if;
  if jsonb_array_length(_eventos) not between 1 and 500 then raise exception 'Quantidade de eventos invalida'; end if;
  insert into public.sicredi_cnab_arquivos(centro_id,tipo,nome,conteudo,sha256,quantidade,created_by)
    values(_centro,'retorno',_nome,_conteudo,_sha256,jsonb_array_length(_eventos),_actor) returning id into arquivo;
  for item in select value from jsonb_array_elements(_eventos) loop
    select * into b from public.boletos where canal='cnab240' and centro_id=_centro and cooperativa=c.cooperativa
      and posto=c.posto and codigo_beneficiario=c.beneficiario and nosso_numero=item->>'nosso_numero' for update;
    if b.id is null then raise exception 'Nosso numero nao encontrado neste centro: %',item->>'nosso_numero'; end if;
    if b.valor is distinct from (item->>'valor_titulo')::numeric then raise exception 'Valor nominal divergente para %',b.nosso_numero; end if;
    if b.seu_numero is distinct from item->>'documento' then raise exception 'Documento divergente para %',b.nosso_numero; end if;
    chave_evento := b.id::text || ':' || md5((item - 'data_credito')::text);
    evento_id := null;
    insert into public.sicredi_cnab_eventos(arquivo_id,boleto_id,chave,ocorrencia,dados)
      values(arquivo,b.id,chave_evento,item->>'ocorrencia',item) on conflict(chave) do nothing returning id into evento_id;
    if evento_id is null then continue; end if;
    if b.tipo_cobranca='HIBRIDO' and item->>'ocorrencia'='02' and nullif(item->>'qrcode_pix','') is not null then
      if b.qrcode_pix is not null and b.qrcode_pix is distinct from item->>'qrcode_pix' then raise exception 'QR Code anterior divergente'; end if;
      update public.boletos set qrcode_pix=item->>'qrcode_pix',txid=item->'pix'->>'txid' where id=b.id;
    end if;
    if item->>'ocorrencia' in ('06','17','61') then
      v_valor := (item->>'valor_recebido')::numeric;
      if v_valor<=0 or nullif(item->>'data_ocorrencia','') is null then raise exception 'Liquidacao sem valor ou data'; end if;
      if v_valor is distinct from (item->>'valor_titulo')::numeric+(item->>'juros')::numeric-(item->>'desconto')::numeric-(item->>'abatimento')::numeric then raise exception 'Liquidacao parcial ou encargos divergentes. Concilie manualmente'; end if;
      if b.status='liquidado' then
        if b.valor_liquidado is distinct from v_valor or b.data_liquidacao::text is distinct from item->>'data_ocorrencia'
          or exists(select 1 from public.sicredi_cnab_eventos e where e.boleto_id=b.id and e.ocorrencia in ('06','17','61') and e.id<>evento_id and (e.dados - 'data_credito' - 'motivos' - 'ocorrencia' - 'pix') is distinct from (item - 'data_credito' - 'motivos' - 'ocorrencia' - 'pix'))
        then raise exception 'Liquidacao anterior divergente'; end if;
        continue;
      end if;
      if b.status not in ('pendente','registrado') and not (b.status='baixado' and item->>'ocorrencia'='17') then raise exception 'Boleto nao esta apto para liquidacao'; end if;
      select * into cr from public.contas_receber where id=b.conta_receber_id for update;
      if cr.id is null or cr.centro_id is distinct from _centro then raise exception 'Titulo invalido para liquidacao'; end if;
      if round(coalesce(cr.valor,0)+coalesce(cr.juros,0)+coalesce(cr.multa,0)+coalesce(cr.acrescimo,0)-coalesce(cr.desconto,0)-coalesce(cr.valor_pago,0),2) is distinct from b.valor then
        raise exception 'Saldo do titulo mudou. Concilie antes de importar';
      end if;
      if coalesce((item->>'outras_despesas')::numeric,0)<>0 or coalesce((item->>'outros_creditos')::numeric,0)<>0 then raise exception 'Outras despesas ou creditos exigem conciliacao manual'; end if;
      if (item->>'iof')::numeric<>0 then raise exception 'Retorno com IOF exige conciliacao manual'; end if;
      if (item->>'valor_liquido')::numeric>v_valor then raise exception 'Valor liquido superior ao recebido'; end if;
      if v_valor>(item->>'valor_liquido')::numeric and c.categoria_tarifa_id is null then raise exception 'Configure a categoria das tarifas bancarias antes de importar'; end if;
      -- Reutilize o fluxo financeiro existente, incluindo movimentacao e idempotencia.
      -- Somente esta RPC service_role validada pode atribuir o ator da transacao.
      old_claims := current_setting('request.jwt.claims',true);
      old_sub := current_setting('request.jwt.claim.sub',true);
      old_role := current_setting('request.jwt.claim.role',true);
      perform set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated')::text,true);
      perform set_config('request.jwt.claim.sub',_actor::text,true);
      perform set_config('request.jwt.claim.role','authenticated',true);
      perform public.receber_titulo(b.conta_receber_id,v_valor,(item->>'data_ocorrencia')::date,
        c.conta_financeira_id,null,(item->>'juros')::numeric,0,(item->>'desconto')::numeric+(item->>'abatimento')::numeric,
        'Liquidacao Sicredi CNAB 240 - arquivo ' || _nome);
      if v_valor>(item->>'valor_liquido')::numeric then
        perform public.lancar_movimento(c.conta_financeira_id,'saida',v_valor-(item->>'valor_liquido')::numeric,
          coalesce((item->>'data_credito')::date,(item->>'data_ocorrencia')::date),c.categoria_tarifa_id,_centro,
          'Tarifa Sicredi CNAB 240 - nosso numero ' || b.nosso_numero,_nome);
      end if;
      update public.boletos set status='liquidado',valor_liquidado=v_valor,data_liquidacao=(item->>'data_ocorrencia')::date where id=b.id;
      perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
      perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
      perform set_config('request.jwt.claim.role',coalesce(old_role,''),true);
    elsif item->>'ocorrencia'='02' and b.status='pendente' then
      update public.boletos set status='registrado',erro=null where id=b.id;
    elsif item->>'ocorrencia'='03' and b.status='pendente' then
      update public.boletos set status='erro',erro='Rejeicao CNAB: ' || coalesce(item->>'motivos','') where id=b.id;
    elsif item->>'ocorrencia'='09' and b.status in ('pendente','registrado') then
      update public.boletos set status='baixado' where id=b.id;
    end if;
  end loop;
  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
    values('sicredi_cnab_arquivos',arquivo,'importar_retorno_cnab',jsonb_build_object('sha256',_sha256),_actor);
  return arquivo;
end;
$$;

revoke all on function public.cnab_validar_ator(uuid,uuid) from public,anon,authenticated;
revoke all on function public.cnab_salvar_config(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.cnab_gravar_remessa(uuid,uuid,timestamptz,integer,integer,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.cnab_gravar_retorno(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.cnab_validar_ator(uuid,uuid) to service_role;
grant execute on function public.cnab_salvar_config(uuid,jsonb) to service_role;
grant execute on function public.cnab_gravar_remessa(uuid,uuid,timestamptz,integer,integer,text,text,text,jsonb) to service_role;
grant execute on function public.cnab_gravar_retorno(uuid,uuid,text,text,text,jsonb) to service_role;
commit;
