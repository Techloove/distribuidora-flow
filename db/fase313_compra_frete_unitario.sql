-- Frete negociado por item, separado do custo de compra do produto.
-- Valores históricos continuam com frete unitário zero; nenhuma entrada é refeita.
begin;
alter table public.compra_itens add column if not exists frete_unitario numeric(18,4) not null default 0;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.compra_itens'::regclass and conname='compra_frete_unitario_313') then
  alter table public.compra_itens add constraint compra_frete_unitario_313 check(frete_unitario>=0 and frete_unitario::text not in ('NaN','Infinity','-Infinity'));
 end if;
end $$;
create or replace function public.compra_itens_total()
returns trigger language plpgsql set search_path=public as $$
begin
 new.total:=round(new.quantidade*(new.custo_unitario+new.frete_unitario),2);
 return new;
end $$;

create or replace function public.adicionar_item_compra_313(
 _compra_id uuid,_produto_id uuid,_quantidade numeric,_custo_unitario numeric,
 _frete_unitario numeric default 0,_lote text default null,_validade date default null
) returns public.compra_itens language plpgsql security definer set search_path=public as $$
declare it public.compra_itens;
begin
 if _quantidade is null or _quantidade<=0 or _quantidade::text in ('NaN','Infinity','-Infinity') or _custo_unitario is null or _custo_unitario<0 or _custo_unitario::text in ('NaN','Infinity','-Infinity') or _frete_unitario is null or _frete_unitario<0 or _frete_unitario::text in ('NaN','Infinity','-Infinity') then
  raise exception 'Informe quantidade positiva e custo e frete por item válidos';
 end if;
 -- A rotina existente confere perfil, ação de compras, loja, status e produto.
 select * into it from public.adicionar_item_compra(_compra_id,_produto_id,_quantidade,_custo_unitario,_lote,_validade);
 update public.compra_itens set frete_unitario=round(_frete_unitario,4) where id=it.id returning * into it;
 perform public.recalcular_compra(_compra_id);
 return it;
end $$;

create or replace function public.atualizar_item_compra_313(
 _item_id uuid,_quantidade numeric default null,_custo_unitario numeric default null,_frete_unitario numeric default null
) returns public.compra_itens language plpgsql security definer set search_path=public as $$
declare it public.compra_itens;
begin
 -- Mesma ordem de bloqueio da atualização legada; alterações parciais preservam os demais campos.
 if not public.can_stock(auth.uid()) and not public.can_finance(auth.uid()) then raise exception 'Sem permissão para alterar itens da compra'; end if;
 select * into it from public.compra_itens where id=_item_id for update;
 if it.id is null then raise exception 'Item não encontrado'; end if;
 _quantidade:=coalesce(_quantidade,it.quantidade);
 _custo_unitario:=coalesce(_custo_unitario,it.custo_unitario);
 _frete_unitario:=coalesce(_frete_unitario,it.frete_unitario);
 if _quantidade<=0 or _quantidade::text in ('NaN','Infinity','-Infinity') or _custo_unitario<0 or _custo_unitario::text in ('NaN','Infinity','-Infinity') or _frete_unitario<0 or _frete_unitario::text in ('NaN','Infinity','-Infinity') then raise exception 'Informe quantidade positiva e custo e frete por item válidos'; end if;
 select * into it from public.atualizar_item_compra(_item_id,_quantidade,_custo_unitario);
 update public.compra_itens set frete_unitario=round(_frete_unitario,4) where id=it.id returning * into it;
 perform public.recalcular_compra(it.compra_id);
 return it;
end $$;

-- Custo médio ponderado por produto inclui seu próprio frete, antes do rateio
-- dos ajustes gerais. Preserva permissões, parcelas e idempotência do recebimento.
do $$ declare d text; begin
 select pg_get_functiondef('public.receber_compra(uuid)'::regprocedure) into d;
 if position('frete_unitario' in d)=0 then
  if position('sum(quantidade*custo_unitario)/sum(quantidade)' in d)=0 then raise exception 'Recebimento incompatível com frete por item'; end if;
  d:=replace(d,'sum(quantidade*custo_unitario)/sum(quantidade)','sum(quantidade*(custo_unitario+frete_unitario))/sum(quantidade)');
  execute d;
 end if;
end $$;
revoke all on function public.adicionar_item_compra_313(uuid,uuid,numeric,numeric,numeric,text,date) from public,anon;
revoke all on function public.atualizar_item_compra_313(uuid,numeric,numeric,numeric) from public,anon;
grant execute on function public.adicionar_item_compra_313(uuid,uuid,numeric,numeric,numeric,text,date) to authenticated;
grant execute on function public.atualizar_item_compra_313(uuid,numeric,numeric,numeric) to authenticated;
notify pgrst,'reload schema';
commit;
