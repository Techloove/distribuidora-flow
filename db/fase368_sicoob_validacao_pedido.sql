-- Corrige a ordem dos argumentos sem alterar aprovação, pedidos, títulos ou outras validações.
begin;
do $$declare def text;errado text:='status_comissao_valido_302(p.status,p.tipo_documento)';certo text:='status_comissao_valido_302(p.tipo_documento,p.status)';begin
 if to_regprocedure('public.sicoob_reservar_emissao_316(uuid,uuid,jsonb)') is null then raise exception 'Instale a emissão Sicoob316 antes da fase368';end if;
 select pg_get_functiondef('public.sicoob_reservar_emissao_316(uuid,uuid,jsonb)'::regprocedure) into def;
 if position(errado in def)>0 then
  execute replace(def,errado,certo);
 elsif position(certo in def)=0 then
  raise exception 'Validação do pedido não localizada. Revise a função antes de aplicar a correção';
 end if;
end $$;
notify pgrst,'reload schema';
commit;
