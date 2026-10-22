-- Troca de provedor: preparação local, sem credenciais/endpoints remotos presumidos.
begin;
do $$begin
 if to_regprocedure('public.assumir_nfe_259(uuid,uuid,boolean)') is null then raise exception 'Aplique a fase259 antes da fase261';end if;
end $$;
create table if not exists public.loja_provedor_fiscal_261 (
 centro_id uuid primary key references public.centros(id),
 provedor text not null default 'forecastfiscal' check(provedor in ('forecastfiscal','suspenso')),
 cnpj text not null check(cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
 updated_at timestamptz not null default now(),updated_by uuid not null references public.profiles(id)
);
alter table public.loja_provedor_fiscal_261 enable row level security;
revoke all on public.loja_provedor_fiscal_261 from public,anon,authenticated;
grant all on public.loja_provedor_fiscal_261 to service_role;
create or replace function public.estado_provedor_fiscal_261(_loja uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare cnpj261 text;c public.loja_provedor_fiscal_261;begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('configuracao_rotinas_editar') or not public.usuario_pode_acessar_centro(_loja) then raise exception 'Sem acesso à configuração fiscal desta loja';end if;
 select upper(regexp_replace(coalesce(cnpj,''),'[^a-zA-Z0-9]','','g')) into cnpj261 from public.centros where id=_loja and ativo;
 if cnpj261 is null then raise exception 'Loja inválida ou inativa';end if;
 select * into c from public.loja_provedor_fiscal_261 where centro_id=_loja;
 return jsonb_build_object('provedor',coalesce(c.provedor,'forecastfiscal'),'cnpj_loja',cnpj261,'cnpj_vinculado',c.cnpj,'vinculo_atual',c.cnpj=cnpj261,'estado','aguardando_documentacao','emissao_disponivel',false,'updated_at',c.updated_at);
end $$;
revoke all on function public.estado_provedor_fiscal_261(uuid) from public,anon;
grant execute on function public.estado_provedor_fiscal_261(uuid) to authenticated;
create or replace function public.salvar_provedor_fiscal_261(_loja uuid,_provedor text) returns void
language plpgsql security definer set search_path=public as $$declare e jsonb;cnpj261 text;begin
 perform 1 from public.centros where id=_loja for update;
 e:=public.estado_provedor_fiscal_261(_loja);
 if not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador define o provedor fiscal';end if;
 if _provedor is null or _provedor not in ('forecastfiscal','suspenso') then raise exception 'Provedor inválido';end if;
 cnpj261:=e->>'cnpj_loja';
 if cnpj261 !~ '^[A-Z0-9]{12}[0-9]{2}$' then raise exception 'Complete o CNPJ da loja antes de vincular o provedor';end if;
 insert into public.loja_provedor_fiscal_261(centro_id,provedor,cnpj,updated_by) values(_loja,_provedor,cnpj261,auth.uid())
 on conflict(centro_id) do update set provedor=excluded.provedor,cnpj=excluded.cnpj,updated_at=now(),updated_by=auth.uid();
 insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id) values('centros',_loja,'provedor_fiscal_preparado',jsonb_build_object('provedor',_provedor,'cnpj',cnpj261,'emissao_liberada',false),auth.uid());
end $$;
revoke all on function public.salvar_provedor_fiscal_261(uuid,text) from public,anon;
grant execute on function public.salvar_provedor_fiscal_261(uuid,text) to authenticated;
-- Não altera notas já registradas nem transfere protocolos entre fornecedores.
create or replace function public.bloquear_nova_emissao_faznotas_261() returns trigger
language plpgsql set search_path=public as $$begin
 raise exception 'Novas emissões FAZNOTAS desativadas. Forecast Fiscal aguarda implantação e homologação';
end $$;
drop trigger if exists bloquear_reserva_faznotas_261 on public.faznotas_emissoes_259;
create trigger bloquear_reserva_faznotas_261 before insert on public.faznotas_emissoes_259 for each row execute function public.bloquear_nova_emissao_faznotas_261();
drop trigger if exists bloquear_envio_faznotas_261 on public.faznotas_emissoes_259;
create trigger bloquear_envio_faznotas_261 before update of estado on public.faznotas_emissoes_259 for each row when(new.estado='enviando' and new.recibo is null) execute function public.bloquear_nova_emissao_faznotas_261();
update public.faznotas_liberacao_259 set liberado=false where liberado;
drop trigger if exists bloquear_liberacao_faznotas_261 on public.faznotas_liberacao_259;
create trigger bloquear_liberacao_faznotas_261 before insert or update on public.faznotas_liberacao_259 for each row when(new.liberado) execute function public.bloquear_nova_emissao_faznotas_261();
do $$begin
 if to_regclass('public.faznotas_auto_config_260') is not null then
  update public.faznotas_auto_config_260 set ativo=false where id;
 end if;
end $$;
-- Preserva a escolha por loja na limpeza administrativa que mantém configurações.
do $$declare d text;begin
 if to_regprocedure('public.admin_limpar_dados_interno_f130(text)') is not null then
  select pg_get_functiondef('public.admin_limpar_dados_interno_f130(text)'::regprocedure) into d;
  if position('loja_provedor_fiscal_261' in d)=0 then
   if position('''sicredi_config''' in d)=0 then raise exception 'Revise a preservação do provedor fiscal na limpeza';end if;
   execute replace(d,'''sicredi_config''','''sicredi_config'',''loja_provedor_fiscal_261''');
  end if;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
