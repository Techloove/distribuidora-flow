-- Fase227: confirmação deve usar os prazos da forma, como a prévia do pedido.
-- Preserva a função instalada (carteira, aprovação, crédito, estoque e idempotência).
-- Não altera títulos já emitidos nem interpreta prazos a partir do nome da forma.
begin;
create or replace function public.vencimento_pedido_227(_pedido uuid,_parcela integer)
returns date language plpgsql security definer set search_path=public as $$
declare p public.pedidos; f public.formas_pagamento; primeiro integer:=0; intervalo integer:=30;
begin
 select * into p from public.pedidos where id=_pedido;
 if p.id is null or p.data_pedido is null or _parcela is null or _parcela<1 then
  raise exception 'Pedido, data e parcela válidos são obrigatórios';
 end if;
 if p.forma_pagamento_id is not null then
  -- Compartilhado até o fim da confirmação: nenhuma edição da condição pode
  -- trocar os prazos entre a primeira e a última parcela do mesmo pedido.
  select * into f from public.formas_pagamento where id=p.forma_pagamento_id for share;
  if f.id is null then raise exception 'Forma de pagamento do pedido não encontrada'; end if;
  if coalesce(p.parcelas,1)<>f.parcelas_padrao then
   raise exception 'Quantidade de parcelas difere da forma de pagamento. Salve novamente o pagamento do pedido antes de confirmar';
  end if;
  primeiro:=f.dias_primeira_parcela;
  intervalo:=f.intervalo_dias;
 end if;
 if _parcela>greatest(coalesce(p.parcelas,1),1) or primeiro<0 or intervalo<0 then
  raise exception 'Prazo ou parcela inválidos';
 end if;
 return p.data_pedido+(primeiro+(_parcela-1)*intervalo);
end $$;
revoke all on function public.vencimento_pedido_227(uuid,integer) from public,anon,authenticated;

do $migration$ declare d text; begin
 select pg_get_functiondef('public.confirmar_pedido(uuid)'::regprocedure) into d;
 if position('public.vencimento_pedido_227(ped.id,n)' in d)=0 then
  if position('ped.data_pedido+((n-1)*30)' in d)=0 then
   raise exception 'Confirmação incompatível: não foi encontrado o cálculo legado da fase80. Nenhuma alteração aplicada';
  end if;
  d:=replace(d,'ped.data_pedido+((n-1)*30)','public.vencimento_pedido_227(ped.id,n)');
  execute d;
 end if;
end $migration$;
notify pgrst,'reload schema';
commit;
