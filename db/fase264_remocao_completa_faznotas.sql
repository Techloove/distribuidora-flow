-- Remoção definitiva da integração FAZNOTAS, nunca utilizada pelo cliente.
-- Executar manualmente após a fase262. A fase263 é opcional.
-- Remove tabelas/credenciais/regras específicas, funções, triggers, cron e colunas.
-- Preserva notas_saida, pedidos, produtos, auditoria e toda a configuração Forecast.
begin;
do $$begin
 if to_regprocedure('public.estado_conexao_forecast_262(uuid)') is null then
  raise exception 'Aplique a fase262 antes da fase264';
 end if;
end $$;

lock table public.notas_saida,public.pedidos,public.pedido_itens in access exclusive mode;

do $$declare j bigint;begin
 if to_regclass('cron.job') is not null then
  for j in select jobid from cron.job where jobname='faznotas-consulta-automatica-260' loop
   perform cron.unschedule(j);
  end loop;
 end if;
end $$;

drop trigger if exists proteger_nota_faznotas_259 on public.notas_saida;
drop trigger if exists proteger_pedido_nfe_259 on public.pedidos;
drop trigger if exists proteger_item_nfe_259 on public.pedido_itens;
do $$begin
 if to_regclass('public.faznotas_emissoes_259') is not null then
  drop trigger if exists bloquear_reserva_faznotas_261 on public.faznotas_emissoes_259;
  drop trigger if exists bloquear_envio_faznotas_261 on public.faznotas_emissoes_259;
 end if;
 if to_regclass('public.faznotas_liberacao_259') is not null then
  drop trigger if exists bloquear_liberacao_faznotas_261 on public.faznotas_liberacao_259;
 end if;
end $$;

-- Lista fechada: não apagar funções de fiscalização geral ou de outros módulos.
-- RESTRICT (padrão), sem CASCADE: uma dependência desconhecida aborta a transação.
do $$declare lista text;begin
 select string_agg(p.oid::regprocedure::text,', ' order by p.proname) into lista
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname=any(array[
  'estado_conexao_faznotas_257','salvar_conexao_faznotas_257',
  'snapshot_produto_fiscal_258','snapshot_loja_fiscal_258','validar_tributos_258',
  'salvar_tributacao_produto_258','listar_tributacao_produto_258',
  'snapshot_liberacao_nfe_259','estado_liberacao_nfe_259','liberar_faznotas_259',
  'validar_ator_nfe_259','dados_nfe_259','contexto_nfe_259','reservar_nfe_259',
  'assumir_nfe_259','registrar_etapa_nfe_259','status_nfe_259',
  'abortar_preparacao_nfe_259','proteger_nota_faznotas_259','proteger_pedido_nfe_259',
  'faznotas_auto_reservar_260','faznotas_auto_disparar_260',
  'bloquear_nova_emissao_faznotas_261'
 ]);
 if lista is not null then execute 'drop function '||lista;end if;
end $$;

drop table if exists public.faznotas_eventos_259,public.faznotas_emissoes_259,
 public.faznotas_liberacao_259,public.faznotas_credenciais_257,
 public.faznotas_auto_config_260,public.loja_produto_fiscal_258;

alter table public.notas_saida
 drop column if exists faznotas_estado,
 drop column if exists faznotas_recibo,
 drop column if exists faznotas_request_id;

-- Retirar referências a tabelas removidas da lista preservada pela limpeza admin.
do $$declare d text;t text;begin
 if to_regprocedure('public.admin_limpar_dados_interno_f130(text)') is not null then
  select pg_get_functiondef('public.admin_limpar_dados_interno_f130(text)'::regprocedure) into d;
  foreach t in array array['faznotas_credenciais_257','faznotas_liberacao_259','faznotas_emissoes_259','faznotas_eventos_259','faznotas_auto_config_260','loja_produto_fiscal_258'] loop
   d:=replace(d,','||quote_literal(t),'');
   d:=replace(d,quote_literal(t)||',','');
  end loop;
  execute d;
 end if;
end $$;

update public.permissoes set nome='Emitir e acompanhar NF-e via Forecast Fiscal'
 where codigo='faturamento_emitir_nfe';

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
