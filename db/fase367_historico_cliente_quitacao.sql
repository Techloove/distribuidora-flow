-- Corrige somente a leitura do histórico: desconto/abatimento quitam a obrigação sem serem receita.
-- Preserva FROM, joins, filtros de modalidade, ACLs, dependências e RLS das visões existentes.
begin;
do $$declare nome text;def text;regra text;qt int;begin
 regra:=$regra$CASE
 WHEN cr.status='cancelado' THEN 'cancelado'::text
 WHEN cr.status='pago' OR (coalesce(cr.valor_pago,0)>0 AND round(coalesce(cr.valor,0)+coalesce(cr.juros,0)+coalesce(cr.multa,0)+coalesce(cr.acrescimo,0)-coalesce(cr.desconto,0)-coalesce(cr.valor_pago,0),2)<=0) THEN 'pago'::text
 WHEN cr.vencimento<current_date THEN 'vencido'::text
 WHEN coalesce(cr.valor_pago,0)>0 THEN 'parcial'::text
 ELSE 'aberto'::text END AS status_efetivo$regra$;
 foreach nome in array array['vw_cliente_titulos','vw_cliente_titulos_mod_300'] loop
  if to_regclass('public.'||nome) is null then continue;end if;
  select pg_get_viewdef(('public.'||nome)::regclass,true) into def;
  select count(*) into qt from regexp_matches(def,'CASE.*?END AS status_efetivo','gs');
  if qt<>1 or (select count(*) from regexp_matches(def,'\mCASE\M','g'))<>1 or position('cr.valor_pago' in def)=0 then raise exception 'Revise a definição de % antes de corrigir a situação',nome;end if;
  def:=regexp_replace(def,'CASE.*?END AS status_efetivo',regra,'s');
  execute format('create or replace view public.%I with(security_invoker=true) as %s',nome,def);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
