-- FASE 200: cliente pode voltar para "Todos os centros" (centro_id nulo).
-- O espelho em clientes passa a copiar o centro exatamente como está no cadastro unificado.
do $$
declare _def text;
begin
  select pg_get_functiondef('public.sincronizar_pessoa()'::regprocedure) into _def;
  _def := replace(_def, 'centro_id = coalesce(new.centro_id, centro_id)', 'centro_id = new.centro_id');
  execute _def;
end $$;
