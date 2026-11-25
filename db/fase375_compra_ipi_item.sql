begin;
-- IPI informado por item; legados mantêm zero sem recálculo retroativo.
alter table public.compra_itens add column if not exists ipi_percentual numeric(9,4) not null default 0;
do $$begin
 if not exists(select 1 from pg_constraint where conrelid='public.compra_itens'::regclass and conname='compra_ipi_375') then
  alter table public.compra_itens add constraint compra_ipi_375 check(ipi_percentual between 0 and 100 and ipi_percentual::text not in ('NaN','Infinity','-Infinity'));
 end if;
end $$;
create or replace function public.compra_itens_total()
returns trigger language plpgsql set search_path=public as $$
begin
 new.total:=round(new.quantidade*(round(new.custo_unitario*(1+new.ipi_percentual/100),4)+new.frete_unitario),2);
 return new;
end $$;
create or replace function public.adicionar_item_compra_375(
 _compra_id uuid,_produto_id uuid,_quantidade numeric,_custo_unitario numeric,
 _frete_unitario numeric default 0,_ipi_percentual numeric default 0,_lote text default null,_validade date default null
) returns public.compra_itens language plpgsql security definer set search_path=public as $$
declare it public.compra_itens;
begin
 if _ipi_percentual is null or _ipi_percentual<0 or _ipi_percentual>100 or _ipi_percentual::text in ('NaN','Infinity','-Infinity') then raise exception 'Informe um IPI entre 0 e 100%%';end if;
 select * into it from public.adicionar_item_compra_313(_compra_id,_produto_id,_quantidade,_custo_unitario,_frete_unitario,_lote,_validade);
 update public.compra_itens set ipi_percentual=round(_ipi_percentual,4) where id=it.id returning * into it;
 perform public.recalcular_compra(_compra_id);
 return it;
end $$;
create or replace function public.atualizar_item_compra_375(
 _item_id uuid,_quantidade numeric default null,_custo_unitario numeric default null,
 _frete_unitario numeric default null,_ipi_percentual numeric default null
) returns public.compra_itens language plpgsql security definer set search_path=public as $$
declare it public.compra_itens;
begin
 if _ipi_percentual is not null and (_ipi_percentual<0 or _ipi_percentual>100 or _ipi_percentual::text in ('NaN','Infinity','-Infinity')) then raise exception 'Informe um IPI entre 0 e 100%%';end if;
 select * into it from public.atualizar_item_compra_313(_item_id,_quantidade,_custo_unitario,_frete_unitario);
 if _ipi_percentual is not null then
  update public.compra_itens set ipi_percentual=round(_ipi_percentual,4) where id=it.id returning * into it;
  perform public.recalcular_compra(it.compra_id);
 end if;
 return it;
end $$;
-- Reutiliza recebimento, rateios, controle de acesso e proteção contra receber duas vezes.
do $$declare d text; alvo text:='sum(quantidade*(custo_unitario+frete_unitario))/sum(quantidade)';begin
 select pg_get_functiondef('public.receber_compra(uuid)'::regprocedure) into d;
 if position('ipi_percentual' in d)=0 then
  if position(alvo in d)=0 then raise exception 'Recebimento incompatível. Aplique a fase313 antes da fase375';end if;
  execute replace(d,alvo,'sum(quantidade*(round(custo_unitario*(1+ipi_percentual/100),4)+frete_unitario))/sum(quantidade)');
 end if;
end $$;
revoke all on function public.adicionar_item_compra_375(uuid,uuid,numeric,numeric,numeric,numeric,text,date) from public,anon;
revoke all on function public.atualizar_item_compra_375(uuid,numeric,numeric,numeric,numeric) from public,anon;
grant execute on function public.adicionar_item_compra_375(uuid,uuid,numeric,numeric,numeric,numeric,text,date) to authenticated;
grant execute on function public.atualizar_item_compra_375(uuid,numeric,numeric,numeric,numeric) to authenticated;
notify pgrst,'reload schema';
commit;
