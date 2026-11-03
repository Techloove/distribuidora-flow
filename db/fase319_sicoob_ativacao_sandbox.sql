-- Sandbox não utiliza nem compara a conta financeira de produção.
begin;
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
 if _ambiente='producao' and _conta is not null and not exists(select 1 from contas_financeiras where id=_conta and ativo and (centro_id is null or centro_id=_centro)) then raise exception 'Selecione uma conta financeira ativa da loja';end if;
 if cc.banco is not null and cc.banco not in('sicoob','indefinido') and exists(select 1 from boletos where centro_id=_centro) then raise exception 'Preserve o banco da loja com histórico de boletos';end if;
 if row(c.numero_cliente,c.numero_conta,c.numero_contrato) is distinct from row(vnumero,vconta,vcontrato)
 and exists(select 1 from boletos where centro_id=_centro and banco='sicoob') and _ambiente='producao' then raise exception 'Convênio com histórico não pode ser substituído. É permitida a renovação do aplicativo e certificado';end if;
 mudou:=row(c.client_id,c.numero_cliente,c.numero_conta,c.numero_contrato) is distinct from row(vclient,vnumero,vconta,vcontrato) or (_ambiente='producao' and cc.conta_financeira_id is distinct from _conta) or _segredo is not null;
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

notify pgrst,'reload schema';
commit;
