-- Fase 209: rotinas comerciais, margem, entregas e conciliação.
-- Aplicar depois da fase208. Reaplicável; não altera configuração Sicredi.
begin;

insert into public.parametros(chave,valor,descricao) values
 ('margem_liquida_minima','0','Margem de contribuição mínima sobre receita; abaixo exige aprovação'),
 ('comissao_fato_gerador','venda','Liberação da comissão: venda ou recebimento integral')
on conflict(chave) do nothing;
alter table public.pedidos add column if not exists custo_frete numeric(14,2) not null default 0 check(custo_frete>=0);
alter table public.pedido_itens add column if not exists custo_unitario_base numeric(14,4);
alter table public.devolucao_itens add column if not exists condicao text not null default 'revenda' check(condicao in ('revenda','avaria'));
alter table public.devolucoes add column if not exists finalidade text not null default 'credito' check(finalidade in ('credito','troca'));
alter table public.devolucoes add column if not exists pedido_troca_id uuid references public.pedidos(id);
alter table public.cargas add column if not exists capacidade_kg numeric(14,3) check(capacidade_kg>0);

-- Leituras SECURITY INVOKER herdam as políticas atuais de centro e carteira.
create or replace view public.vw_margem_pedido_209 with(security_invoker=on) as
with custos as (
 select i.pedido_id, sum(i.quantidade * coalesce(i.custo_unitario_base,
   nullif(pr.custo_medio,0),nullif(pr.preco_custo,0),nullif(pr.ultimo_custo,0),0)) custo,
   count(*) filter(where coalesce(i.custo_unitario_base,nullif(pr.custo_medio,0),nullif(pr.preco_custo,0),nullif(pr.ultimo_custo,0),0)<=0) sem_custo
 from public.pedido_itens i join public.produtos pr on pr.id=i.produto_id group by i.pedido_id
)
select p.id pedido_id,p.numero,p.centro_id,p.cliente_id,p.representante_id,p.status,
 p.total_liquido receita,coalesce(c.custo,0) custo,
 coalesce(p.comissao_valor,0) comissao,
 p.custo_frete,coalesce(c.sem_custo,0) sem_custo,
 round(p.total_liquido-coalesce(c.custo,0)-p.custo_frete-
   coalesce(p.comissao_valor,0),2) resultado,
 case when p.total_liquido>0 then round((p.total_liquido-coalesce(c.custo,0)-p.custo_frete-
   coalesce(p.comissao_valor,0))/p.total_liquido*100,2) else null end margem
from public.pedidos p left join custos c on c.pedido_id=p.id;
grant select on public.vw_margem_pedido_209 to authenticated;

create or replace function public.definir_custo_frete_pedido(_pedido_id uuid,_valor numeric)
returns void language plpgsql security definer set search_path=public as $$
declare p public.pedidos;
begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) then raise exception 'Apenas gestão pode informar o custo do frete'; end if;
 select * into p from public.pedidos where id=_pedido_id for update;
 if p.id is null or not public.usuario_pode_acessar_centro(p.centro_id) or
   (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',p.id)) then raise exception 'Pedido sem acesso'; end if;
 if p.status not in ('rascunho','digitacao','aguardando_aprovacao','aprovado') then raise exception 'Custo só pode ser alterado antes da confirmação'; end if;
 if _valor is null or _valor<0 or _valor::text in ('NaN','Infinity','-Infinity') then raise exception 'Custo inválido'; end if;
 update public.pedidos set custo_frete=_valor where id=p.id;
end $$;

-- Conserva o corpo e as guardas das fases anteriores; acrescenta a contribuição real.
do $$ declare d text; begin
 select pg_get_functiondef('public.validar_pedido(uuid)'::regprocedure) into d;
 if position('-- margem_209' in d)=0 then
  d := regexp_replace(d,'\mBEGIN\M',E'BEGIN\n -- margem_209\n if not public.usuario_ativo() or not exists(select 1 from public.pedidos where id=_pedido_id and public.usuario_pode_acessar_centro(centro_id)) or (public.escopo_representante() and not public.documento_na_minha_carteira(''pedidos'',_pedido_id)) then raise exception ''Pedido sem acesso''; end if;','i');
  if position('return res;' in lower(d))=0 then raise exception 'validar_pedido incompatível'; end if;
  -- Somente o RETURN final; não modifica o retorno do pedido inexistente.
  d := regexp_replace(d,'return res;(\s*end\s*(?:;\s*)?\$[a-zA-Z0-9_]*\$)',E'if exists(select 1 from public.vw_margem_pedido_209 m where m.pedido_id=_pedido_id and (m.sem_custo>0 or m.margem<coalesce((select nullif(valor,'''')::numeric from public.parametros where chave=''margem_liquida_minima''),0))) then\n res := res || jsonb_build_object(''nivel'',''bloqueio'',''mensagem'',''Margem de contribuição abaixo do mínimo ou produto sem custo: requer aprovação'');\n end if;\n return res;\\1','i');
  if position('Margem de contribuição' in d)=0 then raise exception 'Não foi possível acrescentar validação da margem'; end if;
  execute d;
 end if;
end $$;

-- Devoluções usam _id; a guarda genérica da fase206 não cobria esse argumento.
do $$ declare d text; assinatura regprocedure; begin
 foreach assinatura in array array['public.confirmar_devolucao(uuid)'::regprocedure,'public.cancelar_devolucao(uuid)'::regprocedure] loop
  select pg_get_functiondef(assinatura) into d;
  if position('-- carteira_devolucao_209' in d)=0 then
   d:=regexp_replace(d,'\mBEGIN\M',E'BEGIN\n -- carteira_devolucao_209\n if not public.usuario_ativo() or (public.escopo_representante() and not public.documento_na_minha_carteira(''devolucoes'',_id)) then raise exception ''Devolução sem acesso à carteira''; end if;','i');
   execute d;
  end if;
 end loop;
end $$;

-- A confirmação conserva estoque/crédito/idempotência e exige aprovação no servidor.
-- Corrige a regressão da fase80 que restringia o status a rascunho.
do $$ declare d text; begin
 select pg_get_functiondef('public.confirmar_pedido(uuid)'::regprocedure) into d;
 if position('-- confirmacao_209' in d)=0 then
  d := replace(d,'if ped.status <> ''rascunho'' then','if ped.status not in (''rascunho'',''digitacao'',''aprovado'') then');
  d := replace(d,'if ped.representante_id is not null and ped.comissao_valor > 0 then',
    'if ped.representante_id is not null and ped.comissao_valor > 0 and not exists(select 1 from public.comissoes where pedido_id=ped.id) then');
  d := regexp_replace(d,'perform public.recalcular_pedido\(_pedido_id\);',E'perform public.recalcular_pedido(_pedido_id);\n -- confirmacao_209\n if ped.status<>''aprovado'' and exists(select 1 from jsonb_array_elements(public.validar_pedido(_pedido_id)) v where v->>''nivel''=''bloqueio'') then raise exception ''Pedido requer aprovação da gestão antes de confirmar''; end if;','i');
  if position('-- confirmacao_209' in d)=0 then raise exception 'confirmar_pedido incompatível com a validação'; end if;
  execute d;
 end if;
end $$;

create or replace function public.capturar_custo_pedido_209()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='confirmado' and old.status is distinct from new.status then
  update public.pedido_itens i set custo_unitario_base=coalesce(nullif(pr.custo_medio,0),nullif(pr.preco_custo,0),nullif(pr.ultimo_custo,0),0)
  from public.produtos pr where i.produto_id=pr.id and i.pedido_id=new.id and i.custo_unitario_base is null;
 end if;
 return new;
end $$;
drop trigger if exists custo_pedido_209 on public.pedidos;
-- AFTER evita modificar o pedido dentro do BEFORE quando o item recalcula seu pai.
create trigger custo_pedido_209 after update of status on public.pedidos for each row execute function public.capturar_custo_pedido_209();
-- Metadado de custo não altera preço/quantidade: evita recalcular o pedido por item.
do $$ declare d text; begin
 select pg_get_functiondef('public.pedido_itens_after()'::regprocedure) into d;
 if position('-- custo_item_209' in d)=0 then
  d:=regexp_replace(d,'\mBEGIN\M',E'BEGIN\n -- custo_item_209\n if tg_op=''UPDATE'' and old.custo_unitario_base is distinct from new.custo_unitario_base and (to_jsonb(new)-''custo_unitario_base''-''updated_at'')=(to_jsonb(old)-''custo_unitario_base''-''updated_at'') then return null; end if;','i');
  execute d;
 end if;
end $$;
revoke all on function public.pedido_itens_after() from public,anon,authenticated;

create or replace view public.vw_reposicao_209 with(security_invoker=on) as
select b.*,
 round(b.venda_90/90,3) consumo_diario,
 case when b.venda_90>0 then round(greatest(b.estoque_atual-b.pedidos_pendentes,0)/(b.venda_90/90),1) else null end cobertura_dias,
 greatest(coalesce(b.estoque_minimo,0),ceil(b.venda_90/90*greatest(coalesce(b.prazo_fornecedor_dias,0),0))) ponto_reposicao,
 greatest(ceil(greatest(coalesce(b.estoque_minimo,0),b.venda_90/90*(greatest(coalesce(b.prazo_fornecedor_dias,0),0)+30))+
   b.pedidos_pendentes-b.estoque_atual-b.em_transito),0) compra_recomendada,
 case when b.venda_90=0 and b.estoque_atual>0 then 'parado'
 when b.estoque_atual-b.pedidos_pendentes <= greatest(coalesce(b.estoque_minimo,0),b.venda_90/90*greatest(coalesce(b.prazo_fornecedor_dias,0),0)) then 'repor'
 else 'normal' end situacao
from public.vw_sugestao_compras_centro b;
grant select on public.vw_reposicao_209 to authenticated;

-- Agenda e cobrança: uma cobrança aberta por cliente evita trabalho duplicado.
create table if not exists public.acompanhamentos (
 id uuid primary key default gen_random_uuid(), cliente_id uuid not null references public.clientes(id),
 centro_id uuid references public.centros(id),tipo text not null check(tipo in ('comercial','cobranca')),
 responsavel uuid not null default auth.uid(),responsavel_nome text not null default '',status text not null default 'aberto' check(status in ('aberto','concluido')),
 proxima_acao date not null, promessa_data date, promessa_valor numeric(14,2) check(promessa_valor>0),
 resultado text not null,observacao text,created_at timestamptz not null default now(),concluido_em timestamptz
);
alter table public.acompanhamentos add column if not exists responsavel_nome text not null default '';
create unique index if not exists cobranca_cliente_aberta_209 on public.acompanhamentos(cliente_id) where tipo='cobranca' and status='aberto';
create index if not exists acompanhamentos_agenda_209 on public.acompanhamentos(tipo,status,proxima_acao);
create index if not exists acompanhamentos_cliente_209 on public.acompanhamentos(cliente_id,tipo,status,proxima_acao);
alter table public.acompanhamentos enable row level security;
revoke all on public.acompanhamentos from public,anon,authenticated;
grant select on public.acompanhamentos to authenticated;
drop policy if exists acompanhamentos_leitura_209 on public.acompanhamentos;
create policy acompanhamentos_leitura_209 on public.acompanhamentos for select to authenticated using (
 public.usuario_ativo() and (centro_id is null or public.usuario_pode_acessar_centro(centro_id))
 and (not public.escopo_representante() or public.cliente_na_minha_carteira(cliente_id))
 and ((tipo='cobranca' and public.can_finance(auth.uid())) or (tipo='comercial' and (public.can_manage(auth.uid()) or public.has_role(auth.uid(),'comercial') or public.has_role(auth.uid(),'representante'))))
);
create or replace function public.registrar_acompanhamento(_cliente_id uuid,_centro_id uuid,_tipo text,_proxima_acao date,_resultado text,_observacao text default null,_promessa_data date default null,_promessa_valor numeric default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 if not public.usuario_ativo() or (_tipo='cobranca' and not public.can_finance(auth.uid())) or
  (_tipo='comercial' and not (public.can_manage(auth.uid()) or public.has_role(auth.uid(),'comercial') or public.has_role(auth.uid(),'representante'))) or _tipo not in ('comercial','cobranca') then raise exception 'Sem permissão para acompanhamento'; end if;
 if _centro_id is not null and not public.usuario_pode_acessar_centro(_centro_id) then raise exception 'Centro sem acesso'; end if;
 if not exists(select 1 from public.clientes c where c.id=_cliente_id and (c.centro_id is null or public.usuario_pode_acessar_centro(c.centro_id))) or
 (public.escopo_representante() and not public.cliente_na_minha_carteira(_cliente_id)) then raise exception 'Cliente sem acesso'; end if;
 if _proxima_acao is null or nullif(trim(_resultado),'') is null or length(_resultado)>100 or length(coalesce(_observacao,''))>4000 then raise exception 'Informe data, resultado e observação de até 4000 caracteres'; end if;
 if _promessa_valor is not null and (_tipo<>'cobranca' or _promessa_valor<=0 or _promessa_data is null or _promessa_valor::text in ('NaN','Infinity','-Infinity')) then raise exception 'Promessa de pagamento inválida'; end if;
 insert into public.acompanhamentos(cliente_id,centro_id,tipo,proxima_acao,resultado,observacao,promessa_data,promessa_valor,responsavel_nome)
 values(_cliente_id,_centro_id,_tipo,_proxima_acao,trim(_resultado),nullif(trim(_observacao),''),_promessa_data,_promessa_valor,coalesce((select nome from public.profiles where id=auth.uid()),'')) returning id into v_id;
 return v_id;
exception when unique_violation then raise exception 'Este cliente já tem cobrança aberta. Consulte o responsável e o histórico antes de abrir outra.';
end $$;
create or replace function public.concluir_acompanhamento(_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare a public.acompanhamentos;
begin
 select * into a from public.acompanhamentos where id=_id for update;
 if not public.usuario_ativo() or a.id is null or (a.responsavel<>auth.uid() and not public.can_manage(auth.uid())) or
 (a.centro_id is not null and not public.usuario_pode_acessar_centro(a.centro_id)) or
 (public.escopo_representante() and not public.cliente_na_minha_carteira(a.cliente_id)) then raise exception 'Acompanhamento sem acesso ou de outro responsável'; end if;
 if a.tipo='cobranca' and not public.can_finance(auth.uid()) then raise exception 'Sem acesso financeiro'; end if;
 update public.acompanhamentos set status='concluido',concluido_em=now() where id=_id;
end $$;
create or replace view public.vw_carteira_comercial_209 with(security_invoker=on) as
select c.id cliente_id,c.razao_social,c.representante_id,c.centro_id,c.rota_id,
 max(p.data_pedido) ultima_compra,
 coalesce(sum(p.total_liquido) filter(where p.data_pedido >= (now() at time zone 'America/Sao_Paulo')::date-30),0) vendas_30,
 coalesce(sum(p.total_liquido) filter(where p.data_pedido >= (now() at time zone 'America/Sao_Paulo')::date-60 and p.data_pedido<(now() at time zone 'America/Sao_Paulo')::date-30),0) vendas_anteriores_30
from public.clientes c left join public.pedidos p on p.cliente_id=c.id and p.status in ('confirmado','faturado','entregue','parcial','devolvido') group by c.id;
grant select on public.vw_carteira_comercial_209 to authenticated;
create or replace view public.vw_cobranca_clientes_209 with(security_invoker=on) as
select c.id cliente_id,c.razao_social,t.centro_id,
 sum(greatest(t.valor-coalesce(t.valor_pago,0),0)) aberto,
 sum(case when public.vencimento_util(t.vencimento)<(now() at time zone 'America/Sao_Paulo')::date then greatest(t.valor-coalesce(t.valor_pago,0),0) else 0 end) vencido
from public.contas_receber t join public.clientes c on c.id=t.cliente_id
where t.status in ('aberto','parcial') group by c.id,t.centro_id
having sum(greatest(t.valor-coalesce(t.valor_pago,0),0))>0;
grant select on public.vw_cobranca_clientes_209 to authenticated;
revoke all on public.vw_margem_pedido_209,public.vw_reposicao_209,public.vw_carteira_comercial_209,public.vw_cobranca_clientes_209 from public,anon;

-- Evidência textual e referência do comprovante; não necessita armazenamento público.
create table if not exists public.entrega_registros (
 id uuid primary key default gen_random_uuid(),expedicao_id uuid not null references public.expedicoes(id),
 pedido_id uuid not null references public.pedidos(id),centro_id uuid references public.centros(id),
 tipo text not null check(tipo in ('entrega','ocorrencia')),recebedor text,comprovante text,observacao text,
 created_by uuid not null default auth.uid(),created_at timestamptz not null default now()
);
create unique index if not exists entrega_unica_209 on public.entrega_registros(expedicao_id) where tipo='entrega';
create index if not exists entrega_historico_209 on public.entrega_registros(expedicao_id,created_at desc);
alter table public.entrega_registros enable row level security;
revoke all on public.entrega_registros from public,anon,authenticated;
grant select on public.entrega_registros to authenticated;
drop policy if exists entrega_leitura_209 on public.entrega_registros;
create policy entrega_leitura_209 on public.entrega_registros for select to authenticated using(public.usuario_ativo() and public.can_ship(auth.uid()) and public.usuario_pode_acessar_centro(centro_id) and (not public.escopo_representante() or public.documento_na_minha_carteira('pedidos',pedido_id)));
create or replace function public.exigir_comprovante_entrega_209()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='entregue' and old.status is distinct from new.status and not exists(select 1 from public.entrega_registros where expedicao_id=new.id and tipo='entrega') then raise exception 'Registre recebedor e comprovante em Expedição antes de concluir a entrega ou a carga'; end if;
 return new;
end $$;
drop trigger if exists comprovante_entrega_209 on public.expedicoes;
create trigger comprovante_entrega_209 before update of status on public.expedicoes for each row execute function public.exigir_comprovante_entrega_209();
create or replace function public.registrar_entrega(_expedicao_id uuid,_tipo text,_recebedor text default null,_comprovante text default null,_observacao text default null)
returns void language plpgsql security definer set search_path=public as $$
declare e public.expedicoes;
begin
 if not public.usuario_ativo() or not public.can_ship(auth.uid()) then raise exception 'Sem acesso à entrega'; end if;
 select * into e from public.expedicoes where id=_expedicao_id for update;
 if e.id is null or not public.usuario_pode_acessar_centro(e.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',e.pedido_id)) then raise exception 'Expedição sem acesso'; end if;
 if _tipo not in ('entrega','ocorrencia') or _tipo is null or length(coalesce(_observacao,''))>4000 or length(coalesce(_comprovante,''))>1000 then raise exception 'Registro inválido'; end if;
 if _tipo='entrega' then
  if e.status='entregue' and exists(select 1 from public.entrega_registros where expedicao_id=e.id and tipo='entrega') then return; end if;
  if e.status<>'em_rota' or nullif(trim(_recebedor),'') is null or nullif(trim(_comprovante),'') is null then raise exception 'Entrega em rota requer recebedor e referência do comprovante'; end if;
 elsif e.status='cancelada' or nullif(trim(_observacao),'') is null then raise exception 'Informe a ocorrência de uma expedição ativa'; end if;
 insert into public.entrega_registros(expedicao_id,pedido_id,centro_id,tipo,recebedor,comprovante,observacao)
 values(e.id,e.pedido_id,e.centro_id,_tipo,nullif(trim(_recebedor),''),nullif(trim(_comprovante),''),nullif(trim(_observacao),''));
 if _tipo='entrega' then perform public.avancar_expedicao(e.id,'entregue',(now() at time zone 'America/Sao_Paulo')::date); end if;
end $$;
create or replace function public.definir_capacidade_carga(_carga_id uuid,_capacidade numeric)
returns void language plpgsql security definer set search_path=public as $$
declare c public.cargas;
begin
 if not public.usuario_ativo() or not public.can_ship(auth.uid()) then raise exception 'Sem acesso à carga'; end if;
 select * into c from public.cargas where id=_carga_id for update;
 if c.id is null or not public.usuario_pode_acessar_centro(c.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('cargas',c.id)) then raise exception 'Carga sem acesso'; end if;
 if c.status not in ('aberta','em_preparacao') or _capacidade is null or _capacidade<=0 or _capacidade::text in ('NaN','Infinity','-Infinity') then raise exception 'Informe capacidade válida antes de fechar a carga'; end if;
 update public.cargas set capacidade_kg=_capacidade where id=c.id;
end $$;
create or replace function public.validar_capacidade_carga_209()
returns trigger language plpgsql set search_path=public as $$
begin
 if new.status in ('fechada','em_rota','entregando') and new.capacidade_kg is not null and new.peso_kg>new.capacidade_kg then raise exception 'Peso da carga excede a capacidade do veículo'; end if;
 return new;
end $$;
drop trigger if exists capacidade_carga_209 on public.cargas;
create trigger capacidade_carga_209 before insert or update on public.cargas for each row execute function public.validar_capacidade_carga_209();

-- Retorno avariado mantém crédito, mas não volta ao saldo disponível.
create or replace function public.estoque_devolucao_condicao_209()
returns trigger language plpgsql security definer set search_path=public as $$
declare avaria numeric;
begin
 if new.origem in ('devolucao','devolucao_cancelada') then
  select coalesce(sum(quantidade),0) into avaria from public.devolucao_itens where devolucao_id=new.documento_id and produto_id=new.produto_id and condicao='avaria';
  new.quantidade := greatest(new.quantidade-avaria,0);
  if new.quantidade=0 then return null; end if;
 end if;
 return new;
end $$;
drop trigger if exists aa_condicao_devolucao_209 on public.estoque_movimentos;
create trigger aa_condicao_devolucao_209 before insert on public.estoque_movimentos for each row execute function public.estoque_devolucao_condicao_209();
create or replace function public.proteger_condicao_devolucao_209()
returns trigger language plpgsql security definer set search_path=public as $$
declare d public.devolucoes; v_id uuid;
begin
 v_id:=case when tg_op='DELETE' then old.devolucao_id else new.devolucao_id end;
 select * into d from public.devolucoes where id=v_id for update;
 if d.status<>'rascunho' then raise exception 'Itens de devolução confirmada ou cancelada são imutáveis'; end if;
 if tg_op='UPDATE' and new.devolucao_id<>old.devolucao_id then raise exception 'Não é permitido mover o item entre devoluções'; end if;
 return coalesce(new,old);
end $$;
drop trigger if exists condicao_devolucao_209 on public.devolucao_itens;
create trigger condicao_devolucao_209 before insert or update or delete on public.devolucao_itens for each row execute function public.proteger_condicao_devolucao_209();
create or replace function public.vincular_pedido_troca(_devolucao_id uuid,_pedido_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare d public.devolucoes; p public.pedidos;
begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) then raise exception 'Apenas gestão pode vincular troca'; end if;
 select * into d from public.devolucoes where id=_devolucao_id for update;
 select * into p from public.pedidos where id=_pedido_id;
 if d.id is null or p.id is null or d.status<>'confirmada' or d.cliente_id<>p.cliente_id or d.centro_id is distinct from p.centro_id or p.status in ('cancelado','recusado') or d.pedido_id=p.id or
 not public.usuario_pode_acessar_centro(d.centro_id) or (public.escopo_representante() and (not public.documento_na_minha_carteira('devolucoes',d.id) or not public.documento_na_minha_carteira('pedidos',p.id))) then raise exception 'Troca requer devolução confirmada e novo pedido do mesmo cliente e centro'; end if;
 update public.devolucoes set finalidade='troca',pedido_troca_id=p.id where id=d.id;
end $$;

alter table public.comissoes add column if not exists base_original numeric(14,2);
alter table public.comissoes add column if not exists valor_original numeric(14,2);
-- Recálculo comercial não reabre comissão paga nem apaga descontos de devolução.
create or replace function public.apurar_comissao_pedido(_pedido_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare p public.pedidos; c public.comissoes; base numeric; valor_base numeric; devolvido numeric; corrigida numeric; st text; recebida boolean;
begin
 select * into p from public.pedidos where id=_pedido_id for update;
 if p.id is null then return; end if;
 if auth.uid() is not null and (not public.usuario_ativo() or not public.usuario_pode_acessar_centro(p.centro_id) or
  (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',p.id))) then raise exception 'Pedido sem acesso para apurar comissão'; end if;
 select * into c from public.comissoes where pedido_id=p.id for update;
 if c.status='paga' then return; end if;
 if p.representante_id is null then
  delete from public.comissoes where pedido_id=p.id and status in ('prevista','cancelada'); return;
 end if;
 if p.status in ('rascunho','digitacao','aguardando_aprovacao','aprovado') then
  base:=greatest(coalesce(p.total_itens,0)-coalesce(p.desconto_valor,0),0);
  valor_base:=coalesce(p.comissao_valor,round(base*coalesce(p.comissao_percentual,0)/100,2));
 else
  base:=coalesce(c.base_original,greatest(coalesce(p.total_itens,0)-coalesce(p.desconto_valor,0),0));
  valor_base:=coalesce(c.valor_original,p.comissao_valor,0);
 end if;
 select coalesce(sum(valor_total),0) into devolvido from public.devolucoes where pedido_id=p.id and status='confirmada';
 corrigida:=round(valor_base*case when base>0 then greatest(base-devolvido,0)/base else 0 end,2);
 recebida:=p.total_liquido>0 and
  coalesce((select sum(least(t.valor,coalesce(t.valor_pago,0))) from public.contas_receber t where t.pedido_id=p.id and t.status<>'cancelado'),0)+
  coalesce((select sum(a.valor) from public.creditos_clientes_aplicacoes a where a.pedido_id=p.id and a.status='aplicado'),0)>=p.total_liquido-0.009;
 st:=case when p.status in ('cancelado','recusado') then 'cancelada'
  when p.status in ('faturado','em_rota','entregue','parcial') and
    ((select regra.valor from public.parametros regra where regra.chave='comissao_fato_gerador')='venda' or recebida) then 'liberada'
  when c.status='liberada' then 'liberada' else 'prevista' end;
 if c.id is null then
  insert into public.comissoes(representante_id,pedido_id,base_calculo,percentual,valor,status,centro_id,base_original,valor_original)
  values(p.representante_id,p.id,greatest(base-devolvido,0),coalesce(p.comissao_percentual,0),corrigida,st,p.centro_id,base,valor_base);
 else
  update public.comissoes set representante_id=p.representante_id,base_calculo=greatest(base-devolvido,0),percentual=coalesce(p.comissao_percentual,0),valor=corrigida,
   status=st,centro_id=coalesce(c.centro_id,p.centro_id),base_original=base,valor_original=valor_base where id=c.id;
 end if;
end $$;
revoke all on function public.apurar_comissao_pedido(uuid) from public,anon;
create table if not exists public.comissao_ajustes (
 id uuid primary key default gen_random_uuid(),comissao_id uuid not null references public.comissoes(id),pedido_id uuid not null references public.pedidos(id),
 representante_id uuid not null references public.representantes(id),centro_id uuid references public.centros(id),
 valor numeric(14,2) not null,status text not null default 'pendente' check(status in ('pendente','conferido')),
 resolucao text,created_at timestamptz not null default now(),conferido_por uuid,unique(comissao_id)
);
alter table public.comissao_ajustes enable row level security;
create index if not exists comissao_ajustes_pendentes_209 on public.comissao_ajustes(centro_id,status,created_at desc);
revoke all on public.comissao_ajustes from public,anon,authenticated;
grant select on public.comissao_ajustes to authenticated;
drop policy if exists comissao_ajustes_leitura_209 on public.comissao_ajustes;
create policy comissao_ajustes_leitura_209 on public.comissao_ajustes for select to authenticated using(public.usuario_ativo() and public.usuario_pode_acessar_centro(centro_id) and (public.can_finance(auth.uid()) or representante_id=public.meu_representante_id()) and (not public.escopo_representante() or representante_id=public.meu_representante_id()));
create or replace function public.regra_comissao_209()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.pedidos where id=new.pedido_id and status in ('rascunho','digitacao','aguardando_aprovacao','aprovado')) then
  new.base_original:=new.base_calculo; new.valor_original:=new.valor;
 else
  new.base_original:=coalesce(new.base_original,old.base_original,old.base_calculo);
  new.valor_original:=coalesce(new.valor_original,old.valor_original,old.valor);
 end if;
 if auth.uid() is not null and (not public.usuario_ativo() or (public.escopo_representante() and new.representante_id is distinct from public.meu_representante_id())) then raise exception 'Comissão fora da carteira ou usuário inativo'; end if;
 if new.status in ('liberada','paga') and old.status is distinct from new.status and
 (select regra.valor from public.parametros regra where regra.chave='comissao_fato_gerador')='recebimento' then
  if not exists(select 1 from public.pedidos p where p.id=new.pedido_id and p.total_liquido>0 and
    coalesce((select sum(least(t.valor,coalesce(t.valor_pago,0))) from public.contas_receber t where t.pedido_id=p.id and t.status<>'cancelado'),0)+
    coalesce((select sum(a.valor) from public.creditos_clientes_aplicacoes a where a.pedido_id=p.id and a.status='aplicado'),0)>=p.total_liquido-0.009)
   then raise exception 'Comissão exige recebimento integral do pedido (pagamentos e créditos aplicados)'; end if;
 end if;
 return new;
end $$;
drop trigger if exists regra_comissao_209 on public.comissoes;
create trigger regra_comissao_209 before update on public.comissoes for each row execute function public.regra_comissao_209();
create or replace function public.ajustar_comissao_devolucao_209()
returns trigger language plpgsql security definer set search_path=public as $$
declare c public.comissoes; devolvido numeric; base numeric; valor_corrigido numeric;
begin
 if new.pedido_id is null or new.status is not distinct from old.status then return new; end if;
 -- Serializa devoluções distintas do mesmo pedido antes de apurar o acumulado.
 perform 1 from public.pedidos where id=new.pedido_id for update;
 select * into c from public.comissoes where pedido_id=new.pedido_id for update;
 if c.id is null or c.status='cancelada' then return new; end if;
 select coalesce(sum(valor_total),0) into devolvido from public.devolucoes where pedido_id=new.pedido_id and status='confirmada';
 base:=greatest(coalesce(c.base_original,c.base_calculo)-devolvido,0);
 valor_corrigido:=round(coalesce(c.valor_original,c.valor)*case when coalesce(c.base_original,c.base_calculo)>0 then base/coalesce(c.base_original,c.base_calculo) else 0 end,2);
 if c.status='paga' then
  insert into public.comissao_ajustes(comissao_id,pedido_id,representante_id,centro_id,valor) values(c.id,c.pedido_id,c.representante_id,c.centro_id,c.valor-valor_corrigido)
  on conflict(comissao_id) do update set valor=excluded.valor,status='pendente',resolucao=null,conferido_por=null;
 else
  update public.comissoes set base_calculo=base,valor=valor_corrigido,base_original=coalesce(c.base_original,c.base_calculo),valor_original=coalesce(c.valor_original,c.valor) where id=c.id;
 end if;
 return new;
end $$;
drop trigger if exists comissao_devolucao_209 on public.devolucoes;
create trigger comissao_devolucao_209 after update of status on public.devolucoes for each row execute function public.ajustar_comissao_devolucao_209();
create or replace function public.conferir_ajuste_comissao(_id uuid,_resolucao text)
returns void language plpgsql security definer set search_path=public as $$
declare a public.comissao_ajustes;
begin
 select * into a from public.comissao_ajustes where id=_id for update;
 if not public.usuario_ativo() or not public.can_finance(auth.uid()) or a.id is null or not public.usuario_pode_acessar_centro(a.centro_id) or
 (public.escopo_representante() and a.representante_id is distinct from public.meu_representante_id()) then raise exception 'Ajuste sem acesso'; end if;
 if nullif(trim(_resolucao),'') is null then raise exception 'Informe como o ajuste foi resolvido no financeiro'; end if;
 update public.comissao_ajustes set status='conferido',resolucao=trim(_resolucao),conferido_por=auth.uid() where id=_id;
end $$;

-- Extrato importado não baixa títulos nem cria movimentações automaticamente.
create table if not exists public.extrato_bancario_linhas (
 id uuid primary key default gen_random_uuid(),conta_id uuid not null references public.contas_financeiras(id),
 referencia text not null,data date not null,valor numeric(14,2) not null check(valor<>0),descricao text,
 movimento_id uuid unique references public.movimentos_financeiros(id),created_by uuid not null default auth.uid(),created_at timestamptz not null default now(),
 unique(conta_id,referencia)
);
alter table public.extrato_bancario_linhas enable row level security;
create index if not exists extrato_conta_data_209 on public.extrato_bancario_linhas(conta_id,data desc,referencia);
revoke all on public.extrato_bancario_linhas from public,anon,authenticated;
grant select on public.extrato_bancario_linhas to authenticated;
drop policy if exists extrato_leitura_209 on public.extrato_bancario_linhas;
create policy extrato_leitura_209 on public.extrato_bancario_linhas for select to authenticated using(public.usuario_ativo() and public.can_finance(auth.uid()) and not public.escopo_representante() and public.usuario_pode_acessar_conta_financeira(conta_id));
create or replace function public.importar_extrato_bancario(_conta_id uuid,_linhas jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare r jsonb; n int:=0; inserted int;
begin
 if not public.usuario_ativo() or not public.can_finance(auth.uid()) or public.escopo_representante() or not public.usuario_pode_acessar_conta_financeira(_conta_id) then raise exception 'Conta sem acesso financeiro'; end if;
 perform 1 from public.contas_financeiras where id=_conta_id for update;
 if _linhas is null or jsonb_typeof(_linhas)<>'array' then raise exception 'Importe um array de linhas'; end if;
 if jsonb_array_length(_linhas)>1000 or jsonb_array_length(_linhas)=0 then raise exception 'Importe de 1 a 1000 linhas'; end if;
 for r in select * from jsonb_array_elements(_linhas) loop
  if nullif(trim(r->>'referencia'),'') is null or length(r->>'referencia')>200 or length(coalesce(r->>'descricao',''))>1000 or
   (r->>'valor')::numeric=0 or (r->>'valor')::numeric::text in ('NaN','Infinity','-Infinity') or r->>'data' is null or (r->>'data') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Linha inválida no extrato'; end if;
  if exists(select 1 from public.extrato_bancario_linhas where conta_id=_conta_id and referencia=trim(r->>'referencia') and (data<>(r->>'data')::date or valor<>(r->>'valor')::numeric)) then raise exception 'Referência já importada com data ou valor diferente'; end if;
  insert into public.extrato_bancario_linhas(conta_id,referencia,data,valor,descricao) values(_conta_id,trim(r->>'referencia'),(r->>'data')::date,(r->>'valor')::numeric,r->>'descricao') on conflict(conta_id,referencia) do nothing;
  get diagnostics inserted=row_count; n:=n+inserted;
 end loop;
 return n;
end $$;
create or replace function public.conciliar_extrato(_linha_id uuid,_movimento_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare l public.extrato_bancario_linhas; m public.movimentos_financeiros;
begin
 if not public.usuario_ativo() or not public.can_finance(auth.uid()) or public.escopo_representante() then raise exception 'Sem acesso financeiro'; end if;
 select * into l from public.extrato_bancario_linhas where id=_linha_id for update;
 select * into m from public.movimentos_financeiros where id=_movimento_id for update;
 if l.id is null or m.id is null or l.conta_id<>m.conta_id or not public.usuario_pode_acessar_conta_financeira(l.conta_id) or
 (m.centro_id is not null and not public.usuario_pode_acessar_centro(m.centro_id)) then raise exception 'Movimento sem acesso ou de outra conta'; end if;
 if l.movimento_id=m.id then return; end if;
 if l.movimento_id is not null or m.status<>'ativo' or l.valor<>(case when m.tipo='entrada' then m.valor else -m.valor end) then raise exception 'Conciliação exige linha livre, movimento ativo e valor correspondente'; end if;
 update public.extrato_bancario_linhas set movimento_id=m.id where id=l.id;
end $$;
create or replace function public.desconciliar_extrato(_linha_id uuid,_motivo text)
returns void language plpgsql security definer set search_path=public as $$
declare l public.extrato_bancario_linhas;
begin
 select * into l from public.extrato_bancario_linhas where id=_linha_id for update;
 if not public.usuario_ativo() or not public.can_finance(auth.uid()) or public.escopo_representante() or l.id is null or not public.usuario_pode_acessar_conta_financeira(l.conta_id) then raise exception 'Linha sem acesso'; end if;
 if nullif(trim(_motivo),'') is null then raise exception 'Informe o motivo'; end if;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('extrato_bancario_linhas',l.id,'desconciliar',auth.uid(),jsonb_build_object('movimento_id',l.movimento_id,'motivo',_motivo));
 update public.extrato_bancario_linhas set movimento_id=null where id=l.id;
end $$;
create or replace function public.proteger_movimento_conciliado_209()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if (new.status is distinct from old.status or new.valor is distinct from old.valor or new.tipo is distinct from old.tipo or new.conta_id is distinct from old.conta_id) and exists(select 1 from public.extrato_bancario_linhas where movimento_id=new.id) then raise exception 'Desfaça a conciliação antes de estornar ou alterar o movimento'; end if;
 return new;
end $$;
drop trigger if exists movimento_conciliado_209 on public.movimentos_financeiros;
create trigger movimento_conciliado_209 before update on public.movimentos_financeiros for each row execute function public.proteger_movimento_conciliado_209();

-- Auditoria por lista de campos: nunca grava senhas, tokens ou credenciais bancárias.
create or replace function public.auditar_campos_209()
returns trigger language plpgsql security definer set search_path=public as $$
declare antes jsonb:='{}'; depois jsonb:='{}'; k text; a jsonb; d jsonb; identificador uuid; ator uuid:=auth.uid();
begin
 a:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 d:=case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
 if tg_table_name='sicredi_cnab_config' then
  -- Somente salvamento validado de configuração, não reservas automáticas de sequência.
  if coalesce(auth.role(),'')<>'service_role' or nullif(current_setting('app.audit_actor_209',true),'') is null then return coalesce(new,old); end if;
  ator:=current_setting('app.audit_actor_209',true)::uuid;
 end if;
 if tg_table_name='parametros' and coalesce(d->>'chave',a->>'chave') not in
 ('margem_liquida_minima','comissao_fato_gerador','margem_minima','desconto_maximo','aprovacao_limite_credito','aprovacao_titulos_vencidos','vencimento_fim_semana_feriado','tolerancia_dias_vencidos','exigir_nf_carga','exigir_nf_boleto','alerta_estoque_minimo') then return coalesce(new,old); end if;
 foreach k in array tg_argv loop
  if a->k is distinct from d->k then antes:=antes||jsonb_build_object(k,a->k); depois:=depois||jsonb_build_object(k,d->k); end if;
 end loop;
 if depois<>'{}'::jsonb or antes<>'{}'::jsonb then
  identificador:=nullif(coalesce(d->>'id',a->>'id'),'')::uuid;
  insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values(tg_table_name,identificador,lower(tg_op)||'_campos',ator,jsonb_build_object('antes',antes,'depois',depois,'chave',coalesce(d->>'chave',a->>'chave')));
 end if;
 return coalesce(new,old);
end $$;
create or replace function public.validar_parametro_rotina_209()
returns trigger language plpgsql set search_path=public as $$
begin
 if new.chave='comissao_fato_gerador' and (new.valor is null or new.valor not in ('venda','recebimento')) then raise exception 'Fato gerador deve ser venda ou recebimento'; end if;
 if new.chave='margem_liquida_minima' and (new.valor is null or new.valor::numeric<0 or new.valor::numeric>100 or new.valor::numeric::text in ('NaN','Infinity','-Infinity')) then raise exception 'Margem mínima deve estar entre 0 e 100'; end if;
 return new;
end $$;
drop trigger if exists parametro_rotina_209 on public.parametros;
create trigger parametro_rotina_209 before insert or update on public.parametros for each row execute function public.validar_parametro_rotina_209();
do $$ declare r record; begin
 for r in select * from (values
 ('pedidos','''preco'', ''desconto_valor'', ''forma_desconto_valor'', ''comissao_percentual'', ''frete_valor'', ''custo_frete'', ''status'''),
 ('produtos','''preco_venda'', ''custo_medio'', ''margem_minima'''),
 ('pedido_itens','''preco_unitario'', ''desconto_percentual'', ''quantidade'''),
 ('contas_receber','''vencimento'', ''valor'', ''valor_pago'', ''status'''),
 ('contas_financeiras','''nome'', ''banco_codigo'', ''agencia'', ''conta'', ''centro_id'''),
 ('user_roles','''user_id'', ''role'''),('role_menus','''role'', ''path'''),
 ('parametros','''chave'', ''valor'''),
 ('acompanhamentos','''status'', ''proxima_acao'', ''promessa_data'', ''promessa_valor'', ''responsavel'''),
 ('entrega_registros','''tipo'', ''recebedor'', ''comprovante'', ''observacao'''),
 ('comissao_ajustes','''valor'', ''status'', ''resolucao'', ''conferido_por'''),
 ('extrato_bancario_linhas','''movimento_id'', ''valor'', ''data'''),
 ('devolucoes','''status'', ''finalidade'', ''pedido_troca_id'''),
 ('devolucao_itens','''condicao'', ''quantidade'''),('cargas','''capacidade_kg'', ''peso_kg'', ''status''')
 ) x(tabela,campos) loop
  execute format('drop trigger if exists auditar_campos_209 on public.%I',r.tabela);
  execute format('create trigger auditar_campos_209 after insert or update or delete on public.%I for each row execute function public.auditar_campos_209(%s)',r.tabela,r.campos);
 end loop;
end $$;
do $$ declare d text; begin
 if to_regprocedure('public.cnab_salvar_config(uuid,jsonb)') is not null and to_regclass('public.sicredi_cnab_config') is not null then
  select pg_get_functiondef('public.cnab_salvar_config(uuid,jsonb)'::regprocedure) into d;
  if position('-- audit_config_209' in d)=0 then
   d:=regexp_replace(d,'\mBEGIN\M',E'BEGIN\n -- audit_config_209\n perform set_config(''app.audit_actor_209'',_actor::text,true);','i');
   execute d;
  end if;
  execute 'drop trigger if exists auditar_campos_209 on public.sicredi_cnab_config';
  execute 'create trigger auditar_campos_209 after insert or update or delete on public.sicredi_cnab_config for each row execute function public.auditar_campos_209(''nome'',''documento'',''cooperativa'',''posto'',''beneficiario'',''conta'',''conta_dv'',''homologado'',''proxima_remessa'',''proximo_nosso_numero'',''conta_financeira_id'',''categoria_tarifa_id'')';
 end if;
end $$;
-- Parâmetros com segredo não fazem parte das configurações gerenciais auditáveis.
-- A tabela parametros do ERP contém regras; tokens Sicredi ficam em tabela server-only.

do $$ declare r record; begin
 for r in select p.oid::regprocedure assinatura,p.prorettype from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in (
 'definir_custo_frete_pedido','capturar_custo_pedido_209','registrar_acompanhamento','concluir_acompanhamento','registrar_entrega','exigir_comprovante_entrega_209','definir_capacidade_carga','validar_capacidade_carga_209','proteger_movimento_conciliado_209',
 'estoque_devolucao_condicao_209','proteger_condicao_devolucao_209','validar_parametro_rotina_209','vincular_pedido_troca','regra_comissao_209','ajustar_comissao_devolucao_209','conferir_ajuste_comissao','importar_extrato_bancario','conciliar_extrato','desconciliar_extrato','auditar_campos_209') loop
  execute format('revoke all on function %s from public,anon,authenticated',r.assinatura);
  if r.prorettype<>'trigger'::regtype then execute format('grant execute on function %s to authenticated',r.assinatura); end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
