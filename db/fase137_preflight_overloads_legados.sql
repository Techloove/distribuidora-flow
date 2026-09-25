-- Fase 137: preflight de overloads legados expostos por nome.
-- Evita que migrations de perimetro (Fases 114-118) concedam EXECUTE a uma
-- assinatura antiga/insegura apenas por compartilhar o mesmo nome da RPC usada pelo frontend.
-- Nao altera dados nem privilegios; aborta a migration quando houver ambiguidade.
begin;

do $$
declare
  nome text;
  qtd integer;
  r regprocedure;
  cfg text[];
  funcoes text[] := array[
    -- Comercial
    'avancar_pedido',
    'validar_pedido',
    'desconto_peso_pedido',
    'aplicar_desconto_peso',
    'preco_produto_info',

    -- Separacao / operacional
    'iniciar_separacao',
    'concluir_separacao',
    'conferir_separacao',
    'registrar_separacao_item',

    -- Financeiro / comissoes / fiscal
    'dashboard_financeiro',
    'liberar_comissoes',
    'cancelar_pagamento_comissao',
    'pagar_comissoes',
    'faturar_pedido',
    'autorizar_nota',
    'rejeitar_nota',
    'cancelar_nota_saida',

    -- Administrativas / comerciais
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
      into qtd
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = nome;

    if qtd = 0 then
      raise exception 'Fase 137: RPC esperada ausente: public.%', nome;
    end if;

    if qtd > 1 then
      raise exception
        'Fase 137: RPC public.% possui % overloads. Revise as assinaturas antes de conceder EXECUTE ao cliente',
        nome, qtd;
    end if;

    select p.oid::regprocedure, p.proconfig
      into r, cfg
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = nome
     limit 1;

    -- PUBLIC/anon nunca devem executar essas RPCs.
    if exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = r::oid
        and a.grantee = 0
        and a.privilege_type = 'EXECUTE'
    ) then
      raise exception 'Fase 137: PUBLIC ainda executa %', r;
    end if;

    if has_function_privilege('anon', r, 'EXECUTE') then
      raise exception 'Fase 137: anon ainda executa %', r;
    end if;

    if not has_function_privilege('authenticated', r, 'EXECUTE') then
      raise exception 'Fase 137: authenticated sem EXECUTE em %', r;
    end if;

    -- Se for SECURITY DEFINER, search_path precisa estar explicitamente fixado.
    if exists (select 1 from pg_proc p where p.oid = r::oid and p.prosecdef)
       and not exists (
         select 1
         from unnest(coalesce(cfg,array[]::text[])) x
         where x like 'search_path=%'
       ) then
      raise exception 'Fase 137: SECURITY DEFINER sem search_path controlado: %', r;
    end if;
  end loop;
end $$;

commit;
