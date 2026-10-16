-- Correção pontual dos títulos legados dos pedidos3,4 e5.
-- Execute integralmente como proprietário no SQL Editor. Não desative RLS.
-- Aplica os prazos cadastrados; não adia uma dívida legitimamente vencida.
-- Não reconfirma pedidos nem altera valores, estoque ou boletos bancários.
begin;
do $correcao$
declare p public.pedidos; f public.formas_pagamento; numero_alvo integer;
 qtd integer; datas jsonb; definicao text;
begin
 if to_regprocedure('public.vencimento_pedido_227(uuid,integer)') is null then
  raise exception 'Aplique primeiro a fase227';
 end if;
 select pg_get_functiondef('public.confirmar_pedido(uuid)'::regprocedure) into definicao;
 if position('public.vencimento_pedido_227(ped.id,n)' in definicao)=0 then
  raise exception 'Reaplique a fase227: a confirmação instalada ainda não usa os prazos corrigidos';
 end if;
 -- Ordem fixa de locks; toda a correção é atômica.
 foreach numero_alvo in array array[3,4,5] loop
  select count(*) into qtd from public.pedidos where numero=numero_alvo;
  if qtd<>1 then raise exception 'Pedido%: esperado um único registro; encontrados %. Nenhuma correção aplicada',numero_alvo,qtd; end if;
  select * into p from public.pedidos where numero=numero_alvo for update;
  if p.status is null or p.status in ('rascunho','digitacao','aguardando_aprovacao','aprovado','cancelado','recusado') or p.data_pedido is null then
   raise exception 'Pedido% não está confirmado ou está sem data',numero_alvo;
  end if;
  select * into f from public.formas_pagamento where id=p.forma_pagamento_id for share;
  if f.id is null or f.tipo not in ('boleto','prazo','cheque','cartao_credito')
   or p.parcelas is null or p.parcelas<1 or p.parcelas<>f.parcelas_padrao
   or f.dias_primeira_parcela is null or f.dias_primeira_parcela<0 or f.intervalo_dias is null or f.intervalo_dias<0 then
   raise exception 'Pedido%: confira a forma a prazo, os dias e a quantidade de parcelas antes de corrigir',numero_alvo;
  end if;
  perform 1 from public.contas_receber where pedido_id=p.id order by id for update;
  select count(*) into qtd from public.contas_receber where pedido_id=p.id;
  if qtd<>p.parcelas or (select count(distinct parcela) from public.contas_receber where pedido_id=p.id and parcela between 1 and p.parcelas)<>p.parcelas then
   raise exception 'Pedido%: títulos não correspondem às parcelas do pedido. Nenhuma correção aplicada',numero_alvo;
  end if;
  if not exists(select 1 from public.contas_receber t where t.pedido_id=p.id
   and t.vencimento is distinct from public.vencimento_pedido_227(p.id,t.parcela)) then
   raise notice 'Pedido% já segue os prazos cadastrados; nenhuma alteração necessária',numero_alvo;
   continue;
  end if;
  -- Datas negociadas/editadas fora dos padrões conhecido/correto não são sobrescritas.
  if exists(select 1 from public.contas_receber t where t.pedido_id=p.id
   and t.vencimento is distinct from public.vencimento_pedido_227(p.id,t.parcela)
   and t.vencimento is distinct from p.data_pedido+((t.parcela-1)*30)) then
   raise exception 'Pedido%: existem datas que não correspondem ao erro antigo0/30/60. Confira a negociação; nenhuma correção aplicada',numero_alvo;
  end if;
  if exists(select 1 from public.contas_receber t where t.pedido_id=p.id and
   (t.status is distinct from 'aberto' or coalesce(t.valor_pago,0)<>0 or t.acordo_id is not null)) then
   raise exception 'Pedido%: há parcela paga, parcial, cancelada ou renegociada. Nenhuma correção aplicada',numero_alvo;
  end if;
  if exists(select 1 from public.boletos b join public.contas_receber t on t.id=b.conta_receber_id where t.pedido_id=p.id) then
   raise exception 'Pedido%: há boleto vinculado. Altere seu vencimento pelo fluxo bancário para manter o Sicredi sincronizado; nenhuma correção aplicada',numero_alvo;
  end if;
  if exists(select 1 from public.movimentos_financeiros m join public.contas_receber t on t.id=m.conta_receber_id where t.pedido_id=p.id) then
   raise exception 'Pedido%: há movimentação financeira vinculada. Confira as baixas; nenhuma correção aplicada',numero_alvo;
  end if;
  select jsonb_agg(jsonb_build_object('titulo',t.id,'parcela',t.parcela,'antes',t.vencimento,
   'depois',public.vencimento_pedido_227(p.id,t.parcela)) order by t.parcela)
   into datas from public.contas_receber t where t.pedido_id=p.id;
  update public.contas_receber t set vencimento=public.vencimento_pedido_227(p.id,t.parcela)
   where t.pedido_id=p.id and t.vencimento is distinct from public.vencimento_pedido_227(p.id,t.parcela);
  insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe)
   values('pedidos',p.id,'corrigir_vencimentos_legados_345',auth.uid(),
    jsonb_build_object('data_pedido',p.data_pedido,'forma_pagamento',f.nome,'primeira_dias',f.dias_primeira_parcela,'intervalo_dias',f.intervalo_dias,'parcelas',datas));
 end loop;
end $correcao$;
select p.numero pedido,p.data_pedido,f.nome forma_pagamento,f.dias_primeira_parcela,f.intervalo_dias,
 t.parcela,t.valor,t.vencimento,public.vencimento_pedido_227(p.id,t.parcela) vencimento_esperado,
 case when t.vencimento<(now() at time zone 'America/Sao_Paulo')::date then 'Vencido conforme os prazos cadastrados' else 'A vencer ou vence hoje' end situacao_data
from public.pedidos p join public.formas_pagamento f on f.id=p.forma_pagamento_id
 join public.contas_receber t on t.pedido_id=p.id where p.numero in (3,4,5) order by p.numero,t.parcela;
commit;
