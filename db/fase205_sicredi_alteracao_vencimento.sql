-- Após fase204. Alteração de vencimento confirmada pelo Sicredi antes de atualizar o ERP.
begin;
create table if not exists public.sicredi_boleto_alteracoes (
  id uuid primary key default gen_random_uuid(),
  boleto_id uuid not null references public.boletos(id),
  centro_id uuid not null references public.centros(id),
  vencimento_anterior date not null,
  vencimento_novo date not null,
  canal text not null check(canal in ('api','cnab240')),
  estado text not null default 'pendente' check(estado in ('pendente','enviado','incerto','confirmado','rejeitado')),
  arquivo_id uuid references public.sicredi_cnab_arquivos(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sicredi_alteracao_pendente_uniq on public.sicredi_boleto_alteracoes(boleto_id)
  where estado in ('pendente','enviado','incerto');
alter table public.boletos add column if not exists vencimento_solicitado date;
alter table public.boletos add column if not exists vencimento_solicitacao_id uuid references public.sicredi_boleto_alteracoes(id);
alter table public.sicredi_boleto_alteracoes enable row level security;
drop policy if exists sicredi_alteracoes_read on public.sicredi_boleto_alteracoes;
create policy sicredi_alteracoes_read on public.sicredi_boleto_alteracoes for select to authenticated
  using(public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id));
revoke all on public.sicredi_boleto_alteracoes from public,anon,authenticated;
grant select on public.sicredi_boleto_alteracoes to authenticated;
grant all on public.sicredi_boleto_alteracoes to service_role;

create or replace function public.sicredi_solicitar_vencimento(
  _actor uuid,_boleto uuid,_vencimento date,_anterior date,_arquivo jsonb default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare b public.boletos; cr public.contas_receber; c public.sicredi_cnab_config; arquivo uuid; solicitacao uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operacao exclusiva do servidor'; end if;
  -- Ordem de locks igual à importação de retorno: configuração, boleto, título.
  select * into b from public.boletos where id=_boleto;
  if b.id is null then raise exception 'Boleto nao encontrado'; end if;
  perform public.cnab_validar_ator(_actor,b.centro_id);
  if b.canal='cnab240' then
    select * into c from public.sicredi_cnab_config where centro_id=b.centro_id for update;
    if c.centro_id is null or _arquivo is null or c.updated_at is distinct from (_arquivo->>'versao')::timestamptz
      or c.proxima_remessa is distinct from (_arquivo->>'sequencia')::integer then raise exception 'Configuracao mudou. Atualize e tente novamente'; end if;
  elsif _arquivo is not null then raise exception 'Arquivo CNAB invalido para boleto API'; end if;
  select * into b from public.boletos where id=_boleto for update;
  select * into cr from public.contas_receber where id=b.conta_receber_id for update;
  if b.banco is distinct from 'sicredi' or b.status is distinct from 'registrado' or coalesce(b.canal,'') not in ('api','cnab240')
    or cr.id is null or cr.centro_id is distinct from b.centro_id or coalesce(cr.status,'') not in ('aberto','parcial') then raise exception 'Boleto ou titulo nao apto para alterar vencimento'; end if;
  if b.vencimento is distinct from _anterior or cr.vencimento is distinct from _anterior then raise exception 'Vencimento do titulo e boleto divergente. Concilie antes de alterar'; end if;
  if _vencimento is null or _vencimento<(now() at time zone 'America/Sao_Paulo')::date or _vencimento=_anterior then raise exception 'Informe um novo vencimento valido'; end if;
  if b.vencimento_solicitacao_id is not null then raise exception 'Existe alteracao pendente. Confira a resposta do banco'; end if;
  if b.canal='cnab240' then
    insert into public.sicredi_cnab_arquivos(centro_id,tipo,sequencia,nome,conteudo,sha256,quantidade,created_by)
      values(b.centro_id,'remessa',c.proxima_remessa,_arquivo->>'nome',_arquivo->>'conteudo',_arquivo->>'sha256',1,_actor) returning id into arquivo;
    update public.sicredi_cnab_config set proxima_remessa=proxima_remessa+1,updated_at=clock_timestamp() where centro_id=b.centro_id;
  end if;
  insert into public.sicredi_boleto_alteracoes(boleto_id,centro_id,vencimento_anterior,vencimento_novo,canal,arquivo_id,created_by)
    values(b.id,b.centro_id,b.vencimento,_vencimento,b.canal,arquivo,_actor) returning id into solicitacao;
  update public.boletos set vencimento_solicitado=_vencimento,vencimento_solicitacao_id=solicitacao where id=b.id;
  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
    values('boletos',b.id,'solicitar_vencimento_sicredi',jsonb_build_object('solicitacao',solicitacao,'anterior',_anterior,'novo',_vencimento,'canal',b.canal),_actor);
  return solicitacao;
end;
$$;

create or replace function public.sicredi_finalizar_vencimento(
  _actor uuid,_solicitacao uuid,_estado text,_vencimento_banco date default null
) returns void language plpgsql security definer set search_path=public as $$
declare s public.sicredi_boleto_alteracoes; b public.boletos; cr public.contas_receber;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operacao exclusiva do servidor'; end if;
  select * into s from public.sicredi_boleto_alteracoes where id=_solicitacao;
  if s.id is null then raise exception 'Solicitacao nao encontrada'; end if;
  perform public.cnab_validar_ator(_actor,s.centro_id);
  if s.canal='cnab240' then perform 1 from public.sicredi_cnab_config where centro_id=s.centro_id for update; end if;
  select * into b from public.boletos where id=s.boleto_id for update;
  select * into s from public.sicredi_boleto_alteracoes where id=_solicitacao for update;
  if s.estado in ('confirmado','rejeitado') then return; end if;
  if _estado not in ('enviado','incerto','confirmado','rejeitado') then raise exception 'Estado invalido'; end if;
  if b.vencimento_solicitacao_id is distinct from s.id then raise exception 'Solicitacao divergente'; end if;
  if _estado='confirmado' then
    if _vencimento_banco is distinct from s.vencimento_novo then raise exception 'Banco informou vencimento divergente'; end if;
    select * into cr from public.contas_receber where id=b.conta_receber_id for update;
    if b.status is distinct from 'registrado' or b.vencimento is distinct from s.vencimento_anterior or cr.id is null
      or cr.centro_id is distinct from s.centro_id or coalesce(cr.status,'') not in ('aberto','parcial') or cr.vencimento is distinct from s.vencimento_anterior
    then raise exception 'Boleto ou titulo mudou. Concilie a alteracao antes de continuar'; end if;
    update public.contas_receber set vencimento=s.vencimento_novo where id=cr.id;
    update public.boletos set vencimento=s.vencimento_novo where id=b.id;
  end if;
  if _estado in ('confirmado','rejeitado') then
    update public.boletos set vencimento_solicitado=null,vencimento_solicitacao_id=null where id=b.id;
  end if;
  update public.sicredi_boleto_alteracoes set estado=_estado,updated_at=clock_timestamp() where id=s.id;
  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
    values('boletos',b.id,'retorno_vencimento_sicredi',jsonb_build_object('solicitacao',s.id,'estado',_estado),_actor);
end;
$$;

-- Mantém o processamento financeiro da fase204 dentro da mesma transação.
do $$ begin
  if to_regprocedure('public.cnab_gravar_retorno_fase204(uuid,uuid,text,text,text,jsonb)') is null then
    alter function public.cnab_gravar_retorno(uuid,uuid,text,text,text,jsonb) rename to cnab_gravar_retorno_fase204;
  end if;
end $$;
-- Vencimento e QR são metadados; não podem transformar uma liquidação já conciliada em novo crédito.
create or replace function public.cnab_gravar_retorno_fase204(
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
          or exists(select 1 from public.sicredi_cnab_eventos e where e.boleto_id=b.id and e.ocorrencia in ('06','17','61') and e.id<>evento_id and (e.dados - 'data_credito' - 'motivos' - 'ocorrencia' - 'pix' - 'vencimento' - 'qrcode_pix') is distinct from (item - 'data_credito' - 'motivos' - 'ocorrencia' - 'pix' - 'vencimento' - 'qrcode_pix'))
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
create or replace function public.cnab_gravar_retorno(
  _actor uuid,_centro uuid,_nome text,_conteudo text,_sha256 text,_eventos jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare arquivo uuid; item jsonb; b public.boletos;
begin
  perform public.cnab_validar_ator(_actor,_centro);
  arquivo := public.cnab_gravar_retorno_fase204(_actor,_centro,_nome,_conteudo,_sha256,_eventos);
  for item in select value from jsonb_array_elements(_eventos) loop
    if item->>'ocorrencia' in ('14','26') then
      select * into b from public.boletos where canal='cnab240' and centro_id=_centro and nosso_numero=item->>'nosso_numero';
      if b.vencimento_solicitacao_id is not null then
        perform public.sicredi_finalizar_vencimento(_actor,b.vencimento_solicitacao_id,
          case when item->>'ocorrencia'='14' then 'confirmado' else 'rejeitado' end,
          (item->>'vencimento')::date);
        if item->>'ocorrencia'='14' and b.tipo_cobranca='HIBRIDO' and nullif(item->>'qrcode_pix','') is not null then
          update public.boletos set qrcode_pix=item->>'qrcode_pix',txid=item->'pix'->>'txid' where id=b.id;
        end if;
      end if;
    end if;
  end loop;
  return arquivo;
end;
$$;
revoke all on function public.cnab_gravar_retorno_fase204(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.cnab_gravar_retorno(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.cnab_gravar_retorno(uuid,uuid,text,text,text,jsonb) to service_role;
revoke all on function public.sicredi_solicitar_vencimento(uuid,uuid,date,date,jsonb) from public,anon,authenticated;
revoke all on function public.sicredi_finalizar_vencimento(uuid,uuid,text,date) from public,anon,authenticated;
grant execute on function public.sicredi_solicitar_vencimento(uuid,uuid,date,date,jsonb) to service_role;
grant execute on function public.sicredi_finalizar_vencimento(uuid,uuid,text,date) to service_role;
commit;
