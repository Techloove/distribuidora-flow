-- Sicoob Cobrança Bancária v3 por loja. Certificados ficam exclusivamente no Vault.
-- Não emite cobranças nem altera títulos ou convênios Sicredi durante a instalação.
begin;
insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values('sicoob_operar','Operar cobrança Sicoob por loja','Financeiro',181,'/boletos') on conflict do nothing;
insert into public.role_permissoes(role,permissao) select distinct role::text,'sicoob_operar' from public.role_menus where path='/boletos' and role::text in('admin','gestor','financeiro') on conflict do nothing;
create table if not exists public.sicoob_config_316(
 centro_id uuid not null references public.centros(id),ambiente text not null default 'producao' check(ambiente in('producao','homologacao')),ativo boolean not null default false,client_id text not null default '',
 numero_cliente bigint,numero_conta bigint,numero_contrato bigint,segredo_id uuid,
 versao int not null default 0,autenticado_em timestamptz,autenticado_versao int,
 updated_at timestamptz not null default now(),primary key(centro_id,ambiente)
);
alter table public.sicoob_config_316 enable row level security;
revoke all on public.sicoob_config_316 from public,anon,authenticated;
grant select on public.sicoob_config_316 to authenticated;
grant all on public.sicoob_config_316 to service_role;
drop policy if exists sicoob_config_leitura_316 on public.sicoob_config_316;
create policy sicoob_config_leitura_316 on public.sicoob_config_316 for select to authenticated using(public.usuario_ativo() and public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id));

alter table public.cobranca_centros drop constraint if exists cobranca_centros_check;
alter table public.cobranca_centros add constraint cobranca_centros_check check(
 (banco in('sicredi','sicoob') and canal='api') or (banco in('indefinido','sicoob') and canal='pendente' and not ativo)
);
alter table public.boletos add column if not exists sicoob_snapshot_316 jsonb;
alter table public.boletos add column if not exists sicoob_pendente_316 uuid;
-- Sandbox isolado: estas linhas nunca são contas a receber nem boletos de produção.
create table if not exists public.sicoob_sandbox_316(
 id uuid primary key default gen_random_uuid(),centro_id uuid not null references public.centros(id),
 banco text not null default 'sicoob' check(banco='sicoob'),canal text not null default 'api' check(canal='api'),ambiente text not null default 'homologacao' check(ambiente='homologacao'),
 seu_numero text not null,nosso_numero text,valor numeric(14,2) not null,vencimento date not null,
 status text not null default 'em_processamento' check(status in('em_processamento','registrado','liquidado','baixado','erro')),
 sicoob_snapshot_316 jsonb not null,sicoob_pendente_316 uuid,retorno jsonb,erro text,linha_digitavel text,codigo_barras text,enviado_em timestamptz,
 created_by uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.sicoob_sandbox_316 enable row level security;
revoke all on public.sicoob_sandbox_316 from public,anon,authenticated;
grant select on public.sicoob_sandbox_316 to authenticated;
grant all on public.sicoob_sandbox_316 to service_role;
drop policy if exists sicoob_sandbox_leitura_316 on public.sicoob_sandbox_316;
create policy sicoob_sandbox_leitura_316 on public.sicoob_sandbox_316 for select to authenticated using(public.usuario_ativo() and public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id));
create table if not exists public.sicoob_operacoes_316(
 id uuid primary key default gen_random_uuid(),boleto_id uuid references public.boletos(id),teste_id uuid references public.sicoob_sandbox_316(id),
 centro_id uuid not null references public.centros(id),tipo text not null check(tipo in('emissao','vencimento','baixar','abatimento','desconto')),
 estado text not null default 'reservado' check(estado in('reservado','enviado','incerto','confirmado','recusado','encerrado')),
 chave uuid not null unique,anterior jsonb,esperado jsonb not null,requisicao jsonb not null,
 resposta jsonb,motivo text not null,created_by uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),nota text,check((boleto_id is null)<>(teste_id is null))
);
create unique index if not exists sicoob_uma_pendente_316 on public.sicoob_operacoes_316(boleto_id) where estado in('reservado','enviado','incerto');
create unique index if not exists sicoob_teste_pendente_316 on public.sicoob_operacoes_316(teste_id) where estado in('reservado','enviado','incerto');
alter table public.sicoob_operacoes_316 enable row level security;
revoke all on public.sicoob_operacoes_316 from public,anon,authenticated;
grant select on public.sicoob_operacoes_316 to authenticated;
grant all on public.sicoob_operacoes_316 to service_role;
drop policy if exists sicoob_operacoes_leitura_316 on public.sicoob_operacoes_316;
create policy sicoob_operacoes_leitura_316 on public.sicoob_operacoes_316 for select to authenticated using(public.usuario_ativo() and public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id));

create or replace function public.validar_sicoob_316(_actor uuid,_centro uuid,_admin boolean default false) returns void
language plpgsql security definer set search_path=public as $$ begin
 if coalesce(auth.role(),'')<>'service_role' or not exists(select 1 from profiles where id=_actor and ativo and not coalesce(precisa_completar_cadastro,false))
 or not coalesce(public.ator_financeiro_pode_acessar_centro(_actor,_centro),false)
 or not exists(select 1 from centros where id=_centro and ativo) then raise exception 'Loja indisponível ou sem acesso financeiro';end if;
 if _admin and not public.has_role(_actor,'admin') then raise exception 'Somente administrador autorizado pode executar esta operação';end if;
end $$;

create or replace function public.sicoob_config_salvar_316(_actor uuid,_centro uuid,_config jsonb,_conta uuid,_ativo boolean,_esperada int,_segredo jsonb default null,_ambiente text default 'producao')
returns void language plpgsql security definer set search_path=public as $$
declare c sicoob_config_316;cc cobranca_centros;mudou boolean;vclient text;vnumero bigint;vconta bigint;vcontrato bigint;
begin
 perform validar_sicoob_316(_actor,_centro,true);
 if _ambiente is null or _ambiente not in('producao','homologacao') then raise exception 'Ambiente inválido';end if;
 insert into sicoob_config_316(centro_id,ambiente) values(_centro,_ambiente) on conflict do nothing;
 select * into c from sicoob_config_316 where centro_id=_centro and ambiente=_ambiente for update;
 select * into cc from cobranca_centros where centro_id=_centro for update;
 if c.versao is distinct from _esperada then raise exception 'Configuração alterada em outra sessão. Atualize antes de salvar';end if;
 if _ativo is null then raise exception 'Informe a ativação';end if;
 vclient:=btrim(coalesce(_config->>'client_id',''));
 vnumero:=nullif(_config->>'numero_cliente','')::bigint;vconta:=nullif(_config->>'numero_conta','')::bigint;vcontrato:=nullif(_config->>'numero_contrato','')::bigint;
 if length(vclient)>150 or coalesce(vnumero,1)<=0 or coalesce(vconta,1)<=0 or coalesce(vcontrato,1)<=0 then raise exception 'Dados do convênio inválidos';end if;
 if _conta is not null and not exists(select 1 from contas_financeiras where id=_conta and ativo and (centro_id is null or centro_id=_centro)) then raise exception 'Selecione uma conta financeira ativa da loja';end if;
 if cc.banco is not null and cc.banco not in('sicoob','indefinido') and exists(select 1 from boletos where centro_id=_centro) then raise exception 'Preserve o banco da loja com histórico de boletos';end if;
 if row(c.numero_cliente,c.numero_conta,c.numero_contrato) is distinct from row(vnumero,vconta,vcontrato)
 and exists(select 1 from boletos where centro_id=_centro and banco='sicoob') and _ambiente='producao' then raise exception 'Convênio com histórico não pode ser substituído. É permitida a renovação do aplicativo e certificado';end if;
 mudou:=row(c.client_id,c.numero_cliente,c.numero_conta,c.numero_contrato,cc.conta_financeira_id) is distinct from row(vclient,vnumero,vconta,vcontrato,_conta) or _segredo is not null;
 if mudou and _ativo then raise exception 'Salve desativado e teste a autenticação antes de habilitar a emissão';end if;
 if _segredo is not null then
  if jsonb_typeof(_segredo)<>'object' or _ambiente='producao' and (length(coalesce(_segredo->>'pfx','')) not between 1 and 400000 or length(coalesce(_segredo->>'senha',''))>512) or _ambiente='homologacao' and length(coalesce(_segredo->>'sandbox_token','')) not between 8 and 16000 then raise exception 'Credencial inválida para este ambiente';end if;
  if c.segredo_id is null then select vault.create_secret(_segredo::text,'sicoob-'||_ambiente||'-'||_centro::text,'Certificado privado de cobrança Sicoob') into c.segredo_id;
  else perform vault.update_secret(c.segredo_id,_segredo::text);end if;
 end if;
 if _ativo and (c.segredo_id is null or vclient='' or vnumero is null or vconta is null or (_ambiente='producao' and _conta is null) or c.autenticado_versao is distinct from c.versao or c.autenticado_em is null or c.autenticado_em<now()-interval '24 hours') then raise exception 'Informe convênio, conta e certificado; teste a autenticação antes de ativar';end if;
 update sicoob_config_316 set ativo=_ativo,client_id=vclient,numero_cliente=vnumero,numero_conta=vconta,numero_contrato=vcontrato,segredo_id=c.segredo_id,versao=versao+case when mudou then 1 else 0 end,
 autenticado_em=case when mudou then null else autenticado_em end,autenticado_versao=case when mudou then null else autenticado_versao end,updated_at=now() where centro_id=_centro and ambiente=_ambiente;
 if _ambiente='producao' then
 insert into cobranca_centros(centro_id,banco,canal,ativo,conta_financeira_id) values(_centro,'sicoob','api',_ativo,_conta) on conflict(centro_id) do update set banco='sicoob',canal='api',ativo=_ativo,conta_financeira_id=_conta,updated_at=now();
 end if;
 insert into auditoria(tabela,registro_id,acao,user_id,detalhe) values('cobranca_centros',_centro,'configurar_sicoob_316',_actor,jsonb_build_object('ativo',_ativo,'ambiente',_ambiente,'credencial_substituida',_segredo is not null));
end $$;

create or replace function public.sicoob_privado_316(_actor uuid,_centro uuid,_ambiente text default 'producao') returns jsonb
language plpgsql security definer set search_path=public as $$
declare c sicoob_config_316;s text;
begin
 perform validar_sicoob_316(_actor,_centro);
 select * into c from sicoob_config_316 where centro_id=_centro and ambiente=_ambiente;
 if c.centro_id is null or c.client_id='' or c.segredo_id is null or (_ambiente='producao' and (c.numero_cliente is null or c.numero_conta is null)) then raise exception 'Configure o aplicativo, convênio e certificado Sicoob desta loja';end if;
 select decrypted_secret into s from vault.decrypted_secrets where id=c.segredo_id;
 if s is null then raise exception 'Certificado da loja indisponível no cofre';end if;
 return jsonb_build_object('config',to_jsonb(c)-'segredo_id','certificado',s::jsonb);
end $$;
create or replace function public.sicoob_autenticado_316(_actor uuid,_centro uuid,_versao int,_ambiente text default 'producao') returns void
language plpgsql security definer set search_path=public as $$ begin
 perform validar_sicoob_316(_actor,_centro,true);
 update sicoob_config_316 set autenticado_em=now(),autenticado_versao=versao where centro_id=_centro and ambiente=_ambiente and versao=_versao;
 if not found then raise exception 'Configuração mudou durante o teste. Teste novamente';end if;
 insert into auditoria(tabela,registro_id,acao,user_id,detalhe) values('cobranca_centros',_centro,'autenticar_sicoob_316',_actor,'{}');
end $$;

create or replace function public.sicoob_reservar_emissao_316(_actor uuid,_conta uuid,_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare cr contas_receber;c sicoob_config_316;cc cobranca_centros;b boletos;o sicoob_operacoes_316;saldo numeric;liberacao text;ident uuid:=gen_random_uuid();snap jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 select s.* into c from sicoob_config_316 s join contas_receber t on t.centro_id=s.centro_id where t.id=_conta and s.ambiente='producao' for share of s;
 perform validar_sicoob_316(_actor,c.centro_id);
 select * into cc from cobranca_centros where centro_id=c.centro_id for share;
 if cc.banco is distinct from 'sicoob' or not coalesce(cc.ativo,false) or cc.canal is distinct from 'api' or c.segredo_id is null or c.autenticado_versao is distinct from c.versao then raise exception 'Sicoob API não habilitado para esta loja';end if;
 if not exists(select 1 from contas_financeiras where id=cc.conta_financeira_id and ativo and (centro_id is null or centro_id=c.centro_id)) then raise exception 'Conta de recebimento indisponível';end if;
 select * into cr from contas_receber where id=_conta for update;
 if cr.centro_id is distinct from c.centro_id or cr.status not in('aberto','parcial') then raise exception 'Título indisponível para emissão';end if;
 if cr.pedido_id is not null and not exists(select 1 from pedidos p where p.id=cr.pedido_id and p.centro_id=cr.centro_id and public.status_comissao_valido_302(p.status,p.tipo_documento)) then raise exception 'Aprove o pedido antes de emitir o boleto';end if;
 if cr.pedido_id is not null then liberacao:=public.bloqueio_boleto(cr.pedido_id);if liberacao is not null then raise exception '%',liberacao;end if;end if;
 saldo:=round(coalesce(cr.valor,0)+coalesce(cr.juros,0)+coalesce(cr.multa,0)+coalesce(cr.acrescimo,0)-coalesce(cr.desconto,0)-coalesce(cr.valor_pago,0),2);
 if saldo<=0 or saldo is distinct from (_payload->>'valor')::numeric or cr.vencimento is distinct from (_payload->>'dataVencimento')::date or (_payload->>'numeroCliente')::bigint is distinct from c.numero_cliente or (_payload->>'numeroContaCorrente')::bigint is distinct from c.numero_conta then raise exception 'Título ou convênio mudou. Atualize antes de emitir';end if;
 select * into b from boletos where conta_receber_id=cr.id and status in('pendente','em_processamento','registrado','liquidado') order by created_at desc limit 1 for update;
 if b.id is not null then
  if b.banco<>'sicoob' then raise exception 'Título já possui boleto de outro banco';end if;
  select * into o from sicoob_operacoes_316 where boleto_id=b.id and tipo='emissao' order by created_at desc limit 1;
  return jsonb_build_object('boleto',to_jsonb(b),'operacao',to_jsonb(o),'recuperar',true);
 end if;
 snap:=jsonb_build_object('client_id',c.client_id,'numero_cliente',c.numero_cliente,'numero_conta',c.numero_conta,'numero_contrato',c.numero_contrato,'pagador_documento',_payload->'pagador'->>'numeroCpfCnpj');
 insert into boletos(id,conta_receber_id,cliente_id,centro_id,pedido_id,documento,parcela,banco,canal,seu_numero,valor,vencimento,data_emissao,status,tentativas,created_by,ambiente,conta_cobranca_id,sicoob_snapshot_316)
 values(ident,cr.id,cr.cliente_id,cr.centro_id,cr.pedido_id,cr.documento,cr.parcela,'sicoob','api',left(replace(ident::text,'-',''),18),saldo,cr.vencimento,(now() at time zone 'America/Sao_Paulo')::date,'em_processamento',1,_actor,'producao',cc.conta_financeira_id,snap) returning * into b;
 insert into sicoob_operacoes_316(boleto_id,centro_id,tipo,chave,esperado,requisicao,motivo,created_by)
 values(b.id,b.centro_id,'emissao',gen_random_uuid(),jsonb_build_object('valor',b.valor,'vencimento',b.vencimento,'seuNumero',b.seu_numero),_payload||jsonb_build_object('dataEmissao',b.data_emissao,'seuNumero',b.seu_numero,'identificacaoBoletoEmpresa',left(replace(b.id::text,'-',''),25)),'Emissão de boleto',_actor) returning * into o;
 update boletos set sicoob_pendente_316=o.id where id=b.id;
 insert into auditoria(tabela,registro_id,acao,user_id,detalhe) values('boletos',b.id,'reservar_sicoob_316',_actor,jsonb_build_object('operacao',o.id));
 return jsonb_build_object('boleto',to_jsonb(b),'operacao',to_jsonb(o),'recuperar',false);
end $$;

create or replace function public.sicoob_reservar_alteracao_316(_actor uuid,_boleto uuid,_chave uuid,_tipo text,_anterior jsonb,_esperado jsonb,_payload jsonb,_motivo text) returns sicoob_operacoes_316
language plpgsql security definer set search_path=public as $$
declare b boletos;o sicoob_operacoes_316;t contas_receber;saldo numeric;
begin
 select * into b from boletos where id=_boleto for update;
 perform validar_sicoob_316(_actor,b.centro_id,_tipo in('baixar','abatimento','desconto'));
 if b.banco is distinct from 'sicoob' or b.canal is distinct from 'api' or b.status is distinct from 'registrado' or b.nosso_numero is null then raise exception 'Boleto Sicoob indisponível para alteração';end if;
 if _tipo is null or _tipo not in('vencimento','baixar','abatimento','desconto') or _chave is null or length(btrim(coalesce(_motivo,''))) not between 5 and 500 then raise exception 'Informe operação e motivo com pelo menos cinco caracteres';end if;
 select * into o from sicoob_operacoes_316 where chave=_chave;
 if o.id is not null then
  if o.boleto_id is distinct from b.id or o.created_by is distinct from _actor or o.tipo<>_tipo or o.requisicao is distinct from _payload then raise exception 'Chave já usada para outra solicitação';end if;
  return o;
 end if;
 if _tipo in('abatimento','desconto') then
  select * into t from contas_receber where id=b.conta_receber_id for update;
  saldo:=round(coalesce(t.valor,0)+coalesce(t.juros,0)+coalesce(t.multa,0)+coalesce(t.acrescimo,0)-coalesce(t.desconto,0)-coalesce(t.valor_pago,0),2);
  if t.id is null or t.centro_id is distinct from b.centro_id or t.status is distinct from 'aberto' or coalesce(t.valor_pago,0)<>0 or saldo is distinct from b.valor then raise exception 'Título mudou ou possui recebimento. Concilie antes de alterar descontos';end if;
 end if;
 if b.sicoob_pendente_316 is not null then raise exception 'Há solicitação pendente. Consulte o Sicoob antes de outra alteração';end if;
 if (_anterior->>'nossoNumero') is distinct from b.nosso_numero or (_anterior->>'seuNumero') is distinct from b.seu_numero or (_anterior->>'valor')::numeric is distinct from b.valor or (_anterior->>'situacao') is distinct from 'EM ABERTO' then raise exception 'Consulta bancária divergente do boleto';end if;
 insert into sicoob_operacoes_316(boleto_id,centro_id,tipo,chave,anterior,esperado,requisicao,motivo,created_by) values(b.id,b.centro_id,_tipo,_chave,_anterior,_esperado,_payload,btrim(_motivo),_actor) returning * into o;
 update boletos set sicoob_pendente_316=o.id where id=b.id;
 insert into auditoria(tabela,registro_id,acao,user_id,detalhe) values('boletos',b.id,'solicitar_sicoob_316',_actor,jsonb_build_object('operacao',o.id,'tipo',_tipo,'motivo',btrim(_motivo)));
 return o;
end $$;

create or replace function public.sicoob_enviar_316(_actor uuid,_operacao uuid) returns boolean
language plpgsql security definer set search_path=public as $$
declare o sicoob_operacoes_316;
begin
 select * into o from sicoob_operacoes_316 where id=_operacao for update;
 perform validar_sicoob_316(_actor,o.centro_id,o.tipo in('baixar','abatimento','desconto'));
 if o.estado<>'reservado' then return false;end if;
 update sicoob_operacoes_316 set estado='enviado',updated_at=now() where id=o.id;
 update boletos set enviado_em=now() where id=o.boleto_id;
 update sicoob_sandbox_316 set enviado_em=now() where id=o.teste_id;
 return true;
end $$;

create or replace function public.sicoob_estado_operacao_316(_actor uuid,_operacao uuid,_estado text,_nota text) returns void
language plpgsql security definer set search_path=public as $$
declare o sicoob_operacoes_316;
begin
 select * into o from sicoob_operacoes_316 where id=_operacao for update;
 perform validar_sicoob_316(_actor,o.centro_id);
 if o.estado in('confirmado','recusado','encerrado') then return;end if;
 if _estado is null or _estado not in('incerto','recusado') then raise exception 'Estado inválido';end if;
 update sicoob_operacoes_316 set estado=_estado,nota=left(_nota,500),updated_at=now() where id=o.id;
 if _estado='recusado' then update boletos set sicoob_pendente_316=null,status=case when o.tipo='emissao' then 'erro' else status end,erro=left(_nota,500) where id=o.boleto_id and sicoob_pendente_316=o.id;update sicoob_sandbox_316 set sicoob_pendente_316=null,status=case when o.tipo='emissao' then 'erro' else status end,erro=left(_nota,500) where id=o.teste_id and sicoob_pendente_316=o.id;end if;
end $$;

create or replace function public.sicoob_sincronizar_316(_actor uuid,_boleto uuid,_banco jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare b boletos;o sicoob_operacoes_316;confirma boolean:=false;v_nota text;nn text;st text;
begin
 select * into b from boletos where id=_boleto for update;
 perform validar_sicoob_316(_actor,b.centro_id);
 if b.banco is distinct from 'sicoob' or b.canal is distinct from 'api' or _banco is null then raise exception 'Boleto inválido';end if;
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


create or replace function public.sicoob_sandbox_reservar_316(_actor uuid,_centro uuid,_chave uuid,_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c sicoob_config_316;b sicoob_sandbox_316;o sicoob_operacoes_316;ident uuid:=gen_random_uuid();
begin
 perform validar_sicoob_316(_actor,_centro);
 select * into c from sicoob_config_316 where centro_id=_centro and ambiente='homologacao' for share;
 if not coalesce(c.ativo,false) or c.segredo_id is null or c.autenticado_versao is distinct from c.versao or c.numero_cliente is null or c.numero_conta is null then raise exception 'Configure e habilite o sandbox desta loja';end if;
 if (_payload->>'valor')::numeric<=0 or (_payload->>'numeroCliente')::bigint is distinct from c.numero_cliente or (_payload->>'numeroContaCorrente')::bigint is distinct from c.numero_conta then raise exception 'Dados de teste divergentes da configuração';end if;
 perform pg_advisory_xact_lock(hashtextextended('sicoob-teste:'||_chave::text,0));
 select * into o from sicoob_operacoes_316 where chave=_chave;
 if o.id is not null then
  if o.centro_id<>_centro or o.created_by is distinct from _actor or o.tipo<>'emissao' or o.teste_id is null then raise exception 'Chave já utilizada';end if;
  select * into b from sicoob_sandbox_316 where id=o.teste_id;
  if o.requisicao-'seuNumero'-'identificacaoBoletoEmpresa'-'dataEmissao' is distinct from _payload-'dataEmissao' then raise exception 'Dados de teste mudaram. Consulte o teste anterior antes de emitir outro';end if;
  return jsonb_build_object('boleto',to_jsonb(b),'operacao',to_jsonb(o),'recuperar',true);
 end if;
 insert into sicoob_sandbox_316(id,centro_id,seu_numero,valor,vencimento,sicoob_snapshot_316,created_by)
 values(ident,_centro,left(replace(ident::text,'-',''),18),(_payload->>'valor')::numeric,(_payload->>'dataVencimento')::date,jsonb_build_object('client_id',c.client_id,'numero_cliente',c.numero_cliente,'numero_conta',c.numero_conta,'numero_contrato',c.numero_contrato,'pagador_documento',_payload->'pagador'->>'numeroCpfCnpj'),_actor) returning * into b;
 insert into sicoob_operacoes_316(teste_id,centro_id,tipo,chave,esperado,requisicao,motivo,created_by)
 values(b.id,b.centro_id,'emissao',_chave,jsonb_build_object('valor',b.valor,'vencimento',b.vencimento,'seuNumero',b.seu_numero),_payload||jsonb_build_object('dataEmissao',(b.created_at at time zone 'America/Sao_Paulo')::date,'seuNumero',b.seu_numero,'identificacaoBoletoEmpresa',left(replace(b.id::text,'-',''),25)),'Emissão isolada de sandbox',_actor) returning * into o;
 update sicoob_sandbox_316 set sicoob_pendente_316=o.id where id=b.id;
 return jsonb_build_object('boleto',to_jsonb(b),'operacao',to_jsonb(o),'recuperar',false);
end $$;

create or replace function public.sicoob_sandbox_alterar_316(_actor uuid,_boleto uuid,_chave uuid,_tipo text,_anterior jsonb,_esperado jsonb,_payload jsonb,_motivo text) returns sicoob_operacoes_316
language plpgsql security definer set search_path=public as $$
declare b sicoob_sandbox_316;o sicoob_operacoes_316;
begin
 select * into b from sicoob_sandbox_316 where id=_boleto for update;
 perform validar_sicoob_316(_actor,b.centro_id,_tipo in('baixar','abatimento','desconto'));
 if b.banco is distinct from 'sicoob' or b.canal is distinct from 'api' or b.status is distinct from 'registrado' or b.nosso_numero is null then raise exception 'Boleto Sicoob indisponível para alteração';end if;
 if _tipo is null or _tipo not in('vencimento','baixar','abatimento','desconto') or _chave is null or length(btrim(coalesce(_motivo,''))) not between 5 and 500 then raise exception 'Informe operação e motivo com pelo menos cinco caracteres';end if;
 select * into o from sicoob_operacoes_316 where chave=_chave;
 if o.id is not null then
  if o.teste_id is distinct from b.id or o.created_by is distinct from _actor or o.tipo<>_tipo or o.requisicao is distinct from _payload then raise exception 'Chave já usada para outra solicitação';end if;
  return o;
 end if;
 if b.sicoob_pendente_316 is not null then raise exception 'Há solicitação pendente. Consulte o Sicoob antes de outra alteração';end if;
 if (_anterior->>'nossoNumero') is distinct from b.nosso_numero or (_anterior->>'seuNumero') is distinct from b.seu_numero or (_anterior->>'valor')::numeric is distinct from b.valor or (_anterior->>'situacao') is distinct from 'EM ABERTO' then raise exception 'Consulta bancária divergente do boleto';end if;
 insert into sicoob_operacoes_316(teste_id,centro_id,tipo,chave,anterior,esperado,requisicao,motivo,created_by) values(b.id,b.centro_id,_tipo,_chave,_anterior,_esperado,_payload,btrim(_motivo),_actor) returning * into o;
 update sicoob_sandbox_316 set sicoob_pendente_316=o.id where id=b.id;
 insert into auditoria(tabela,registro_id,acao,user_id,detalhe) values('sicoob_sandbox_316',b.id,'solicitar_sicoob_316',_actor,jsonb_build_object('operacao',o.id,'tipo',_tipo,'motivo',btrim(_motivo)));
 return o;
end $$;

create or replace function public.sicoob_sandbox_sincronizar_316(_actor uuid,_boleto uuid,_banco jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare b sicoob_sandbox_316;o sicoob_operacoes_316;confirma boolean:=false;v_nota text;nn text;st text;
begin
 select * into b from sicoob_sandbox_316 where id=_boleto for update;
 perform validar_sicoob_316(_actor,b.centro_id);
 if b.banco is distinct from 'sicoob' or b.canal is distinct from 'api' or _banco is null then raise exception 'Boleto inválido';end if;
 nn:=_banco->>'nossoNumero';st:=_banco->>'situacao';
 if nn is null or nn!~'^[0-9]{1,18}$' or b.nosso_numero is not null and b.nosso_numero<>nn or (_banco->>'numeroCliente')::bigint is distinct from (b.sicoob_snapshot_316->>'numero_cliente')::bigint or (_banco->>'codigoModalidade')::int is distinct from 1 or (_banco->>'seuNumero') is distinct from b.seu_numero or (_banco->>'valor')::numeric is distinct from b.valor or st is null or st not in('EM ABERTO','BAIXADO','LIQUIDADO') then raise exception 'Retorno bancário não corresponde ao convênio, identificação e valor do boleto';end if;
 if (b.status='liquidado' and st<>'LIQUIDADO') or (b.status in('baixado','cancelado') and st='EM ABERTO') then raise exception 'Retorno contradiz ciclo encerrado. Confira no banco';end if;
 if coalesce(_banco->>'linhaDigitavel','')!~'^756[0-9]{44}$' or coalesce(_banco->>'codigoBarras','')!~'^756[0-9]{41}$' then raise exception 'Código bancário Sicoob inválido';end if;
 select * into o from sicoob_operacoes_316 where id=b.sicoob_pendente_316 for update;
 if o.id is not null then
  confirma:=case o.tipo when 'emissao' then true when 'baixar' then st='BAIXADO' when 'vencimento' then st='EM ABERTO' and (_banco->>'vencimento')=(o.esperado->>'vencimento') when 'abatimento' then st='EM ABERTO' and (_banco->>'abatimento')::numeric=(o.esperado->>'abatimento')::numeric when 'desconto' then st='EM ABERTO' and (_banco->'tipoDesconto')=(o.esperado->'tipoDesconto') and (_banco->'descontos')=(o.esperado->'descontos') else false end;
  if confirma or st in('LIQUIDADO','BAIXADO') then
   update sicoob_operacoes_316 set estado=case when confirma then 'confirmado' else 'encerrado' end,resposta=_banco,nota=coalesce(v_nota,'Confirmado por retorno bancário'),updated_at=now() where id=o.id;
   update sicoob_sandbox_316 set sicoob_pendente_316=null where id=b.id;
  end if;
 end if;
 update sicoob_sandbox_316 set nosso_numero=nn,linha_digitavel=_banco->>'linhaDigitavel',codigo_barras=_banco->>'codigoBarras',vencimento=(_banco->>'vencimento')::date,status=case st when 'BAIXADO' then 'baixado' when 'LIQUIDADO' then 'liquidado' else 'registrado' end,retorno=_banco,erro=null where id=b.id;
 insert into auditoria(tabela,registro_id,acao,user_id,detalhe) values('sicoob_sandbox_316',b.id,'consultar_sicoob_316',_actor,jsonb_build_object('situacao',st,'operacao',o.id,'confirmada',confirma));
 return jsonb_build_object('situacao',st,'confirmado',confirma,'nota',v_nota,'pendente',exists(select 1 from sicoob_sandbox_316 where id=b.id and sicoob_pendente_316 is not null));
end $$;

-- Serviço privado: o navegador não acessa certificados nem fabrica confirmações bancárias.
do $$ declare f record;begin
 for f in select oid::regprocedure assinatura from pg_proc where pronamespace='public'::regnamespace and proname in('validar_sicoob_316','sicoob_config_salvar_316','sicoob_privado_316','sicoob_autenticado_316','sicoob_reservar_emissao_316','sicoob_reservar_alteracao_316','sicoob_enviar_316','sicoob_estado_operacao_316','sicoob_sincronizar_316','sicoob_sandbox_reservar_316','sicoob_sandbox_alterar_316','sicoob_sandbox_sincronizar_316') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.assinatura);
  execute format('grant execute on function %s to service_role',f.assinatura);
 end loop;
end $$;
-- Autorização explícita da loja Cimento; configuração inicialmente inativa e sem credenciais.
insert into cobranca_centros(centro_id,banco,canal,ativo) select id,'sicoob','api',false from centros where nome='Cimento' and ativo on conflict(centro_id) do nothing;
insert into sicoob_config_316(centro_id,ambiente) select cc.centro_id,a from cobranca_centros cc cross join (values('producao'),('homologacao')) x(a) where banco='sicoob' on conflict do nothing;
notify pgrst,'reload schema';
commit;
