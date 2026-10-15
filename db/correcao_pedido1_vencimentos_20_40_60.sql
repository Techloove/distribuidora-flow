-- Correção pontual autorizada: pedido número1, boleto20/40/60.
-- Execute como proprietário no SQL Editor após a fase227. Não desative RLS.
-- Sem efeitos sobre estoque, valores, comissões ou demais pedidos.
begin;
do $correcao$
declare p public.pedidos; f public.formas_pagamento; qtd integer; datas jsonb;
begin
 if to_regprocedure('public.vencimento_pedido_227(uuid,integer)') is null then
  raise exception 'Execute primeiro a fase227 para corrigir também as próximas confirmações';
 end if;
 select count(*) into qtd from public.pedidos where numero=1;
 if qtd<>1 then raise exception 'Esperado um único pedido número1; encontrados %. Confira o identificador antes de corrigir',qtd; end if;
 select * into p from public.pedidos where numero=1 for update;
 if p.status in ('rascunho','digitacao','cancelado','recusado') or p.data_pedido is null then
  raise exception 'Pedido1 não está confirmado ou está sem data. Confira antes de corrigir';
 end if;
 select * into f from public.formas_pagamento where id=p.forma_pagamento_id for share;
 if f.id is null or f.tipo<>'boleto' or f.parcelas_padrao<>3 or f.dias_primeira_parcela<>20 or f.intervalo_dias<>20 or p.parcelas<>3 then
  raise exception 'Confira a forma do pedido1: precisa ser boleto,3 parcelas, primeira em20 dias, intervalo20 dias. Saldo e datas não foram alterados';
 end if;
 perform 1 from public.contas_receber where pedido_id=p.id order by id for update;
 select count(*) into qtd from public.contas_receber where pedido_id=p.id;
 if qtd<>3 or (select count(distinct parcela) from public.contas_receber where pedido_id=p.id and parcela between 1 and 3)<>3 then
  raise exception 'Pedido1 precisa ter exatamente as parcelas1,2 e3. Confira os títulos antes de corrigir';
 end if;
 if not exists(select 1 from public.contas_receber where pedido_id=p.id and vencimento is distinct from p.data_pedido+(parcela*20)) then
  raise notice 'Pedido1 já está com vencimentos20/40/60. Nenhuma alteração necessária'; return;
 end if;
 if exists(select 1 from public.contas_receber t where t.pedido_id=p.id and
    (t.status is distinct from 'aberto' or coalesce(t.valor_pago,0)<>0 or nullif(to_jsonb(t)->>'acordo_id','') is not null)) then
  raise exception 'Há parcela paga, parcial, cancelada ou renegociada. Nenhum vencimento foi alterado';
 end if;
 if exists(select 1 from public.boletos b join public.contas_receber t on t.id=b.conta_receber_id where t.pedido_id=p.id) then
  raise exception 'Há registro de boleto para o pedido1. Use alteração de vencimento no fluxo bancário; nenhuma data interna foi alterada';
 end if;
 if exists(select 1 from public.movimentos_financeiros m join public.contas_receber t on t.id=m.conta_receber_id where t.pedido_id=p.id) then
  raise exception 'Há movimentação financeira vinculada ao pedido1. Confira as baixas antes de corrigir';
 end if;
 select jsonb_agg(jsonb_build_object('titulo',id,'parcela',parcela,'antes',vencimento,'depois',p.data_pedido+(parcela*20)) order by parcela)
 into datas from public.contas_receber where pedido_id=p.id;
 update public.contas_receber set vencimento=p.data_pedido+(parcela*20)
 where pedido_id=p.id and vencimento is distinct from p.data_pedido+(parcela*20);
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe)
 values('pedidos',p.id,'corrigir_vencimentos_20_40_60',auth.uid(),jsonb_build_object('data_pedido',p.data_pedido,'parcelas',datas));
end $correcao$;
select p.numero,p.data_pedido,t.parcela,t.valor,t.vencimento
from public.pedidos p join public.contas_receber t on t.pedido_id=p.id
where p.numero=1 order by t.parcela;
commit;
