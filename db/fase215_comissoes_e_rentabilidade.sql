-- Fase215: comissão por produto, faixas determinísticas e faturamento comercial sem NF.
begin;
alter table public.produtos add column if not exists comissao_fixa_unidade numeric(14,4) check(comissao_fixa_unidade>=0);
alter table public.comissao_faixas add column if not exists progressiva boolean not null default false;
alter table public.pedidos add column if not exists faturado_em timestamptz;
alter table public.pedidos add column if not exists tributos_estimados numeric(14,2) not null default 0 check(tributos_estimados>=0);
alter table public.pedidos add column if not exists despesas_variaveis numeric(14,2) not null default 0 check(despesas_variaveis>=0);
-- Serializa alterações do catálogo e impede faixas ativas ambíguas.
create or replace function public.validar_faixa_215()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('catalogo_comissao_215',0));
 if new.valor_min is null or new.valor_min<0 or new.valor_min::text in ('NaN','Infinity','-Infinity') or
 (new.valor_max is not null and (new.valor_max<=new.valor_min or new.valor_max::text in ('NaN','Infinity','-Infinity'))) or
 new.percentual is null or new.percentual<0 or new.percentual>100 or new.percentual::text in ('NaN','Infinity','-Infinity') then
 raise exception 'Faixa inválida: confira limites e percentual entre 0 e 100'; end if;
 if new.ativo and exists(select 1 from public.comissao_faixas f where f.id is distinct from new.id and f.ativo and f.representante_id is not distinct from new.representante_id
 and ((f.periodo,f.base_calculo,f.progressiva) is distinct from (new.periodo,new.base_calculo,new.progressiva)
 or (f.valor_min<coalesce(new.valor_max,'Infinity'::numeric) and new.valor_min<coalesce(f.valor_max,'Infinity'::numeric)))) then
 raise exception 'Faixas ativas incompatíveis ou sobrepostas para este representante'; end if;
 return new;
end $$;
drop trigger if exists validar_faixa_215 on public.comissao_faixas;
create trigger validar_faixa_215 before insert or update on public.comissao_faixas for each row execute function public.validar_faixa_215();
revoke all on function public.validar_faixa_215() from public,anon,authenticated;

create or replace function public.marcar_faturamento_215()
returns trigger language plpgsql set search_path=public as $$
begin
 if new.status='faturado' and old.status is distinct from new.status then new.faturado_em:=coalesce(old.faturado_em,now()); end if;
 return new;
end $$;
drop trigger if exists faturamento_comercial_215 on public.pedidos;
create trigger faturamento_comercial_215 before update of status on public.pedidos for each row execute function public.marcar_faturamento_215();

create or replace function public.percentual_faixa_215(_pedido uuid)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare p public.pedidos; f record; r record; rep uuid; periodos int; base numeric; atual numeric; ini date; fim date; acumulado numeric; valor numeric:=0; anterior numeric:=0;
begin
 select * into p from public.pedidos where id=_pedido;
 if p.representante_id is null then return null; end if;
 rep:=case when exists(select 1 from public.comissao_faixas where ativo and representante_id=p.representante_id) then p.representante_id else null end;
 select count(distinct (periodo,base_calculo,progressiva)) into periodos from public.comissao_faixas where ativo and representante_id is not distinct from rep;
 if periodos=0 then return null; end if;
 if periodos>1 then raise exception 'Use uma única apuração, base e modalidade nas faixas ativas de cada representante'; end if;
 select * into f from public.comissao_faixas where ativo and representante_id is not distinct from rep order by valor_min limit 1;
 atual:=case f.base_calculo when 'bruto' then p.total_itens when 'liquido' then p.total_liquido else greatest(p.total_itens-p.desconto_valor,0) end;
 ini:=case when f.periodo='semanal' then date_trunc('week',p.data_pedido)::date else date_trunc('month',p.data_pedido)::date end;
 fim:=case when f.periodo='semanal' then ini+7 else (ini+interval '1 month')::date end;
 if f.periodo='pedido' then anterior:=0;
 elsif f.periodo='recebimento' then
  select coalesce(sum(m.valor),0) into anterior from public.movimentos_financeiros m join public.contas_receber t on t.id=m.conta_receber_id join public.pedidos q on q.id=t.pedido_id
  where q.representante_id=p.representante_id and q.id<>p.id and m.tipo='entrada' and m.status='ativo' and m.data>=ini and m.data<fim;
 else
  select coalesce(sum(case f.base_calculo when 'bruto' then q.total_itens when 'liquido' then q.total_liquido else greatest(q.total_itens-q.desconto_valor,0) end),0) into anterior from public.pedidos q
  where q.representante_id=p.representante_id and q.id<>p.id and q.status not in ('rascunho','digitacao','aguardando_aprovacao','aprovado','cancelado','recusado')
  and (case when f.periodo='faturamento' then (q.faturado_em at time zone 'America/Sao_Paulo')::date else q.data_pedido end)>=ini
  and (case when f.periodo='faturamento' then (q.faturado_em at time zone 'America/Sao_Paulo')::date else q.data_pedido end)<fim;
 end if;
 base:=anterior+coalesce(atual,0);
 if not f.progressiva then
  select percentual into valor from public.comissao_faixas where ativo and representante_id is not distinct from rep and base>=valor_min and (valor_max is null or base<=valor_max) order by valor_min desc limit 1;
  return valor;
 end if;
 if atual<=0 then return 0; end if;
 for r in select * from public.comissao_faixas where ativo and representante_id is not distinct from rep order by valor_min loop
  valor:=valor+greatest(least(base,coalesce(r.valor_max,base))-greatest(anterior,r.valor_min),0)*r.percentual/100;
 end loop;
 return round(valor/atual*100,4);
end $$;

create or replace function public.calcular_comissao_itens_215(_pedido uuid)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare p public.pedidos; i record; regra numeric; faixa numeric; total numeric:=0; base numeric; pct numeric;
begin
 select * into p from public.pedidos where id=_pedido;
 if p.representante_id is null then return 0; end if;
 faixa:=public.percentual_faixa_215(p.id);
 for i in select it.*,pr.comissao_fixa_unidade,pr.comissao_percentual as pct_produto from public.pedido_itens it join public.produtos pr on pr.id=it.produto_id where it.pedido_id=p.id loop
  if i.comissao_fixa_unidade is not null then total:=total+i.quantidade*i.comissao_fixa_unidade;
  else
   select r.percentual into regra from public.regras_comissao r join public.clientes c on c.id=p.cliente_id where r.ativo
   and (r.representante_id is null or r.representante_id=p.representante_id) and (r.cliente_id is null or r.cliente_id=p.cliente_id)
   and (r.produto_id is null or r.produto_id=i.produto_id) and (r.uf is null or r.uf=c.uf)
   and (r.vigencia_inicio is null or r.vigencia_inicio<=p.data_pedido) and (r.vigencia_fim is null or r.vigencia_fim>=p.data_pedido)
   order by r.prioridade desc,(r.produto_id is not null) desc,(r.cliente_id is not null) desc,(r.representante_id is not null) desc,r.created_at desc limit 1;
   pct:=coalesce(nullif(i.pct_produto,0),regra,faixa,(select comissao_percentual from public.representantes where id=p.representante_id),0);
   base:=case when p.total_itens>0 then i.total*greatest(p.total_itens-p.desconto_valor,0)/p.total_itens else 0 end;
   total:=total+base*pct/100;
  end if;
 end loop;
 return round(total,2);
end $$;
-- Preserva guardas atuais e troca apenas o cálculo da comissão do pedido.
do $$ declare d text; begin
 select pg_get_functiondef('public.recalcular_pedido(uuid)'::regprocedure) into d;
 if position('calcular_comissao_itens_215' in d)=0 then
  -- O percentual provisório preserva a comissão anterior até calcular itens com totais atualizados.
  -- Não consulta o antigo resolver por notas fiscais durante o recálculo.
  d:=replace(d,'pct := public.resolver_comissao(ped.representante_id, ped.cliente_id, ped.data_pedido, null, base);','pct := coalesce(ped.comissao_percentual,0);');
  d:=replace(d,'perform public.apurar_comissao_pedido(_pedido_id);','update public.pedidos set comissao_valor=public.calcular_comissao_itens_215(_pedido_id), comissao_percentual=case when base>0 then least(999.99,round(public.calcular_comissao_itens_215(_pedido_id)/base*100,2)) else 0 end where id=_pedido_id; perform public.apurar_comissao_pedido(_pedido_id);');
  if position('calcular_comissao_itens_215' in d)=0 then raise exception 'Recalcular pedido incompatível; comissão não foi alterada'; end if;
  execute d;
 end if;
end $$;
-- Não reescreve comissões históricas. Novos pedidos/cálculos passam a usar as regras.
create or replace function public.margem_inadequada_215(_pedido uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.pedidos p join lateral (
  select sum(i.quantidade*coalesce(i.custo_unitario_base,nullif(pr.custo_medio,0),nullif(pr.preco_custo,0),nullif(pr.ultimo_custo,0),0)) custo,
  bool_or(coalesce(i.custo_unitario_base,nullif(pr.custo_medio,0),nullif(pr.preco_custo,0),nullif(pr.ultimo_custo,0),0)<=0) sem_custo
  from public.pedido_itens i join public.produtos pr on pr.id=i.produto_id where i.pedido_id=p.id
 ) x on true where p.id=_pedido and (
  coalesce(x.sem_custo,true) or p.total_liquido<=0 or
  (p.total_liquido-coalesce(x.custo,0)-p.comissao_valor-p.custo_frete-p.tributos_estimados-p.despesas_variaveis)/nullif(p.total_liquido,0)*100<coalesce((select nullif(valor,'')::numeric from public.parametros where chave='margem_liquida_minima'),0)
 ));
$$;
revoke all on function public.margem_inadequada_215(uuid) from public,anon,authenticated;
-- Validação não depende da permissão de visualizar margem; custos continuam privados.
do $bloco$
declare d text; antigo text := $trecho$if exists(select 1 from public.vw_margem_pedido_209 m where m.pedido_id=_pedido_id and (m.sem_custo>0 or m.margem<coalesce((select nullif(valor,'')::numeric from public.parametros where chave='margem_liquida_minima'),0))) then$trecho$;
begin
 select pg_get_functiondef('public.validar_pedido(uuid)'::regprocedure) into d;
 if position('margem_inadequada_215' in d)=0 then
  if position(antigo in d)=0 then raise exception 'Validação de margem incompatível com fase215'; end if;
  d:=replace(d,antigo,'if public.margem_inadequada_215(_pedido_id) then');execute d;
 end if;
end $bloco$;

insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values('rentabilidade_editar','Informar tributos estimados e despesas variáveis','Pedidos',124,'/pedidos') on conflict do nothing;
create or replace function public.definir_rentabilidade_215(_pedido uuid,_tributos numeric,_despesas numeric)
returns void language plpgsql security definer set search_path=public as $$
declare p public.pedidos;
begin
 select * into p from public.pedidos where id=_pedido for update;
 if not public.pode_rotina('rentabilidade_editar') or not public.can_manage(auth.uid()) or not public.usuario_pode_acessar_centro(p.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',p.id)) then raise exception 'Sem acesso à rentabilidade'; end if;
 if p.status not in ('rascunho','digitacao','aguardando_aprovacao','aprovado') or _tributos is null or _despesas is null or _tributos<0 or _despesas<0 or _tributos::text in ('NaN','Infinity','-Infinity') or _despesas::text in ('NaN','Infinity','-Infinity') then raise exception 'Valores inválidos ou pedido já confirmado'; end if;
 update public.pedidos set tributos_estimados=_tributos,despesas_variaveis=_despesas where id=p.id;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',p.id,'rentabilidade',auth.uid(),jsonb_build_object('antes',jsonb_build_object('tributos',p.tributos_estimados,'despesas',p.despesas_variaveis),'depois',jsonb_build_object('tributos',_tributos,'despesas',_despesas)));
end $$;
create or replace view public.vw_resultado_estimado_215 with(security_invoker=on) as
select m.*,p.tributos_estimados,p.despesas_variaveis,m.resultado-p.tributos_estimados-p.despesas_variaveis resultado_estimado from public.vw_margem_pedido_209 m join public.pedidos p on p.id=m.pedido_id;
grant select on public.vw_resultado_estimado_215 to authenticated;
revoke all on function public.marcar_faturamento_215(),public.percentual_faixa_215(uuid),public.calcular_comissao_itens_215(uuid) from public,anon,authenticated;
revoke all on function public.definir_rentabilidade_215(uuid,numeric,numeric) from public,anon;
grant execute on function public.definir_rentabilidade_215(uuid,numeric,numeric) to authenticated;
notify pgrst,'reload schema';
commit;
