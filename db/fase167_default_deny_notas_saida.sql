-- Fase 167: fecha escrita direta da tabela fiscal notas_saida.
-- A Fase 116 ja restringe as RPCs fiscais; esta fase completa o default-deny
-- de DML direto para a tabela fiscal protegida, mantendo mutacoes apenas via RPCs.
begin;

do $$
begin
  if to_regclass('public.notas_saida') is null then
    raise notice 'Fase 167: public.notas_saida ausente; nenhuma alteracao aplicada.';
    return;
  end if;

  alter table public.notas_saida enable row level security;

  drop policy if exists deny_direct_insert on public.notas_saida;
  create policy deny_direct_insert
    on public.notas_saida as restrictive
    for insert to anon, authenticated
    with check (false);

  drop policy if exists deny_direct_update on public.notas_saida;
  create policy deny_direct_update
    on public.notas_saida as restrictive
    for update to anon, authenticated
    using (false)
    with check (false);

  drop policy if exists deny_direct_delete on public.notas_saida;
  create policy deny_direct_delete
    on public.notas_saida as restrictive
    for delete to anon, authenticated
    using (false);

  revoke insert, update, delete on table public.notas_saida from anon, authenticated;
end $$;

do $$
begin
  if to_regclass('public.notas_saida') is null then
    return;
  end if;

  if has_table_privilege('anon','public.notas_saida','INSERT')
     or has_table_privilege('anon','public.notas_saida','UPDATE')
     or has_table_privilege('anon','public.notas_saida','DELETE')
     or has_table_privilege('authenticated','public.notas_saida','INSERT')
     or has_table_privilege('authenticated','public.notas_saida','UPDATE')
     or has_table_privilege('authenticated','public.notas_saida','DELETE') then
    raise exception 'Fase 167: DML direto ainda presente em public.notas_saida';
  end if;
end $$;

commit;
