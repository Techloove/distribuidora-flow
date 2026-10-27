-- Executar inteiro manualmente. Não gera lançamentos na instalação.
-- Tarifa de cobrança comprovada no extrato, separada do recebimento do cliente.
begin;
do $$begin
 if to_regprocedure('public.sicredi_liquidar_api_224(uuid,uuid,jsonb)') is null
 or to_regprocedure('public.lancar_movimento(uuid,text,numeric,date,uuid,uuid,text,text)') is null then
   raise exception 'Confira os motores financeiro e Sicredi224 antes da fase279';end if;
end $$;
create table if not exists public.sicredi_tarifas_279(
 boleto_id uuid primary key references public.boletos(id) on delete restrict,
 movimento_id uuid not null unique references public.movimentos_financeiros(id) on delete restrict,
 centro_id uuid not null references public.centros(id),
 conta_id uuid not null references public.contas_financeiras(id),
 categoria_id uuid not null references public.categorias_financeiras(id),
 valor numeric(14,2) not null check(valor>0 and valor::text not in('NaN','Infinity','-Infinity')),
 data_cobranca date not null,referencia text not null,
 origem text not null default 'extrato_conferido' check(origem='extrato_conferido'),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
alter table public.sicredi_tarifas_279 enable row level security;
revoke all on public.sicredi_tarifas_279 from public,anon,authenticated,service_role;
grant select on public.sicredi_tarifas_279 to authenticated;
drop policy if exists tarifa_leitura_279 on public.sicredi_tarifas_279;
create policy tarifa_leitura_279 on public.sicredi_tarifas_279 for select to authenticated using(
 public.usuario_ativo() and public.can_finance(auth.uid()) and public.usuario_pode_acessar_centro(centro_id)
 and (not public.escopo_representante() or public.documento_na_minha_carteira('boletos',boleto_id))
);
do $$declare nova text;begin
 insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values
 ('boletos_tarifa_registrar','Registrar tarifa de cobrança conferida no extrato','Boletos',179,'/boletos')
 on conflict(codigo) do nothing returning codigo into nova;
 if nova is not null then insert into public.role_permissoes(role,permissao)
 select role::text,nova from public.role_menus where path='/boletos' and role::text in('admin','gestor','financeiro')
 on conflict do nothing;end if;
end $$;
create or replace function public.registrar_tarifa_sicredi_279(
 _boleto uuid,_valor numeric,_data date,_categoria uuid,_referencia text,_confirmado boolean
) returns public.sicredi_tarifas_279 language plpgsql security definer set search_path=public as $$
declare b public.boletos;cr public.contas_receber;anterior public.sicredi_tarifas_279;
 movimento public.movimentos_financeiros;conta_centro uuid;
 hoje date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if auth.uid() is null or not coalesce(public.usuario_ativo(),false)
 or not coalesce(public.can_finance(auth.uid()),false) or not coalesce(public.pode_rotina('boletos_tarifa_registrar'),false) then
 raise exception 'Sem permissão para registrar tarifa de boleto';end if;
 select * into b from public.boletos where id=_boleto for update;
 if b.id is null or b.centro_id is null or not coalesce(public.usuario_pode_acessar_centro(b.centro_id),false)
 or (public.escopo_representante() and not coalesce(public.documento_na_minha_carteira('boletos',b.id),false)) then
 raise exception 'Boleto não encontrado ou sem acesso à loja/carteira';end if;
 if b.banco is distinct from 'sicredi' or b.canal is distinct from 'api' or b.ambiente is distinct from 'producao'
 or b.status is distinct from 'liquidado' or b.data_liquidacao is null then
 raise exception 'Tarifa vinculada exige boleto API Sicredi liquidado em produção';end if;
 if _confirmado is distinct from true then raise exception 'Confira o extrato e os lançamentos anteriores antes de registrar';end if;
 if _valor is null or _valor<=0 or _valor::text in('NaN','Infinity','-Infinity') or _valor<>round(_valor,2)
 or _data is null or _data>hoje
 or length(coalesce(btrim(_referencia),'')) not between 3 and 160 then
 raise exception 'Informe tarifa positiva com até2 decimais, data do débito até hoje e referência do extrato';end if;
 select * into anterior from public.sicredi_tarifas_279 where boleto_id=b.id;
 if anterior.boleto_id is not null then
   if exists(select 1 from public.movimentos_financeiros m where m.id=anterior.movimento_id and m.status='estornado') then
     raise exception 'Tarifa anterior estornada. Concilie o histórico financeiro antes de novo lançamento';end if;
   if row(anterior.valor,anterior.data_cobranca,anterior.categoria_id,anterior.referencia)
     is not distinct from row(_valor,_data,_categoria,btrim(_referencia)) then return anterior;end if;
   raise exception 'Este boleto já possui tarifa registrada. Confira o movimento financeiro';
 end if;
 select * into cr from public.contas_receber where id=b.conta_receber_id for share;
 if cr.id is null or cr.centro_id is distinct from b.centro_id or cr.status is distinct from 'pago'
 or cr.conta_financeira_id is null then raise exception 'Confira o título pago e a conta financeira do recebimento';end if;
 select centro_id into conta_centro from public.contas_financeiras where id=cr.conta_financeira_id and ativo for share;
 if not found or (conta_centro is not null and conta_centro is distinct from b.centro_id) then
 raise exception 'Conta do recebimento inativa ou pertencente a outra loja';end if;
 if not exists(select 1 from public.categorias_financeiras where id=_categoria and tipo='despesa' and ativo) then
 raise exception 'Selecione categoria ativa de despesa para a tarifa';end if;
 select * into movimento from public.lancar_movimento(cr.conta_financeira_id,'saida',_valor,_data,_categoria,b.centro_id,
 'Tarifa de cobrança Sicredi — nosso número '||coalesce(b.nosso_numero,''),btrim(_referencia));
 insert into public.sicredi_tarifas_279(boleto_id,movimento_id,centro_id,conta_id,categoria_id,valor,data_cobranca,referencia,created_by)
 values(b.id,movimento.id,b.centro_id,cr.conta_financeira_id,_categoria,_valor,_data,btrim(_referencia),auth.uid()) returning * into anterior;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('boletos',b.id,'tarifa_cobranca_279',auth.uid(),
 jsonb_build_object('movimento_id',movimento.id,'valor',_valor,'data',_data,'referencia',btrim(_referencia),'origem','extrato_conferido'));
 return anterior;
end $$;
revoke all on function public.registrar_tarifa_sicredi_279(uuid,numeric,date,uuid,text,boolean) from public,anon;
grant execute on function public.registrar_tarifa_sicredi_279(uuid,numeric,date,uuid,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
