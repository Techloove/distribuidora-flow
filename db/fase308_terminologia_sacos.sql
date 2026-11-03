-- Apenas textos apresentados nas validações; identificadores e regras permanecem.
begin;
do $$declare r record;d text;begin
 for r in select p.oid,p.prosrc,pg_get_functiondef(p.oid) def from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in('item_intermediacao_296','calcular_frete_volume_250') and p.prokind='f' loop
  d:=regexp_replace(r.prosrc,'\msacas\M','sacos','g');
  d:=regexp_replace(d,'\msaca\M','saco','g');
  d:=regexp_replace(d,'\mSacas\M','Sacos','g');
  d:=regexp_replace(d,'\mSaca\M','Saco','g');
  d:=replace(d,'sacos inteiras','sacos inteiros');
  if d is distinct from r.prosrc then execute replace(r.def,r.prosrc,d);end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
