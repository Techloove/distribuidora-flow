-- Forecast Fiscal como única integração ativa. Aplicação manual após a fase262.
-- Arquiva estruturas legadas sem apagar documentos, tokens, auditoria ou migrações.
begin;
do $$begin
 if to_regprocedure('public.estado_conexao_forecast_262(uuid)') is null then
  raise exception 'Aplique a fase262 antes da fase263';
 end if;
end $$;

-- Desativar job/configuração mesmo se a fase260 tiver sido instalada anteriormente.
do $$declare j bigint;begin
 if to_regclass('public.faznotas_auto_config_260') is not null then
  update public.faznotas_auto_config_260 set ativo=false where id;
 end if;
 if to_regclass('cron.job') is not null then
  for j in select jobid from cron.job where jobname='faznotas-consulta-automatica-260' loop
   perform cron.unschedule(j);
  end loop;
 end if;
end $$;
update public.faznotas_liberacao_259 set liberado=false where liberado;

-- Bloquear funções antigas inclusive para o proprietário ou chamadas aninhadas.
-- Não usar DROP CASCADE: triggers de preservação fiscal continuam em vigor.
do $$declare f record;begin
 for f in
  select p.proname,pg_get_function_arguments(p.oid) args,pg_get_function_result(p.oid) resultado
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname=any(array[
   'salvar_conexao_faznotas_257','liberar_faznotas_259',
   'reservar_nfe_259','assumir_nfe_259','registrar_etapa_nfe_259',
   'abortar_preparacao_nfe_259','salvar_tributacao_produto_258',
   'faznotas_auto_reservar_260','faznotas_auto_disparar_260'
  ])
 loop
  execute format('create or replace function public.%I(%s) returns %s language plpgsql security definer set search_path=public as $retirada$ begin raise exception ''Integração fiscal anterior removida. Utilize a Forecast Fiscal nas configurações da loja''; end $retirada$',f.proname,f.args,f.resultado);
 end loop;
end $$;

-- Remover acessos às APIs e tabelas legadas. Dados ficam arquivados no banco.
do $$declare f record;t text;begin
 for f in
  select p.oid::regprocedure assinatura from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname=any(array[
   'estado_conexao_faznotas_257','salvar_conexao_faznotas_257',
   'estado_liberacao_nfe_259','liberar_faznotas_259','contexto_nfe_259',
   'reservar_nfe_259','assumir_nfe_259','registrar_etapa_nfe_259',
   'status_nfe_259','abortar_preparacao_nfe_259',
   'salvar_tributacao_produto_258','listar_tributacao_produto_258',
   'faznotas_auto_reservar_260','faznotas_auto_disparar_260'
  ])
 loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.assinatura);
 end loop;
 foreach t in array array['faznotas_credenciais_257','faznotas_liberacao_259','faznotas_emissoes_259','faznotas_eventos_259','faznotas_auto_config_260','loja_produto_fiscal_258'] loop
  if to_regclass('public.'||t) is not null then
   execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
  end if;
 end loop;
end $$;

-- Rótulo neutro; não concede ou remove permissões dos perfis existentes.
update public.permissoes set nome='Emitir e acompanhar NF-e via Forecast Fiscal'
 where codigo='faturamento_emitir_nfe';

-- Estado atual do provedor sem a indicação obsoleta de documentação pendente.
create or replace function public.estado_provedor_fiscal_261(_loja uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare cnpj261 text;c public.loja_provedor_fiscal_261;begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('configuracao_rotinas_editar') or not public.usuario_pode_acessar_centro(_loja) then raise exception 'Sem acesso à configuração fiscal desta loja';end if;
 select upper(regexp_replace(coalesce(cnpj,''),'[^a-zA-Z0-9]','','g')) into cnpj261 from public.centros where id=_loja and ativo;
 if cnpj261 is null then raise exception 'Loja inválida ou inativa';end if;
 select * into c from public.loja_provedor_fiscal_261 where centro_id=_loja;
 return jsonb_build_object('provedor',coalesce(c.provedor,'forecastfiscal'),'cnpj_loja',cnpj261,'cnpj_vinculado',c.cnpj,'vinculo_atual',c.cnpj=cnpj261,'estado','conexao_disponivel_emissao_bloqueada','emissao_disponivel',false,'updated_at',c.updated_at);
end $$;
revoke all on function public.estado_provedor_fiscal_261(uuid) from public,anon;
grant execute on function public.estado_provedor_fiscal_261(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
