-- ============================================================
-- FASE 26 - Perfis de acesso por papel (menus liberados)
-- Idempotente. Rode depois da Fase 5.
-- ============================================================

create table if not exists public.role_menus (
  role public.app_role not null,
  path text not null,
  primary key (role, path)
);

grant select on public.role_menus to authenticated;
grant all on public.role_menus to service_role;
alter table public.role_menus enable row level security;

drop policy if exists "role_menus_select_auth" on public.role_menus;
create policy "role_menus_select_auth" on public.role_menus
for select to authenticated using (true);

drop policy if exists "role_menus_write_admin" on public.role_menus;
create policy "role_menus_write_admin" on public.role_menus
for all to authenticated
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

grant insert, update, delete on public.role_menus to authenticated;

-- ---------- padroes (somente se o papel ainda nao tiver configuracao) ----------
do $$
declare
  padroes jsonb := jsonb_build_object(
    'financeiro', jsonb_build_array('/dashboard','/pessoas','/faturamento','/boletos','/fluxo-caixa','/receber','/pagar','/relatorios','/notificacoes'),
    'comercial', jsonb_build_array('/dashboard','/pessoas','/produtos','/tabelas-preco','/rotas','/formas-pagamento','/pedidos','/representantes','/lead-rota','/metas','/comissoes','/relatorios','/clientes-inativos','/notificacoes'),
    'representante', jsonb_build_array('/dashboard','/pessoas','/produtos','/tabelas-preco','/pedidos','/lead-rota','/metas','/comissoes'),
    'estoque', jsonb_build_array('/dashboard','/produtos','/estoque','/separacao','/compras','/planejamento-compras'),
    'expedicao', jsonb_build_array('/dashboard','/separacao','/expedicao','/rotas')
  );
  papel text;
  caminho text;
begin
  for papel in select jsonb_object_keys(padroes) loop
    if not exists (select 1 from public.role_menus where role = papel::public.app_role) then
      for caminho in select jsonb_array_elements_text(padroes -> papel) loop
        insert into public.role_menus (role, path) values (papel::public.app_role, caminho)
        on conflict do nothing;
      end loop;
    end if;
  end loop;
end;
$$;

-- ---------- consulta dos menus do usuario logado ----------
create or replace function public.meus_menus()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select distinct rm.path
  from public.role_menus rm
  join public.user_roles ur on ur.role = rm.role
  where ur.user_id = auth.uid();
$$;

grant execute on function public.meus_menus() to authenticated;
