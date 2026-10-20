-- Parte2: parâmetros comerciais por loja. Execute inteiro após a fase242.
begin;
do $$begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='centros' and column_name='logo_url') then raise exception 'Aplique a fase242 antes da fase243';end if;
end $$;
-- Nome canônico já utilizado pelo validador comercial; conserva o valor operacional existente.
insert into public.parametros(chave,valor,descricao)
 select 'desconto_maximo',coalesce((select valor from public.parametros where chave='desconto_maximo_percentual'),'15'),'Desconto máximo permitido nos itens (%)'
 where not exists(select 1 from public.parametros where chave='desconto_maximo');
create table if not exists public.loja_parametros(
 centro_id uuid not null references public.centros(id) on delete cascade,
 chave text not null references public.parametros(chave),valor text,
 updated_at timestamptz not null default now(),updated_by uuid references public.profiles(id) on delete set null,
 primary key(centro_id,chave)
);
alter table public.loja_parametros enable row level security;
revoke all on public.loja_parametros from public,anon,authenticated;
grant select on public.loja_parametros to authenticated;
grant all on public.loja_parametros to service_role;
drop policy if exists loja_parametros_leitura_243 on public.loja_parametros;
create policy loja_parametros_leitura_243 on public.loja_parametros for select to authenticated using(public.usuario_ativo() and public.usuario_pode_acessar_centro(centro_id));
-- Snapshot independente. Reaplicar não sobrescreve valores alterados em cada loja.
insert into public.loja_parametros(centro_id,chave,valor)
 select c.id,p.chave,p.valor from public.centros c cross join public.parametros p on conflict do nothing;
create or replace function public.iniciar_parametros_loja_243() returns trigger
language plpgsql security definer set search_path=public as $$begin
 insert into public.loja_parametros(centro_id,chave,valor) select new.id,chave,valor from public.parametros on conflict do nothing;return new;
end $$;
revoke all on function public.iniciar_parametros_loja_243() from public,anon,authenticated;
drop trigger if exists iniciar_parametros_loja_243 on public.centros;
create trigger iniciar_parametros_loja_243 after insert on public.centros for each row execute function public.iniciar_parametros_loja_243();

-- Leitura interna tipada, preservando descrições e a estrutura dos parâmetros existentes.
create or replace function public.parametros_da_loja_243(_loja uuid) returns setof public.parametros
language sql stable security definer set search_path=public as $$
 select (jsonb_populate_record(null::public.parametros,to_jsonb(p)||jsonb_build_object('valor',
  case when p.chave='desconto_maximo_percentual' then coalesce(canon.valor,l.valor,p.valor) else coalesce(l.valor,p.valor) end))).*
 from public.parametros p left join public.loja_parametros l on l.centro_id=_loja and l.chave=p.chave
 left join public.loja_parametros canon on canon.centro_id=_loja and canon.chave='desconto_maximo';
$$;
revoke all on function public.parametros_da_loja_243(uuid) from public,anon,authenticated;
create or replace function public.listar_parametros_loja_243(_loja uuid) returns setof public.parametros
language plpgsql stable security definer set search_path=public as $$begin
 if not public.usuario_ativo() or _loja is null or not public.usuario_pode_acessar_centro(_loja) or not exists(select 1 from public.centros where id=_loja) then raise exception 'Loja sem acesso';end if;
 return query select * from public.parametros_da_loja_243(_loja) where chave<>'desconto_maximo_percentual' order by chave;
end $$;
revoke all on function public.listar_parametros_loja_243(uuid) from public,anon;
grant execute on function public.listar_parametros_loja_243(uuid) to authenticated;

create or replace function public.salvar_parametros_loja_243(_loja uuid,_valores jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare r record; v text;n numeric;
begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('configuracao_rotinas_editar') or not public.usuario_pode_acessar_centro(_loja) or not exists(select 1 from public.centros where id=_loja and ativo) then raise exception 'Sem permissão para configurar esta loja';end if;
 if jsonb_typeof(_valores) is distinct from 'object' then raise exception 'Parâmetros inválidos';end if;
 perform 1 from public.centros where id=_loja for update;
 for r in select * from jsonb_each(_valores) loop
  if jsonb_typeof(r.value)<>'string' then raise exception 'Informe valores textuais para os parâmetros';end if;
  v:=btrim(r.value#>>'{}');
  if not exists(select 1 from public.parametros where chave=r.key) or r.key='desconto_maximo_percentual' then raise exception 'Parâmetro não configurável: %',r.key;end if;
  if r.key in ('aprovacao_limite_credito','aprovacao_titulos_vencidos','vencimento_fim_semana_feriado','exigir_nf_carga','exigir_nf_boleto','alerta_estoque_minimo') then
   if v not in ('true','false') then raise exception 'Informe Sim ou Não para %',r.key;end if;
  elsif r.key='comissao_fato_gerador' then
   if v not in ('venda','recebimento') then raise exception 'Regra de liberação da comissão inválida';end if;
  elsif r.key in ('margem_minima','margem_liquida_minima','desconto_maximo','prazo_padrao_dias','tolerancia_dias_vencidos') then
   if v!~'^[0-9]+(\.[0-9]+)?$' or length(v)>12 then raise exception 'Valor numérico inválido para %',r.key;end if;
   n:=v::numeric;
   if (r.key in ('margem_liquida_minima','desconto_maximo') and n>100) or (r.key='margem_minima' and n>1000) or
    (r.key in ('prazo_padrao_dias','tolerancia_dias_vencidos') and (n>3650 or n<>trunc(n))) then raise exception 'Valor fora do intervalo permitido para %',r.key;end if;
  else raise exception 'Este parâmetro requer implantação específica: %',r.key;
  end if;
  insert into public.loja_parametros(centro_id,chave,valor,updated_by) values(_loja,r.key,v,auth.uid())
   on conflict(centro_id,chave) do update set valor=excluded.valor,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 end loop;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('centros',_loja,'configurar_parametros_loja_243',auth.uid(),jsonb_build_object('parametros',_valores));
end $$;
revoke all on function public.salvar_parametros_loja_243(uuid,jsonb) from public,anon;
grant execute on function public.salvar_parametros_loja_243(uuid,jsonb) to authenticated;

-- Reescreve somente as leituras do catálogo nos motores atuais, mantendo OIDs,
-- assinaturas, ACLs e guardas. A loja vem do documento/carga; nunca do navegador ou GUC.
do $$declare f record;s text;escopo text;begin
 for f in select p.oid,p.proname,p.proargnames from pg_proc p where p.pronamespace='public'::regnamespace
  and p.prokind='f' and p.prosrc~*'\mfrom\s+(public\.)?parametros\M'
  and p.proname not in ('parametros_da_loja_243','iniciar_parametros_loja_243','salvar_parametros_loja_243') loop
  escopo:=null;
  if '_pedido_id'=any(f.proargnames) then escopo:='(select centro_id from public.pedidos where id=_pedido_id)';
  elsif '_pedido'=any(f.proargnames) then escopo:='(select centro_id from public.pedidos where id=_pedido)';
  elsif f.proname='regra_comissao_209' then escopo:='(select centro_id from public.pedidos where id=new.pedido_id)';
  elsif '_carga'=any(f.proargnames) then escopo:='(select centro_id from public.cargas where id=_carga)';
  elsif '_carga_id'=any(f.proargnames) then escopo:='(select centro_id from public.cargas where id=_carga_id)';
  end if;
  if escopo is null then raise exception 'Leitura global ainda não mapeada: %. Nenhuma alteração aplicada',f.oid::regprocedure;end if;
  select pg_get_functiondef(f.oid) into s;
  s:=regexp_replace(s,'\mfrom\s+(public\.)?parametros\M','from public.parametros_da_loja_243('||escopo||')','gi');execute s;
 end loop;
end $$;
-- A ação mantém atribuições existentes, passando ao módulo Lojas.
update public.permissoes set modulo='/centros',grupo='Lojas',nome='Configurar regras comerciais da loja' where codigo='configuracao_rotinas_editar';
-- Evita que o editor antigo/API altere silenciosamente a configuração de todas as lojas.
create or replace function public.parametros_globais_legados_243() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if auth.uid() is not null then raise exception 'Configure os parâmetros no cadastro de Lojas';end if;return coalesce(new,old);
end $$;
revoke all on function public.parametros_globais_legados_243() from public,anon,authenticated;
drop trigger if exists parametros_globais_legados_243 on public.parametros;
create trigger parametros_globais_legados_243 before insert or update or delete on public.parametros for each row execute function public.parametros_globais_legados_243();
-- Preserva as regras por loja na rotina administrativa de limpeza existente.
do $$declare d text;begin
 if to_regprocedure('public.admin_limpar_dados_interno_f130(text)') is not null then
  select pg_get_functiondef('public.admin_limpar_dados_interno_f130(text)'::regprocedure) into d;
  if position('loja_parametros' in d)=0 then
   if position('''parametros''' in d)=0 then raise exception 'Rotina de limpeza incompatível: revise a preservação dos parâmetros';end if;
   d:=replace(d,'''parametros''','''parametros'',''loja_parametros''');execute d;
  end if;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
