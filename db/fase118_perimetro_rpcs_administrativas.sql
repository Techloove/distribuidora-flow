-- Fase 118: fecha o perímetro de RPCs administrativas/comerciais ainda usadas pelo frontend.
-- Mantém chamadas apenas para authenticated/service_role; PUBLIC e anon ficam sem EXECUTE.
begin;

do $$
declare
  nome text;
  r regprocedure;
  encontrados integer;
  funcoes text[] := array[
    'admin_atualizar_usuario',
    'admin_criar_usuario',
    'admin_excluir_usuario',
    'admin_vincular_representante',
    'aplicar_rotas_por_cidade',
    'baixar_titulos_lote',
    'definir_centros_usuario',
    'definir_papel',
    'lead_criar_pedido',
    'meus_centros',
    'minhas_permissoes',
    'papel_criar',
    'papel_definir_preco',
    'papel_excluir',
    'papel_renomear'
  ];
begin
  foreach nome in array funcoes loop
    select count(*)
      into encontrados
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname=nome;

    if encontrados <> 1 then
      raise exception 'Perimetro inseguro: public.% possui % assinaturas; esperado exatamente 1 antes de conceder EXECUTE', nome, encontrados;
    end if;

    select p.oid::regprocedure
      into r
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname=nome;

    execute format('revoke execute on function %s from public, anon', r);
    execute format('grant execute on function %s to authenticated, service_role', r);
  end loop;
end $$;

commit;
