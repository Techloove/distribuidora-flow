-- Fase 114: fecha o perímetro de RPCs comerciais legadas ainda usadas pela tela de pedidos.
-- O frontend autenticado pode executá-las; PUBLIC/anon não.
begin;

do $$
declare
  nome text;
  r regprocedure;
  encontrados integer;
  funcoes text[] := array[
    'avancar_pedido',
    'validar_pedido',
    'desconto_peso_pedido',
    'aplicar_desconto_peso',
    'preco_produto_info'
  ];
begin
  foreach nome in array funcoes loop
    select count(*)
      into encontrados
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = nome;

    if encontrados <> 1 then
      raise exception 'Perimetro inseguro: public.% possui % assinaturas; esperado exatamente 1 antes de conceder EXECUTE', nome, encontrados;
    end if;

    select p.oid::regprocedure
      into r
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = nome;

    execute format('revoke execute on function %s from public, anon', r);
    execute format('grant execute on function %s to authenticated, service_role', r);

    if encontrados = 0 then
      raise exception 'Fase 114: RPC usada pelo frontend não encontrada: public.%', nome;
    end if;
  end loop;
end $$;

-- Preflight local: nenhuma dessas RPCs pode permanecer executável por anon/PUBLIC.
do $$
declare
  nome text;
  r regprocedure;
  funcoes text[] := array[
    'avancar_pedido',
    'validar_pedido',
    'desconto_peso_pedido',
    'aplicar_desconto_peso',
    'preco_produto_info'
  ];
begin
  foreach nome in array funcoes loop
    for r in
      select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = nome
    loop
      if has_function_privilege('anon', r, 'EXECUTE') then
        raise exception 'Fase 114: anon ainda executa %', r;
      end if;

      if not has_function_privilege('authenticated', r, 'EXECUTE') then
        raise exception 'Fase 114: authenticated sem EXECUTE em %', r;
      end if;

      if exists (
        select 1
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = r::oid
          and a.grantee = 0
          and a.privilege_type = 'EXECUTE'
      ) then
        raise exception 'Fase 114: PUBLIC ainda executa %', r;
      end if;
    end loop;
  end loop;
end $$;

commit;
