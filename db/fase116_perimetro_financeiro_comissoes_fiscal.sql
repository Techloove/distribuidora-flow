-- Fase 116: fecha o perímetro de RPCs financeiras, comissões e faturamento fiscal já usadas pelo frontend.
begin;

do $$
declare
  nome text;
  r regprocedure;
  encontrados integer;
  funcoes text[] := array[
    'dashboard_financeiro',
    'liberar_comissoes',
    'cancelar_pagamento_comissao',
    'pagar_comissoes',
    'faturar_pedido',
    'autorizar_nota',
    'rejeitar_nota',
    'cancelar_nota_saida'
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
      raise exception 'Fase 116: RPC usada pelo frontend nao encontrada: public.%', nome;
    end if;
  end loop;
end $$;

-- Preflight: nenhuma RPC deste perímetro pode ser executada por anon/PUBLIC.
do $$
declare
  nome text;
  r regprocedure;
  funcoes text[] := array[
    'dashboard_financeiro',
    'liberar_comissoes',
    'cancelar_pagamento_comissao',
    'pagar_comissoes',
    'faturar_pedido',
    'autorizar_nota',
    'rejeitar_nota',
    'cancelar_nota_saida'
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
        raise exception 'Fase 116: anon ainda executa %', r;
      end if;

      if not has_function_privilege('authenticated', r, 'EXECUTE') then
        raise exception 'Fase 116: authenticated sem EXECUTE em %', r;
      end if;

      if exists (
        select 1
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = r::oid
          and a.grantee = 0
          and a.privilege_type = 'EXECUTE'
      ) then
        raise exception 'Fase 116: PUBLIC ainda executa %', r;
      end if;
    end loop;
  end loop;
end $$;

commit;
