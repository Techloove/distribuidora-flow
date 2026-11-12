-- Tarifa individual LIQUI de emissões ERP. Não rateia tarifas agrupadas nem baixa boletos no banco.
-- Requer fases355 e359/360. Reutiliza a ativação, conta, categoria e data inicial da fase355.
begin;
do $$begin
 if to_regclass('public.sicoob_liqui_eventos_359') is null or to_regclass('public.sicoob_tarifas_financeiro_355') is null then
  raise exception 'Instale as fases355 e359/360 antes da fase361';
 end if;
end $$;
alter table public.sicoob_tarifas_financeiro_355 add column if not exists fonte_361 text not null default 'extrato' check(fonte_361 in('extrato','liqui'));
alter table public.sicoob_tarifas_financeiro_355 add column if not exists natureza_361 text not null default 'incerta' check(natureza_361 in('incerta','outra','liquidacao'));
alter table public.sicoob_tarifas_financeiro_355 add column if not exists motivo_361 text;
alter table public.sicoob_tarifas_config_355 add column if not exists ultima_liqui_361 timestamptz;
alter table public.sicoob_tarifas_config_355 add column if not exists erro_liqui_361 text;
create unique index if not exists sicoob_uma_tarifa_liqui_361 on public.sicoob_tarifas_financeiro_355(boleto_id) where fonte_361='liqui';
create index if not exists sicoob_tarifa_boleto_361 on public.sicoob_tarifas_financeiro_355(boleto_id);
create index if not exists sicoob_recebimentos_tarifa_361 on public.boletos(centro_id,data_emissao,id)
 where banco='sicoob' and canal='api' and ambiente='producao' and sicoob_recebimento_359 is not null;
-- Somente a área financeira da loja pode ler a contabilização; nenhuma escrita direta é aberta.
grant select on public.sicoob_tarifas_financeiro_355 to authenticated;
drop policy if exists sicoob_tarifa_leitura_361 on public.sicoob_tarifas_financeiro_355;
create policy sicoob_tarifa_leitura_361 on public.sicoob_tarifas_financeiro_355 for select to authenticated
 using(public.usuario_ativo() and public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id));

-- Uma descrição genérica de cobrança nunca prova uma segunda tarifa distinta da liquidação.
create or replace function public.sicoob_tarifa_outra_361(_descricao text) returns boolean
language sql immutable set search_path=public as $$
 select d ~ '(REGISTRO|EMISSAO|ALTERA|VENCIMENTO|PRORROGA|ABATIMENTO|DESCONTO|BAIXA|CANCELA|PROTESTO|MANUTENCAO|NEGATIVA)'
  and d !~ '(LIQUID|RECEBIMENTO|PAGAMENTO)'
 from (select upper(translate(coalesce(_descricao,''),'ÁÀÃÂÉÊÍÓÔÕÚÇáàãâéêíóôõúç','AAAAEEIOOOUCaaaaeeiooouc')) d) x;
$$;
create or replace function public.sicoob_tarifas_finalizar_355(_lease uuid,_movimentos jsonb default '[]'::jsonb,_erro text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c sicoob_tarifas_config_355;e sicoob_extrato_config_352;v jsonb;f sicoob_tarifas_financeiro_355;b boletos;m movimentos_financeiros;numero text;chave text;sig text;descricao text;dia date;total numeric;novos int:=0;ignorados int:=0;revisar int:=0;old_claims text;old_sub text;old_role text;hoje date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 perform pg_advisory_xact_lock(355,1);
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
  if chave is null or chave like 'LIQUI:%' or chave!~'^[A-Za-z0-9._:-]{6,120}$' then ignorados:=ignorados+1;continue;end if;
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
  select * into b from boletos z where z.centro_id=c.centro_id and z.banco='sicoob' and z.canal='api' and z.ambiente='producao' and z.status in('registrado','liquidado','baixado','cancelado') and ltrim(z.nosso_numero,'0')=ltrim(v->>'nosso_numero','0') and z.data_emissao>=c.inicio and z.data_emissao<=dia and z.conta_cobranca_id=c.conta_id and z.sicoob_snapshot_316->>'numero_conta'=numero and exists(select 1 from sicoob_operacoes_316 o where o.boleto_id=z.id and o.tipo='emissao' and o.estado='confirmado') order by z.id limit 1;
  if b.id is null then ignorados:=ignorados+1;continue;end if;
  insert into sicoob_tarifas_financeiro_355(numero_conta,transaction_id,centro_id,boleto_id,data_lancamento,valor,assinatura,estado,conta_id,categoria_id,natureza_361)
   values(numero,chave,c.centro_id,b.id,dia,total,sig,'pendente',c.conta_id,c.categoria_id,case when sicoob_tarifa_outra_361(descricao) then 'outra' else 'incerta' end);
  -- Uma tarifa genérica pode representar a liquidação já informada no LIQUI.
  -- Só eventos inequivocamente de outra natureza continuam pela origem extrato.
  if not sicoob_tarifa_outra_361(descricao) and (
   coalesce((b.sicoob_recebimento_359->>'tarifa')::numeric,0)>0
   or exists(select 1 from sicoob_tarifas_financeiro_355 x where x.boleto_id=b.id and x.fonte_361='liqui')
  ) then
   update sicoob_tarifas_financeiro_355 set estado='conferir_liqui',motivo_361='Possível repetição da tarifa de liquidação; conferir sem outro lançamento' where numero_conta=numero and transaction_id=chave;
   revisar:=revisar+1;continue;
  end if;
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

-- Somente recebimentos já validados e persistidos pelo coletor359 podem originar tarifa LIQUI.
-- O lançamento é independente do extrato e recupera recebimentos anteriores à instalação.
create or replace function public.sicoob_tarifas_liqui_processar_361(_centro uuid default null,_limite int default 100) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
 c sicoob_tarifas_config_355;b boletos;f sicoob_tarifas_financeiro_355;m movimentos_financeiros;
 d jsonb;v_tarifa numeric;dia date;numero text;chave text;sig text;motivo text;
 cl text;su text;ro text;novos int:=0;conferir int:=0;processados int:=0;antes_novos int;antes_conferir int;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operação exclusiva do servidor';end if;
 if _limite is null or _limite not between 1 and 500 then raise exception 'Limite inválido';end if;
 -- Mesma trava do extrato e da configuração: as duas origens não contabilizam simultaneamente.
 perform pg_advisory_xact_lock(355,1);
 cl:=current_setting('request.jwt.claims',true);su:=current_setting('request.jwt.claim.sub',true);ro:=current_setting('request.jwt.claim.role',true);
 for c in select * from sicoob_tarifas_config_355 where ativo and (_centro is null or centro_id=_centro) order by centro_id for update loop
  antes_novos:=novos;antes_conferir:=conferir;
  begin
   perform validar_sicoob_316(c.responsavel,c.centro_id,true);
   if not exists(select 1 from cobranca_centros cc join contas_financeiras a on a.id=cc.conta_financeira_id
    join sicoob_config_316 cfg on cfg.centro_id=cc.centro_id and cfg.ambiente='producao'
    where cc.centro_id=c.centro_id and cc.banco='sicoob' and cc.canal='api' and cc.ativo
    and cc.conta_financeira_id=c.conta_id and a.ativo and (a.centro_id is null or a.centro_id=c.centro_id)
    and cfg.ativo and cfg.autenticado_versao=cfg.versao)
   then raise exception 'CONFIGURACAO_CONTA_INDISPONIVEL';end if;
   if not exists(select 1 from categorias_financeiras x left join categorias_financeiras p on p.id=x.parent_id
    where x.id=c.categoria_id and x.ativo and x.tipo='despesa' and coalesce(p.grupo_dre,x.grupo_dre)='despesa_financeira' and (p.id is null or p.ativo))
   then raise exception 'CATEGORIA_FINANCEIRA_INDISPONIVEL';end if;
   perform set_config('request.jwt.claims',jsonb_build_object('sub',c.responsavel,'role','authenticated')::text,true);
   perform set_config('request.jwt.claim.sub',c.responsavel::text,true);perform set_config('request.jwt.claim.role','authenticated',true);
   if not coalesce(usuario_ativo(),false) or not coalesce(can_finance(auth.uid()),false)
    or not coalesce(pode_rotina('boletos_tarifa_registrar'),false) or not coalesce(usuario_pode_acessar_centro(c.centro_id),false)
   then raise exception 'RESPONSAVEL_SEM_PERMISSAO';end if;
   for b in
    select z.* from boletos z
    left join sicoob_tarifas_financeiro_355 t on t.boleto_id=z.id and t.fonte_361='liqui'
    where z.centro_id=c.centro_id and z.banco='sicoob' and z.canal='api' and z.ambiente='producao'
    and z.data_emissao>=c.inicio and z.sicoob_recebimento_359 is not null
    and ((t.boleto_id is null
     and case when jsonb_typeof(z.sicoob_recebimento_359->'tarifa')='number' and (z.sicoob_recebimento_359->>'tarifa')~'^[0-9]+(\.[0-9]{1,2})?$'
      then (z.sicoob_recebimento_359->>'tarifa')::numeric between 0.01 and 999999999999.99 else false end
     and (z.sicoob_recebimento_359->>'dataMovimento') between c.inicio::text and (now() at time zone 'America/Sao_Paulo')::date::text
     and z.sicoob_recebimento_359->>'dataMovimento'>=z.data_emissao::text)
     or (t.estado='lancado' and t.assinatura<>md5(z.sicoob_recebimento_359::text)))
    and exists(select 1 from sicoob_operacoes_316 o where o.boleto_id=z.id and o.tipo='emissao' and o.estado='confirmado')
    order by z.data_emissao,z.id limit greatest(0,_limite-processados) for update of z
   loop
    processados:=processados+1;d:=b.sicoob_recebimento_359;motivo:=null;
    select * into f from sicoob_tarifas_financeiro_355 where boleto_id=b.id and fonte_361='liqui' for update;
    if f.boleto_id is not null then
     -- Preserva valor/movimento originais, inclusive se a tarifa for alterada posteriormente.
     update sicoob_tarifas_financeiro_355 set estado='retorno_divergente',motivo_361='Retorno LIQUI alterado após contabilização; conferir sem relançamento',updated_at=now()
      where numero_conta=f.numero_conta and transaction_id=f.transaction_id;
     conferir:=conferir+1;continue;
    end if;
    -- Sem tarifa positiva não há despesa. Não transforma nulo em tarifa zero confirmada.
    if jsonb_typeof(d->'tarifa') is distinct from 'number' or coalesce(d->>'tarifa','')!~'^[0-9]+(\.[0-9]{1,2})?$' then continue;end if;
    v_tarifa:=(d->>'tarifa')::numeric;
    if v_tarifa<=0 or v_tarifa>999999999999.99 then continue;end if;
    if coalesce(d->>'dataMovimento','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then continue;end if;
    dia:=(d->>'dataMovimento')::date;numero:=d->>'numeroConta';chave:='LIQUI:'||(d->>'chave');sig:=md5(d::text);
    if dia<c.inicio or dia<b.data_emissao or dia>(now() at time zone 'America/Sao_Paulo')::date then continue;end if;
    if coalesce(d->>'chave','')!~'^[a-f0-9]{64}$'
     or not exists(select 1 from sicoob_liqui_eventos_359 e where e.centro_id=c.centro_id and e.boleto_id=b.id and e.chave=d->>'chave' and e.dados=d and e.estado in('baixado','repetido'))
     or b.status is distinct from 'liquidado' or b.conta_cobranca_id is distinct from c.conta_id
     or b.sicoob_snapshot_316->>'numero_conta' is distinct from numero
     or b.sicoob_snapshot_316->>'numero_cliente' is distinct from d->>'numeroCliente'
     or ltrim(b.nosso_numero,'0') is distinct from d->>'nossoNumero'
     or b.seu_numero is distinct from d->>'seuNumero' or b.codigo_barras is distinct from d->>'codigoBarras'
     or b.valor_liquidado is distinct from (d->>'valor')::numeric or b.data_liquidacao is distinct from (d->>'data')::date
     or not exists(select 1 from contas_receber t where t.id=b.conta_receber_id and t.centro_id=c.centro_id and t.status='pago' and t.conta_financeira_id=c.conta_id)
     or not exists(select 1 from sicoob_config_316 cfg where cfg.centro_id=c.centro_id and cfg.ambiente='producao' and cfg.numero_conta::text=numero and cfg.numero_cliente::text=d->>'numeroCliente')
    then motivo:='Recebimento ou identidade alterados; conferir tarifa sem lançamento';end if;
    -- A identificação da liquidação não autoriza duplicar uma tarifa de extrato anterior de natureza incerta.
    if motivo is null and exists(select 1 from sicoob_tarifas_financeiro_355 x
      where x.boleto_id=b.id and x.fonte_361='extrato' and x.natureza_361<>'outra'
      and (x.movimento_id is not null or x.estado not in('conferir_liqui')))
    then motivo:='Possível tarifa de liquidação já tratada pelo extrato; conferir sem duplicar';end if;
    if motivo is null and exists(select 1 from movimentos_financeiros x
     where x.conta_id=c.conta_id and x.centro_id=c.centro_id and x.data=dia and x.tipo='saida' and x.status='ativo'
     and (x.valor=v_tarifa or (x.categoria_id=c.categoria_id and upper(coalesce(x.descricao,''))~'(TARIFA|COBRAN|LIQUI)'))
     and not exists(select 1 from sicoob_tarifas_financeiro_355 y where y.movimento_id=x.id))
    then motivo:='Possível despesa manual preexistente; conferir sem duplicar';end if;
    if exists(select 1 from sicoob_tarifas_financeiro_355 x where x.numero_conta=numero and x.transaction_id=chave) then
     raise exception 'IDENTIFICADOR_TARIFA_CONFLITANTE';end if;
    insert into sicoob_tarifas_financeiro_355(numero_conta,transaction_id,centro_id,boleto_id,data_lancamento,valor,assinatura,estado,conta_id,categoria_id,fonte_361,natureza_361,motivo_361)
     values(numero,chave,c.centro_id,b.id,dia,v_tarifa,sig,case when motivo is null then 'pendente' else 'conferir_liqui' end,c.conta_id,c.categoria_id,'liqui','liquidacao',motivo);
    if motivo is not null then conferir:=conferir+1;continue;end if;
    select * into m from lancar_movimento(c.conta_id,'saida',v_tarifa,dia,c.categoria_id,c.centro_id,
     'Tarifa de liquidação Sicoob LIQUI — boleto ERP '||b.nosso_numero,'SICOOB-LIQUI-TARIFA-'||md5(numero||':'||chave));
    update sicoob_tarifas_financeiro_355 set movimento_id=m.id,estado='lancado',updated_at=now() where numero_conta=numero and transaction_id=chave;
    insert into auditoria(tabela,registro_id,acao,user_id,detalhe) values('boletos',b.id,'tarifa_sicoob_liqui_361',c.responsavel,
     jsonb_build_object('movimento',m.id,'valor',v_tarifa,'data',dia,'fonte','liqui','chave',d->>'chave'));
    novos:=novos+1;
   end loop;
   perform set_config('request.jwt.claims',coalesce(cl,''),true);perform set_config('request.jwt.claim.sub',coalesce(su,''),true);perform set_config('request.jwt.claim.role',coalesce(ro,''),true);
   update sicoob_tarifas_config_355 set ultima_liqui_361=now(),erro_liqui_361=null where centro_id=c.centro_id;
  exception when others then
   -- Falha de uma loja reverte seus lançamentos nesta transação e não impede as demais.
   novos:=antes_novos;conferir:=antes_conferir;
   perform set_config('request.jwt.claims',coalesce(cl,''),true);perform set_config('request.jwt.claim.sub',coalesce(su,''),true);perform set_config('request.jwt.claim.role',coalesce(ro,''),true);
   update sicoob_tarifas_config_355 set ultima_liqui_361=now(),erro_liqui_361='CONTABILIZACAO_LIQUI_NAO_CONCLUIDA_'||sqlstate where centro_id=c.centro_id;
  end;
  exit when processados>=_limite;
 end loop;
 return jsonb_build_object('lancados',novos,'conferir',conferir,'processados',processados);
end $$;

-- O cron executa somente conciliação de dados locais já validados; não acessa certificados nem o banco.
create or replace function public.sicoob_tarifas_liqui_cron_361() returns void
language plpgsql security definer set search_path=public as $$
declare cl text;su text;ro text;begin
 cl:=current_setting('request.jwt.claims',true);su:=current_setting('request.jwt.claim.sub',true);ro:=current_setting('request.jwt.claim.role',true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claim.role','service_role',true);
 begin perform sicoob_tarifas_liqui_processar_361();
 exception when others then
  perform set_config('request.jwt.claims',coalesce(cl,''),true);perform set_config('request.jwt.claim.sub',coalesce(su,''),true);perform set_config('request.jwt.claim.role',coalesce(ro,''),true);raise;
 end;
 perform set_config('request.jwt.claims',coalesce(cl,''),true);perform set_config('request.jwt.claim.sub',coalesce(su,''),true);perform set_config('request.jwt.claim.role',coalesce(ro,''),true);
end $$;
revoke all on function public.sicoob_tarifa_outra_361(text),public.sicoob_tarifas_liqui_processar_361(uuid,int),public.sicoob_tarifas_liqui_cron_361() from public,anon,authenticated;
grant execute on function public.sicoob_tarifas_liqui_processar_361(uuid,int) to service_role;
do $$begin
 if not exists(select 1 from cron.job where jobname='sicoob-tarifa-liqui-361') then
  perform cron.schedule('sicoob-tarifa-liqui-361','*/5 * * * *','select public.sicoob_tarifas_liqui_cron_361()');
 end if;
end $$;
create or replace function public.sicoob_tarifas_get_355(_actor uuid,_centro uuid) returns jsonb
language plpgsql security definer set search_path=public as $$declare c sicoob_tarifas_config_355;begin
 perform validar_sicoob_316(_actor,_centro,true);
 select * into c from sicoob_tarifas_config_355 where centro_id=_centro;
 return jsonb_build_object('ultimaLiqui',c.ultima_liqui_361,'erroLiqui',c.erro_liqui_361,'ativo',coalesce(c.ativo,false),'inicio',coalesce(c.inicio,(now() at time zone 'America/Sao_Paulo')::date),'categoriaId',c.categoria_id,'versao',coalesce(c.versao,0),'ultimaConsulta',c.ultima_consulta,'erro',c.erro,
 'conta',(select jsonb_build_object('id',f.id,'nome',f.nome) from cobranca_centros cc join contas_financeiras f on f.id=cc.conta_financeira_id where cc.centro_id=_centro and cc.banco='sicoob' and f.ativo and (f.centro_id is null or f.centro_id=_centro)),
 'categorias',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'nome',x.nome) order by x.nome) from categorias_financeiras x left join categorias_financeiras p on p.id=x.parent_id where x.ativo and x.tipo='despesa' and coalesce(p.grupo_dre,x.grupo_dre)='despesa_financeira' and (p.id is null or p.ativo)),'[]'::jsonb),
 'lancados',(select count(*) from sicoob_tarifas_financeiro_355 t join movimentos_financeiros m on m.id=t.movimento_id where t.centro_id=_centro and t.estado='lancado' and m.status='ativo' and row(m.conta_id,m.categoria_id,m.data,m.valor,m.tipo) is not distinct from row(t.conta_id,t.categoria_id,t.data_lancamento,t.valor,'saida'::text)),
 'conferir',(select count(*) from sicoob_tarifas_financeiro_355 t left join movimentos_financeiros m on m.id=t.movimento_id where t.centro_id=_centro and (t.estado<>'lancado' or m.status is distinct from 'ativo' or row(m.conta_id,m.categoria_id,m.data,m.valor,m.tipo) is distinct from row(t.conta_id,t.categoria_id,t.data_lancamento,t.valor,'saida'::text))));
end $$;
notify pgrst,'reload schema';
commit;
