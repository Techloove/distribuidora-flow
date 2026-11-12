-- Recupera inclusões ERP enviadas/incertas somente por GET; nunca reenvia emissão.
-- Requer fase358 e a aplicação1.51.0. Preserva agendamentos, segredos e configurações existentes.
begin;
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
 where z.banco='sicoob' and z.canal='api' and z.ambiente='producao'
 and ((z.status in('registrado','liquidado') and nullif(z.nosso_numero,'') is not null
  and exists(select 1 from sicoob_operacoes_316 o where o.boleto_id=z.id and o.tipo='emissao' and o.estado='confirmado'))
 or (z.status='em_processamento' and nullif(z.nosso_numero,'') is null
  and exists(select 1 from sicoob_operacoes_316 o where o.id=z.sicoob_pendente_316 and o.boleto_id=z.id and o.centro_id=z.centro_id and o.tipo='emissao' and o.estado in('enviado','incerto'))))
 and coalesce(f.proxima_consulta,'epoch'::timestamptz)<=now() and coalesce(f.lease_ate,'epoch'::timestamptz)<=now()
 order by coalesce(f.proxima_consulta,'epoch'::timestamptz),z.id limit 5 for update of z skip locked loop
  select p.id into ator from profiles p where p.ativo and not coalesce(p.precisa_completar_cadastro,false)
    and has_role(p.id,'admin') and ator_financeiro_pode_acessar_centro(p.id,b.centro_id) order by p.id limit 1;
  if ator is null then continue;end if;
  insert into sicoob_auto_fila_358(boleto_id,lease,lease_ate,actor,config_versao)
   values(b.id,chave,now()+interval '3 minutes',ator,b.config_versao)
   on conflict(boleto_id) do update set lease=excluded.lease,lease_ate=excluded.lease_ate,actor=excluded.actor,config_versao=excluded.config_versao;
  itens:=itens||jsonb_build_object('id',b.id,'centro_id',b.centro_id,'actor',ator,'nosso_numero',b.nosso_numero,'recuperar_emissao',b.status='em_processamento' and nullif(b.nosso_numero,'') is null,'seu_numero',b.seu_numero,'valor',b.valor,'identificacao_empresa',b.sicoob_snapshot_316->>'identificacao_empresa','vencimento_emissao',(select o.requisicao->>'dataVencimento' from sicoob_operacoes_316 o where o.id=b.sicoob_pendente_316 and o.boleto_id=b.id),'versao',b.config_versao,'pagador_documento',b.sicoob_snapshot_316->>'pagador_documento');
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
    proxima_consulta=now()+least(240,(case when b.status='em_processamento' then 5 else 15 end)*(erros+1))*interval '1 minute',lease=null,lease_ate=null where boleto_id=_boleto;return;
 end if;
 perform validar_sicoob_316(f.actor,b.centro_id);
 select * into c from sicoob_config_316 where centro_id=b.centro_id and ambiente='producao' for share;
 if not coalesce(c.ativo,false) or c.versao is distinct from f.config_versao
  or c.numero_cliente is distinct from (b.sicoob_snapshot_316->>'numero_cliente')::bigint
  or c.numero_conta is distinct from (b.sicoob_snapshot_316->>'numero_conta')::bigint
  or c.numero_contrato is distinct from (b.sicoob_snapshot_316->>'numero_contrato')::bigint
  or not exists(select 1 from cobranca_centros where centro_id=b.centro_id and banco='sicoob' and canal='api' and ativo)
  then raise exception 'Configuração ou convênio mudou';end if;
 if b.banco<>'sicoob' or b.canal<>'api' or b.ambiente<>'producao' then raise exception 'Boleto divergente';end if;
 if b.nosso_numero is null or b.nosso_numero='' then
  if b.status is distinct from 'em_processamento' or not exists(select 1 from sicoob_operacoes_316 o
   where o.id=b.sicoob_pendente_316 and o.boleto_id=b.id and o.centro_id=b.centro_id and o.tipo='emissao' and o.estado in('enviado','incerto')
   and o.requisicao->>'seuNumero'=b.seu_numero and (o.requisicao->>'valor')::numeric=b.valor)
  then raise exception 'Emissão pendente não autorizada para recuperação';end if;
 elsif b.nosso_numero is distinct from (_banco->>'nossoNumero') then raise exception 'Boleto divergente';end if;
 -- A sincronização existente valida modalidade, identidade, valor e códigos e impede regressão de estados terminais.
 mudou:=b.retorno is distinct from _banco or b.sicoob_pendente_316 is not null;
 if mudou then perform sicoob_sincronizar_316(f.actor,b.id,_banco);end if;
 update sicoob_auto_fila_358 set ultima_consulta=now(),resultado=_banco->>'situacao',erros=0,
   diagnostico=_diagnostico,proxima_consulta=now()+case when _banco->>'situacao'='EM ABERTO' then interval '15 minutes' else interval '6 hours' end,
   lease=null,lease_ate=null where boleto_id=_boleto;
end $$;
create or replace function public.sicoob_auto_disparar_358() returns void
language plpgsql security definer set search_path=public as $$declare s text;begin
 select segredo into s from sicoob_auto_config_358 where id and ativo and coalesce(bloqueado_ate,'epoch'::timestamptz)<=now();
 if s is null then return;end if;
 if not exists(select 1 from boletos b left join sicoob_auto_fila_358 f on f.boleto_id=b.id
   where b.banco='sicoob' and b.canal='api' and b.ambiente='producao' and ((b.status in('registrado','liquidado') and nullif(b.nosso_numero,'') is not null
    and exists(select 1 from sicoob_operacoes_316 o where o.boleto_id=b.id and o.tipo='emissao' and o.estado='confirmado'))
   or (b.status='em_processamento' and nullif(b.nosso_numero,'') is null
    and exists(select 1 from sicoob_operacoes_316 o where o.id=b.sicoob_pendente_316 and o.boleto_id=b.id and o.centro_id=b.centro_id and o.tipo='emissao' and o.estado in('enviado','incerto'))))
   and coalesce(f.proxima_consulta,'epoch'::timestamptz)<=now() and coalesce(f.lease_ate,'epoch'::timestamptz)<=now()) then return;end if;
 perform net.http_post(url:='https://caparaosystem.com.br/api/sicoob/sincronizar',headers:=jsonb_build_object('X-Sicoob-Automacao',s,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;

-- Reinstalação não antecipa leases nem recria job. Retoma uma única vez a primeira coleta dos pendentes.
create table if not exists public.sicoob_confirmacao_instalada_362(id boolean primary key default true check(id));
alter table public.sicoob_confirmacao_instalada_362 enable row level security;
revoke all on public.sicoob_confirmacao_instalada_362 from public,anon,authenticated;
do $$begin
 if not exists(select 1 from sicoob_confirmacao_instalada_362 where id) then
  update sicoob_auto_fila_358 f set proxima_consulta=now()
  from boletos b where b.id=f.boleto_id and b.banco='sicoob' and b.canal='api' and b.ambiente='producao' and b.status='em_processamento'
   and nullif(b.nosso_numero,'') is null and coalesce(f.lease_ate,'epoch'::timestamptz)<=now()
   and exists(select 1 from sicoob_operacoes_316 o where o.id=b.sicoob_pendente_316 and o.boleto_id=b.id and o.centro_id=b.centro_id and o.tipo='emissao' and o.estado in('enviado','incerto'));
  insert into sicoob_confirmacao_instalada_362 values(true);
 end if;
end $$;
create or replace function public.sicoob_sincronizar_316(_actor uuid,_boleto uuid,_banco jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare b boletos;o sicoob_operacoes_316;confirma boolean:=false;v_nota text;nn text;st text;
begin
 select * into b from boletos where id=_boleto for update;
 perform validar_sicoob_316(_actor,b.centro_id);
 if b.banco is distinct from 'sicoob' or b.canal is distinct from 'api' or _banco is null then raise exception 'Boleto inválido';end if;
 if b.sicoob_snapshot_316->>'identificacao_empresa' is not null
  and b.sicoob_snapshot_316->>'identificacao_empresa' is distinct from _banco->>'identificacaoBoletoEmpresa'
 then raise exception 'Identificador da empresa divergente no retorno bancário';end if;
 nn:=_banco->>'nossoNumero';st:=_banco->>'situacao';
 if nn is null or nn!~'^[0-9]{1,18}$' or b.nosso_numero is not null and b.nosso_numero<>nn or (_banco->>'numeroCliente')::bigint is distinct from (b.sicoob_snapshot_316->>'numero_cliente')::bigint or (_banco->>'codigoModalidade')::int is distinct from 1 or (_banco->>'seuNumero') is distinct from b.seu_numero or (_banco->>'valor')::numeric is distinct from b.valor or st is null or st not in('EM ABERTO','BAIXADO','LIQUIDADO') then raise exception 'Retorno bancário não corresponde ao convênio, identificação e valor do boleto';end if;
 if (b.status='liquidado' and st<>'LIQUIDADO') or (b.status in('baixado','cancelado') and st='EM ABERTO') then raise exception 'Retorno contradiz ciclo encerrado. Confira no banco';end if;
 if coalesce(_banco->>'linhaDigitavel','')!~'^756[0-9]{44}$' or coalesce(_banco->>'codigoBarras','')!~'^756[0-9]{41}$' then raise exception 'Código bancário Sicoob inválido';end if;
 select * into o from sicoob_operacoes_316 where id=b.sicoob_pendente_316 for update;
 if o.id is not null then
  confirma:=case o.tipo when 'emissao' then true when 'baixar' then st='BAIXADO' when 'vencimento' then st='EM ABERTO' and (_banco->>'vencimento')=(o.esperado->>'vencimento') when 'abatimento' then st='EM ABERTO' and (_banco->>'abatimento')::numeric=(o.esperado->>'abatimento')::numeric when 'desconto' then st='EM ABERTO' and (_banco->'tipoDesconto')=(o.esperado->'tipoDesconto') and (_banco->'descontos')=(o.esperado->'descontos') else false end;
  if confirma and o.tipo='vencimento' then
   update contas_receber set vencimento=(_banco->>'vencimento')::date where id=b.conta_receber_id and vencimento=(o.anterior->>'vencimento')::date and status in('aberto','parcial');
   if not found then v_nota:='Vencimento bancário confirmado. Confira o vencimento financeiro, alterado em outro processo.';end if;
  end if;
  if confirma or st in('LIQUIDADO','BAIXADO') then
   update sicoob_operacoes_316 set estado=case when confirma then 'confirmado' else 'encerrado' end,resposta=_banco,nota=coalesce(v_nota,'Confirmado por retorno bancário'),updated_at=now() where id=o.id;
   update boletos set sicoob_pendente_316=null where id=b.id;
  end if;
 end if;
 update boletos set nosso_numero=nn,linha_digitavel=_banco->>'linhaDigitavel',codigo_barras=_banco->>'codigoBarras',vencimento=(_banco->>'vencimento')::date,status=case st when 'BAIXADO' then 'baixado' when 'LIQUIDADO' then 'liquidado' else 'registrado' end,retorno=_banco,erro=null where id=b.id;
 insert into auditoria(tabela,registro_id,acao,user_id,detalhe) values('boletos',b.id,'consultar_sicoob_316',_actor,jsonb_build_object('situacao',st,'operacao',o.id,'confirmada',confirma));
 return jsonb_build_object('situacao',st,'confirmado',confirma,'nota',v_nota,'pendente',exists(select 1 from boletos where id=b.id and sicoob_pendente_316 is not null));
end $$;



-- Novas emissões exibem documento/parcela; o identificador técnico permanece em campo próprio.
create or replace function public.sicoob_reservar_emissao_351(_actor uuid,_conta uuid,_payload jsonb,_versao int) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c sicoob_config_316;r jsonb;b boletos;o sicoob_operacoes_316;t contas_receber;referencia text;empresa text;
begin
 select s.* into c from sicoob_config_316 s join contas_receber x on x.centro_id=s.centro_id where x.id=_conta and s.ambiente='producao' for share of s;
 perform validar_sicoob_316(_actor,c.centro_id);
 if c.versao is distinct from _versao then raise exception 'As condições de emissão mudaram. Atualize antes de emitir';end if;
 r:=sicoob_reservar_emissao_316(_actor,_conta,_payload);
 if not coalesce((r->>'recuperar')::boolean,true) then
  select * into t from contas_receber where id=_conta;
  if nullif(btrim(t.documento),'') is null then raise exception 'Informe o número do documento do título antes de emitir';end if;
  referencia:=btrim(t.documento)||'/'||coalesce(t.parcela,1)::text;
  if char_length(referencia)>18 or referencia~'[[:cntrl:]]' then
   raise exception 'Documento/parcela do boleto Sicoob deve ter até 18 caracteres e não pode conter quebras de linha. Ajuste o documento do título';
  end if;
  select * into o from sicoob_operacoes_316 where id=(r->'operacao'->>'id')::uuid for update;
  empresa:=o.requisicao->>'identificacaoBoletoEmpresa';
  if coalesce(empresa,'')!~'^[a-f0-9]{25}$' then raise exception 'Identificação técnica da emissão indisponível';end if;
  update boletos set seu_numero=referencia,sicoob_snapshot_316=sicoob_snapshot_316||jsonb_build_object('condicoes_emissao',c.condicoes_emissao,'identificacao_empresa',empresa)
   where id=(r->'boleto'->>'id')::uuid returning * into b;
  update sicoob_operacoes_316 set esperado=esperado||jsonb_build_object('seuNumero',referencia),requisicao=requisicao||jsonb_build_object('seuNumero',referencia)
   where id=o.id returning * into o;
  r:=r||jsonb_build_object('boleto',to_jsonb(b),'operacao',to_jsonb(o));
 end if;
 return r;
end $$;
notify pgrst,'reload schema';
commit;
