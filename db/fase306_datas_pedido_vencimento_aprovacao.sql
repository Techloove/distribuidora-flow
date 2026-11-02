begin;
create table if not exists public.pedido_datas_originais_306(pedido_id uuid primary key references public.pedidos(id),data_original date not null,origem text not null);
alter table public.pedido_datas_originais_306 enable row level security;
revoke all on public.pedido_datas_originais_306 from public,anon,authenticated;
grant select on public.pedido_datas_originais_306 to authenticated;
grant all on public.pedido_datas_originais_306 to service_role;
drop policy if exists leitura_datas_306 on public.pedido_datas_originais_306;
create policy leitura_datas_306 on public.pedido_datas_originais_306 for select to authenticated using(public.usuario_ativo() and exists(select 1 from public.pedidos p where p.id=pedido_id and public.usuario_pode_acessar_centro(p.centro_id) and (not public.escopo_representante() or public.documento_na_minha_carteira('pedidos',p.id))));
insert into public.pedido_datas_originais_306
select p.id,coalesce(a.data_original,p.data_pedido),coalesce(a.origem,'cadastro_legado')
from public.pedidos p left join lateral(
 select c.data_original,c.origem from (
  select (detalhe#>>'{depois,data_pedido}')::date data_original,'auditoria'::text origem,0 prioridade,created_at,id
  from public.auditoria where tabela='pedidos' and registro_id=p.id and acao='insert_campos' and p.orcamento_data is null and detalhe#>>'{depois,data_pedido}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  union all
  select (detalhe#>>'{depois,data_pedido}')::date,'conversao',0,created_at,id
  from public.auditoria where tabela='pedidos' and registro_id=p.id and acao='update_campos' and detalhe#>>'{antes,tipo_documento}'='orcamento' and detalhe#>>'{depois,tipo_documento}'='pedido' and detalhe#>>'{depois,data_pedido}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  union all
  select (detalhe->>'data_anterior')::date,'retomada',1,created_at,id
  from public.auditoria where tabela='pedidos' and registro_id=p.id and acao='data_retomada_302' and detalhe->>'data_anterior' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 ) c order by c.prioridade,c.created_at,c.id limit 1
) a on true where p.tipo_documento='pedido' and p.data_pedido is not null on conflict do nothing;

create or replace function public.registrar_data_original_306() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if new.tipo_documento='pedido' and new.data_pedido is not null then insert into public.pedido_datas_originais_306 values(new.id,new.data_pedido,case when tg_op='INSERT' then 'criacao' else 'conversao' end) on conflict do nothing;end if;return new;
end $$;
revoke all on function public.registrar_data_original_306() from public,anon,authenticated;
drop trigger if exists registrar_data_original_306 on public.pedidos;
create trigger registrar_data_original_306 after insert or update of tipo_documento on public.pedidos for each row execute function public.registrar_data_original_306();
create or replace function public.datas_pedido_306(_pedido uuid) returns jsonb
language sql stable security invoker set search_path=public as $$
select jsonb_build_object('data_original',coalesce(o.data_original,p.data_pedido),'data_comercial',p.data_pedido,'data_aprovacao',(a.aprovada_em at time zone 'America/Sao_Paulo')::date,'data_base_previa',coalesce((a.aprovada_em at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date)) from public.pedidos p left join public.pedido_datas_originais_306 o on o.pedido_id=p.id left join public.pedido_comissao_aprovacoes_305 a on a.pedido_id=p.id and a.ciclo=coalesce(p.ciclo_reabertura_289,0) where p.id=_pedido and p.tipo_documento='pedido';
$$;
revoke all on function public.datas_pedido_306(uuid) from public,anon;
grant execute on function public.datas_pedido_306(uuid) to authenticated;
-- A confirmação automática passa pela aprovação e pelos recebíveis na mesma
-- transação. A data é fixada antes da primeira parcela, inclusive à meia-noite.
create or replace function public.fixar_aprovacao_confirmacao_306(_pedido uuid) returns void
language plpgsql security definer set search_path=public as $$declare p public.pedidos;begin
 select * into p from public.pedidos where id=_pedido for update;
 if p.id is null or p.tipo_documento<>'pedido' or p.status not in('rascunho','digitacao','aprovado') then raise exception 'Pedido inválido para fixar aprovação da confirmação';end if;
 insert into public.pedido_comissao_aprovacoes_305 values(p.id,coalesce(p.ciclo_reabertura_289,0),clock_timestamp(),'aprovacao') on conflict do nothing;
end $$;
revoke all on function public.fixar_aprovacao_confirmacao_306(uuid) from public,anon,authenticated,service_role;
do $$declare d text;alterado text;begin
 select pg_get_functiondef('public.vencimento_pedido_227(uuid,integer)'::regprocedure) into d;
 if position('data_aprovacao_306' in d)=0 then
  if position('return p.data_pedido+(primeiro+(_parcela-1)*intervalo);' in d)=0 then raise exception 'Motor de prazos incompatível com a fase306';end if;
  d:=replace(d,'intervalo integer:=30;','intervalo integer:=30; data_aprovacao_306 date;');
  d:=replace(d,'return p.data_pedido+(primeiro+(_parcela-1)*intervalo);',E'select (aprovada_em at time zone ''America/Sao_Paulo'')::date into data_aprovacao_306 from public.pedido_comissao_aprovacoes_305 where pedido_id=p.id and ciclo=coalesce(p.ciclo_reabertura_289,0);\n if data_aprovacao_306 is null then raise exception ''Pedido sem data de aprovação para gerar parcelas'';end if;\n return data_aprovacao_306+(primeiro+(_parcela-1)*intervalo);');execute d;
 end if;
 select pg_get_functiondef('public.confirmar_pedido(uuid)'::regprocedure) into d;
 if position('datas_confirmacao_306' in d)=0 then
  if position('valor_total := coalesce(ped.total_liquido,0);' in d)=0 then raise exception 'Confirmação incompatível com a fase306';end if;
  if not exists(select 1 from pg_trigger t where t.tgrelid='public.pedidos'::regclass and t.tgfoid='public.trg_apurar_comissao_pedido()'::regprocedure and t.tgenabled<>'D') then raise exception 'Apuração após aprovação não está instalada';end if;
  d:=replace(d,'valor_total := coalesce(ped.total_liquido,0);', E'valor_total := coalesce(ped.total_liquido,0);\n -- datas_confirmacao_306\n perform public.fixar_aprovacao_confirmacao_306(ped.id);');
  -- A comissão é criada pelo trigger somente após a transição para confirmado.
  -- O bloco legado tentava criá-la enquanto o pedido ainda era rascunho.
  alterado:=regexp_replace(d,'if ped.representante_id is not null and ped.comissao_valor > 0 and not exists\(select 1 from public.comissoes where pedido_id=ped.id\) then[\s\S]*?end if;', '-- Comissão apurada após atualizar o status para confirmado (fase302/306).');
  if alterado=d then raise exception 'Bloco legado de comissão não localizado';end if;execute alterado;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
