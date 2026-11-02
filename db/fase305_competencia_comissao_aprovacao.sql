begin;
-- Guarda separadamente a aprovação de cada ciclo, sem alterar a data comercial.
create table if not exists public.pedido_comissao_aprovacoes_305(
 pedido_id uuid not null references public.pedidos(id),ciclo integer not null,
 aprovada_em timestamptz not null,origem text not null check(origem in('historico','automatica_legada','aprovacao')),
 primary key(pedido_id,ciclo)
);
alter table public.pedido_comissao_aprovacoes_305 enable row level security;
revoke all on public.pedido_comissao_aprovacoes_305 from public,anon,authenticated;
grant select on public.pedido_comissao_aprovacoes_305 to authenticated;
grant all on public.pedido_comissao_aprovacoes_305 to service_role;
drop policy if exists leitura_aprovacao_305 on public.pedido_comissao_aprovacoes_305;
create policy leitura_aprovacao_305 on public.pedido_comissao_aprovacoes_305 for select to authenticated using(public.usuario_ativo() and exists(select 1 from public.pedidos p where p.id=pedido_id and public.usuario_pode_acessar_centro(p.centro_id) and (not public.escopo_representante() or public.documento_na_minha_carteira('pedidos',p.id))));
-- Recupera a aprovação real do ciclo atual; nunca usa updated_at como aprovação.
insert into public.pedido_comissao_aprovacoes_305(pedido_id,ciclo,aprovada_em,origem)
select p.id,coalesce(p.ciclo_reabertura_289,0),coalesce(h.em,case when p.aprovacao_automatica_em>=coalesce(reabertura.em,'-infinity'::timestamptz) then p.aprovacao_automatica_em end),case when h.em is not null then 'historico' else 'automatica_legada' end
from public.pedidos p
left join lateral(select max(created_at) em from public.pedido_status_historico where pedido_id=p.id and status_novo in('rascunho','digitacao')) reabertura on true
left join lateral(select min(created_at) em from public.pedido_status_historico where pedido_id=p.id and public.status_comissao_valido_302('pedido',status_novo) and not public.status_comissao_valido_302('pedido',status_anterior) and created_at>=coalesce(reabertura.em,'-infinity'::timestamptz)) h on true
where p.tipo_documento='pedido' and p.status not in('rascunho','digitacao','aguardando_aprovacao') and coalesce(h.em,case when p.aprovacao_automatica_em>=coalesce(reabertura.em,'-infinity'::timestamptz) then p.aprovacao_automatica_em end) is not null
on conflict do nothing;
create or replace function public.registrar_aprovacao_comissao_305() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if not public.status_comissao_valido_302(new.tipo_documento,new.status) then return new;end if;
 if tg_op='UPDATE' and public.status_comissao_valido_302(old.tipo_documento,old.status) and old.ciclo_reabertura_289 is not distinct from new.ciclo_reabertura_289 then return new;end if;
 insert into public.pedido_comissao_aprovacoes_305 values(new.id,coalesce(new.ciclo_reabertura_289,0),clock_timestamp(),'aprovacao') on conflict do nothing;
 return new;
end $$;
revoke all on function public.registrar_aprovacao_comissao_305() from public,anon,authenticated;
drop trigger if exists registrar_aprovacao_comissao_305 on public.pedidos;
create trigger registrar_aprovacao_comissao_305 after insert or update of status,tipo_documento,ciclo_reabertura_289 on public.pedidos for each row execute function public.registrar_aprovacao_comissao_305();
create or replace function public.data_comissao_305(_pedido uuid) returns date
language sql stable security invoker set search_path=public as $$
 select coalesce((a.aprovada_em at time zone 'America/Sao_Paulo')::date,p.data_pedido) from public.pedidos p left join public.pedido_comissao_aprovacoes_305 a on a.pedido_id=p.id and a.ciclo=coalesce(p.ciclo_reabertura_289,0) where p.id=_pedido;
$$;
revoke all on function public.data_comissao_305(uuid) from public,anon;
grant execute on function public.data_comissao_305(uuid) to authenticated;
-- Compatibilidade: conserva data_pedido e acrescenta a data de competência.
do $$declare n text;d text;r record;begin
 foreach n in array array['vw_comissoes_detalhe','vw_comissoes_detalhe_mod_300'] loop
  select pg_get_viewdef(('public.'||n)::regclass,true) into d;
  if position('data_competencia' in d)=0 then
   d:=replace(d,'p.data_pedido','public.data_comissao_305(p.id)');
   d:=replace(d,'public.data_comissao_305(p.id),','p.data_pedido,');
   execute format('create or replace view public.%I with(security_invoker=true) as select origem.*,public.data_comissao_305(origem.pedido_id) as data_competencia from (%s) origem',n,rtrim(d,'; '||chr(10)));
  end if;
 end loop;
 foreach n in array array['vw_comissoes_resumo','vw_comissoes_resumo_mod_300'] loop
  select pg_get_viewdef(('public.'||n)::regclass,true) into d;
  d:=replace(d,'pedidos.data_pedido','public.data_comissao_305(pedidos.id)');
  execute format('create or replace view public.%I with(security_invoker=true) as %s',n,d);
 end loop;
 foreach n in array array['resumo_comissoes_loja_295','resumo_comissoes_loja_295_mod_300'] loop
  select prosrc,pg_get_functiondef(oid) def into r from pg_proc where pronamespace='public'::regnamespace and proname=n;
  d:=replace(r.prosrc,'extract(year from data_pedido)','extract(year from public.data_comissao_305(pedidos.id))');
  d:=replace(d,'extract(month from data_pedido)','extract(month from public.data_comissao_305(pedidos.id))');
  execute replace(r.def,r.prosrc,d);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
