-- Fase 59: endurecimento do isolamento por centro na logística.
-- Não substitui RLS existente; cria políticas apenas quando as tabelas existirem.
do $$
begin
  if to_regclass('public.expedicoes') is not null then
    alter table public.expedicoes enable row level security;
    drop policy if exists expedicoes_center_select on public.expedicoes;
    create policy expedicoes_center_select on public.expedicoes
      for select to authenticated
      using (public.usuario_pode_acessar_centro(centro_id));
    drop policy if exists expedicoes_center_update on public.expedicoes;
    create policy expedicoes_center_update on public.expedicoes
      for update to authenticated
      using (
        public.usuario_pode_acessar_centro(centro_id)
        and public.tem_permissao('expedicao_ver')
      )
      with check (public.usuario_pode_acessar_centro(centro_id));
  end if;
end $$;

create index if not exists expedicoes_centro_status_idx
  on public.expedicoes (centro_id, status)
  where centro_id is not null;
