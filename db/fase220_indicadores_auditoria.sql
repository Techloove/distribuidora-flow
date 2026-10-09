-- Fase220: comparativo por centro agregado no banco e auditoria ampliada sem segredos.
begin;
insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values('indicadores_comparar','Consultar comparativo de períodos e centros','Relatórios',129,'/relatorios') on conflict do nothing;
create or replace function public.comparativo_centros_220(_inicio date,_fim date)
returns table(centro_id uuid,centro text,periodo text,pedidos bigint,vendas numeric,contribuicao numeric,resultado_estimado numeric)
language plpgsql stable security invoker set search_path=public as $$
declare dias int;
begin
 if not public.pode_rotina('indicadores_comparar') or not public.can_manage(auth.uid()) then raise exception 'Comparativo restrito à gestão'; end if;
 if _inicio is null or _fim is null or _fim<_inicio or _fim-_inicio>366 then raise exception 'Selecione intervalo de até 367 dias'; end if;
 dias:=_fim-_inicio+1;
 return query
 select p.centro_id,c.nome,case when p.data_pedido>=_inicio then 'atual'::text else 'anterior'::text end,
 count(*),sum(p.total_liquido),sum(m.resultado),sum(m.resultado-p.tributos_estimados-p.despesas_variaveis)
 from public.pedidos p join public.centros c on c.id=p.centro_id join public.vw_margem_pedido_209 m on m.pedido_id=p.id
 where p.data_pedido>=_inicio-dias and p.data_pedido<=_fim and p.status in ('confirmado','separacao','separado','conferido','faturado','em_carga','em_rota','entregue','parcial','nao_entregue','devolvido')
 group by p.centro_id,c.nome,case when p.data_pedido>=_inicio then 'atual'::text else 'anterior'::text end;
end $$;
revoke all on function public.comparativo_centros_220(date,date) from public,anon;
grant execute on function public.comparativo_centros_220(date,date) to authenticated;
-- Lista explícita de tabelas de negócio. Campos secretos e grandes payloads não entram.
do $$ declare t text; campos text; begin
 foreach t in array array['pedidos','pedido_itens','produtos','clientes','pessoas','compras','compra_itens','contas_receber','contas_pagar','devolucoes','devolucao_itens','cargas','expedicoes','comissoes','regras_comissao','comissao_faixas','depositos','inventarios','profiles'] loop
  if to_regclass('public.'||t) is not null then
   select string_agg(quote_literal(attname),',' order by attnum) into campos from pg_attribute
   where attrelid=to_regclass('public.'||t) and attnum>0 and not attisdropped
   and attname !~* '(senha|password|token|secret|api|certificado|private|chave|qrcode|created_at|updated_at)';
   execute format('drop trigger if exists auditar_campos_209 on public.%I',t);
   execute format('create trigger auditar_campos_209 after insert or update or delete on public.%I for each row execute function public.auditar_campos_209(%s)',t,campos);
  end if;
 end loop;
end $$;
-- Acessos autenticados são auditados pelo servidor, uma vez por sessão (sem JWT).
create table if not exists public.acessos_sessoes (
 user_id uuid not null references public.profiles(id),sessao uuid not null,created_at timestamptz not null default now(),primary key(user_id,sessao)
);
alter table public.acessos_sessoes enable row level security;
revoke all on public.acessos_sessoes from public,anon,authenticated;
grant select on public.acessos_sessoes to authenticated;
drop policy if exists acessos_gestao_220 on public.acessos_sessoes;
create policy acessos_gestao_220 on public.acessos_sessoes for select to authenticated using(public.usuario_ativo() and public.can_manage(auth.uid()));
create or replace function public.registrar_acesso_220(_sessao uuid)
returns void language plpgsql security definer set search_path=public as $$
declare n int;
begin
 if not public.usuario_ativo() or _sessao is null or _sessao::text is distinct from (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id') then raise exception 'Sessão inválida'; end if;
 insert into public.acessos_sessoes(user_id,sessao) values(auth.uid(),_sessao) on conflict do nothing;
 get diagnostics n=row_count;
 if n=1 then insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('profiles',auth.uid(),'acesso_sessao',auth.uid(),jsonb_build_object('sessao',_sessao)); end if;
end $$;
revoke all on function public.registrar_acesso_220(uuid) from public,anon;
grant execute on function public.registrar_acesso_220(uuid) to authenticated;
-- Diagnóstico de integridade consultivo; não corrige dados automaticamente.
insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values('integridade_ver','Consultar diagnóstico de integridade','Configurações',130,'/configuracoes') on conflict do nothing;
create or replace function public.diagnostico_integridade_220()
returns table(verificacao text,pendencias bigint)
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.pode_rotina('integridade_ver') or not public.can_manage(auth.uid()) then raise exception 'Diagnóstico restrito à gestão'; end if;
 return query
 select 'Saldos negativos'::text,count(*) from public.estoque_saldos s where public.usuario_pode_acessar_centro(s.centro_id) and s.quantidade<0
 union all
 select 'Reservas acima do estoque'::text,count(*) from public.estoque_saldos s where public.usuario_pode_acessar_centro(s.centro_id) and s.quantidade<coalesce((select sum(r.quantidade) from public.estoque_reservas r where r.produto_id=s.produto_id and r.centro_id=s.centro_id),0)
 union all
 select 'Saldo do centro diferente dos depósitos'::text,count(*) from public.estoque_saldos s where public.usuario_pode_acessar_centro(s.centro_id) and s.quantidade<>coalesce((select sum(ds.quantidade) from public.deposito_saldos ds join public.depositos d on d.id=ds.deposito_id where d.centro_id=s.centro_id and ds.produto_id=s.produto_id),0)
 union all
 select 'Contagens abertas'::text,count(*) from public.inventarios i join public.depositos d on d.id=i.deposito_id where i.status='contagem' and public.usuario_pode_acessar_centro(d.centro_id)
 union all
 select 'Recusas aguardando retorno conferido'::text,count(distinct d.id) from public.devolucoes d join public.entrega_itens t on t.devolucao_id=d.id where d.status is distinct from 'confirmada' and public.usuario_pode_acessar_centro(d.centro_id) and (not public.escopo_representante() or public.documento_na_minha_carteira('devolucoes',d.id));
end $$;
revoke all on function public.diagnostico_integridade_220() from public,anon;
grant execute on function public.diagnostico_integridade_220() to authenticated;
notify pgrst,'reload schema';
commit;
