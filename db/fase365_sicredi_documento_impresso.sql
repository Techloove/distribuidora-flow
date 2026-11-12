-- Separa o documento visível do identificador técnico; sem reemissão nem alteração de históricos.
-- Requer fase364. Novas emissões híbridas enviam documento/parcela em seuNumero e a chave do ciclo em idTituloEmpresa.
begin;
alter table public.boletos add column if not exists sicredi_documento_365 text
 check(sicredi_documento_365 is null or (char_length(sicredi_documento_365) between 1 and 10 and sicredi_documento_365 !~ '[[:cntrl:]]'));
create or replace function public.preparar_boleto_sicredi_fase224(_actor_id uuid,_conta_id uuid) returns public.boletos
language plpgsql security definer set search_path=public as $$
declare c public.sicredi_config; b public.boletos; coop text; posto_api text; ben text; retentativa boolean; cr public.contas_receber; referencia text;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operacao exclusiva do servidor'; end if;
  if not exists(select 1 from public.profiles where id=_actor_id and ativo) then raise exception 'Usuario inativo'; end if;
  select * into c from public.sicredi_config for share;
  if c.id is null then raise exception 'Configure Sicredi antes de emitir'; end if;
  coop:=case when c.ambiente='homologacao' then '6789' else c.cooperativa end;
  posto_api:=case when c.ambiente='homologacao' then '03' else c.posto end;
  ben:=case when c.ambiente='homologacao' then '12345' else c.codigo_beneficiario end;
  perform 1 from public.contas_receber where id=_conta_id for update;
  select * into b from public.boletos where conta_receber_id=_conta_id order by created_at desc limit 1 for update;
  if b.id is not null and b.status in ('erro','em_processamento','pendente') then
    if b.canal='cnab240' then raise exception 'Titulo possui ciclo CNAB. Acompanhe o retorno do banco'; end if;
    if b.ambiente is not null and row(b.ambiente,b.cooperativa,b.posto,b.codigo_beneficiario)
      is distinct from row(c.ambiente,coop,posto_api,ben) then raise exception 'Emissao anterior pertence a outro ambiente ou convenio. Concilie antes de reenviar'; end if;
  end if;
  if b.status in ('erro','em_processamento','pendente') and b.sicredi_tipo_emissao_364 is not null
   and b.sicredi_tipo_emissao_364 is distinct from c.tipo_cobranca then
   raise exception 'Modalidade da tentativa anterior diverge. Concilie antes de reenviar'; end if;
  if c.tipo_cobranca='HIBRIDO' and c.multa>0 and c.dias_multa>0 then
   raise exception 'Hibrido exige multa sem carencia adicional'; end if;
  retentativa:=b.id is not null and b.status in ('erro','em_processamento','pendente');
  -- Não muda o protocolo de tentativas antigas: elas continuam conciliáveis pelo seuNumero original.
  if not retentativa and c.tipo_cobranca='HIBRIDO' then
   select * into cr from public.contas_receber where id=_conta_id;
   referencia:=btrim(cr.documento)||'/'||coalesce(cr.parcela,1)::text;
   if referencia is null or nullif(btrim(cr.documento),'') is null or cr.parcela<1
    or char_length(referencia)>10 or referencia ~ '[[:cntrl:]]' then
    raise exception 'Documento/parcela Sicredi deve ter ate 10 caracteres, sem quebras de linha. Ajuste o documento do titulo antes de emitir'; end if;
  end if;
  b:=public.preparar_boleto_sicredi_fase131(_actor_id,_conta_id);
  if not retentativa and c.tipo_cobranca='HIBRIDO' then
   update public.boletos set sicredi_documento_365=referencia where id=b.id returning * into b;
  end if;
  update public.boletos set tipo_cobranca=c.tipo_cobranca,sicredi_tipo_emissao_364=c.tipo_cobranca,ambiente=c.ambiente,cooperativa=coop,posto=posto_api,codigo_beneficiario=ben,emissao_retentativa=retentativa
    where id=b.id returning * into b;
  return b;
end $$;
revoke all on function public.preparar_boleto_sicredi_fase224(uuid,uuid) from public,anon,authenticated;
revoke all on function public.preparar_boleto_sicredi_fase224(uuid,uuid) from service_role;

notify pgrst,'reload schema';
commit;
