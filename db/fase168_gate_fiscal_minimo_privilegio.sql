-- Fase 168: gate fiscal de minimo privilegio.
-- Consolida o hardening da Fase 167 e valida que o navegador nao consegue
-- escrever diretamente em notas_saida nem executar RPCs fiscais como anon/PUBLIC.
begin;

do $$
declare
  rel regclass := to_regclass('public.notas_saida');
  rls boolean;
begin
  if rel is null then
    raise exception 'Fase 168: tabela fiscal public.notas_saida ausente';
  end if;

  select c.relrowsecurity into rls from pg_class c where c.oid = rel;
  if coalesce(rls,false) = false then
    raise exception 'Fase 168: RLS desabilitado em public.notas_saida';
  end if;

  if has_table_privilege('anon', rel, 'INSERT')
     or has_table_privilege('anon', rel, 'UPDATE')
     or has_table_privilege('anon', rel, 'DELETE')
     or has_table_privilege('authenticated', rel, 'INSERT')
     or has_table_privilege('authenticated', rel, 'UPDATE')
     or has_table_privilege('authenticated', rel, 'DELETE') then
    raise exception 'Fase 168: escrita direta ainda liberada em public.notas_saida';
  end if;
end $$;

do $$
declare
  nome text;
  r regprocedure;
  nomes text[] := array['faturar_pedido','autorizar_nota','rejeitar_nota','cancelar_nota_saida'];
begin
  foreach nome in array nomes loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=nome
    ) then
      raise exception 'Fase 168: RPC fiscal ausente: public.%', nome;
    end if;

    for r in
      select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=nome
    loop
      if has_function_privilege('anon', r, 'EXECUTE') then
        raise exception 'Fase 168: anon executa RPC fiscal %', r;
      end if;

      if exists (
        select 1
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = r::oid
          and a.grantee = 0
          and a.privilege_type = 'EXECUTE'
      ) then
        raise exception 'Fase 168: PUBLIC executa RPC fiscal %', r;
      end if;

      if not has_function_privilege('authenticated', r, 'EXECUTE') then
        raise exception 'Fase 168: authenticated sem EXECUTE na RPC fiscal %', r;
      end if;
    end loop;
  end loop;
end $$;

commit;
