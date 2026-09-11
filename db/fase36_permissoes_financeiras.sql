-- ============================================================
-- FASE 36 - Permissoes financeiras granulares por perfil
-- Reaproveita user_roles / papeis / role_menus. Idempotente.
-- ============================================================

create table if not exists public.permissoes (
  codigo text primary key,
  nome text not null,
  grupo text not null default 'Financeiro',
  ordem integer not null default 0
);

grant select on public.permissoes to authenticated;
grant all on public.permissoes to service_role;
alter table public.permissoes enable row level security;
drop policy if exists "permissoes_select" on public.permissoes;
create policy "permissoes_select" on public.permissoes for select to authenticated using (true);

insert into public.permissoes (codigo, nome, grupo, ordem) values
  ('financeiro_ver', 'Visualizar financeiro', 'Financeiro', 1),
  ('pagar_criar', 'Criar contas a pagar', 'Financeiro', 2),
  ('pagar_editar', 'Editar contas a pagar', 'Financeiro', 3),
  ('pagar_aprovar', 'Aprovar pagamentos', 'Financeiro', 4),
  ('receber_criar', 'Criar contas a receber', 'Financeiro', 5),
  ('receber_baixar', 'Realizar recebimentos', 'Financeiro', 6),
  ('dre_ver', 'Visualizar DRE', 'Gerencial', 7),
  ('custos_ver', 'Visualizar custos', 'Gerencial', 8),
  ('margens_ver', 'Visualizar margens', 'Gerencial', 9),
  ('bancos_ver', 'Visualizar bancos e caixa', 'Financeiro', 10),
  ('transferir', 'Realizar transferencias', 'Financeiro', 11),
  ('categorias_gerenciar', 'Gerenciar categorias', 'Financeiro', 12),
  ('centros_gerenciar', 'Gerenciar centros de custo', 'Cadastros', 13)
on conflict (codigo) do update set nome = excluded.nome, grupo = excluded.grupo, ordem = excluded.ordem;

create table if not exists public.role_permissoes (
  role text not null,
  permissao text not null references public.permissoes(codigo) on delete cascade,
  primary key (role, permissao)
);

grant select on public.role_permissoes to authenticated;
grant all on public.role_permissoes to service_role;
alter table public.role_permissoes enable row level security;

drop policy if exists "role_permissoes_select" on public.role_permissoes;
create policy "role_permissoes_select" on public.role_permissoes for select to authenticated using (true);
drop policy if exists "role_permissoes_write_admin" on public.role_permissoes;
create policy "role_permissoes_write_admin" on public.role_permissoes for all to authenticated
using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- padroes: preserva o que os perfis ja conseguiam fazer hoje
insert into public.role_permissoes (role, permissao)
select r.role, p.codigo
  from (values ('admin'), ('gestor')) as r(role)
  cross join public.permissoes p
on conflict do nothing;

insert into public.role_permissoes (role, permissao) values
  ('financeiro','financeiro_ver'), ('financeiro','pagar_criar'), ('financeiro','pagar_editar'),
  ('financeiro','pagar_aprovar'), ('financeiro','receber_criar'), ('financeiro','receber_baixar'),
  ('financeiro','bancos_ver'), ('financeiro','transferir'), ('financeiro','categorias_gerenciar'),
  ('financeiro','dre_ver'), ('financeiro','custos_ver'), ('financeiro','margens_ver'),
  ('comercial','financeiro_ver'), ('comercial','margens_ver'),
  ('representante','financeiro_ver')
on conflict do nothing;

create or replace function public.tem_permissao(_permissao text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(auth.uid(), 'admin')
      or public.has_role(auth.uid(), 'gestor')
      or exists (
        select 1
          from public.user_roles ur
          join public.role_permissoes rp on rp.role = ur.role::text
         where ur.user_id = auth.uid() and rp.permissao = _permissao
      );
$$;

grant execute on function public.tem_permissao(text) to authenticated;

create or replace function public.minhas_permissoes()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select p.codigo from public.permissoes p
   where public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor')
  union
  select rp.permissao
    from public.user_roles ur
    join public.role_permissoes rp on rp.role = ur.role::text
   where ur.user_id = auth.uid();
$$;

grant execute on function public.minhas_permissoes() to authenticated;

create or replace function public.definir_permissao(_role text, _permissao text, _conceder boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Somente administradores alteram permissoes';
  end if;
  if _conceder then
    insert into public.role_permissoes (role, permissao) values (_role, _permissao)
      on conflict do nothing;
  else
    delete from public.role_permissoes where role = _role and permissao = _permissao;
  end if;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('role_permissoes', null, case when _conceder then 'conceder' else 'revogar' end,
          jsonb_build_object('role', _role, 'permissao', _permissao), auth.uid());
end;
$$;

grant execute on function public.definir_permissao(text, text, boolean) to authenticated;

-- ---------- leitura dos titulos limitada a quem tem permissao ----------
drop policy if exists "contas_receber_select_auth" on public.contas_receber;
create policy "contas_receber_select_auth" on public.contas_receber
for select to authenticated
using (
  public.tem_permissao('financeiro_ver')
  and (
    not public.escopo_representante()
    or exists (
      select 1 from public.clientes c
       where c.id = contas_receber.cliente_id
         and (c.representante_id = public.meu_representante_id() or c.representante_id is null)
    )
  )
);

drop policy if exists "contas_pagar_select_auth" on public.contas_pagar;
create policy "contas_pagar_select_auth" on public.contas_pagar
for select to authenticated
using (public.tem_permissao('financeiro_ver') and not public.escopo_representante());

drop policy if exists "boletos_select" on public.boletos;
create policy "boletos_select" on public.boletos
for select to authenticated using (public.tem_permissao('financeiro_ver'));

-- contas/movimentos: alem de can_finance, aceita permissao especifica
drop policy if exists "contas_financeiras_select" on public.contas_financeiras;
create policy "contas_financeiras_select" on public.contas_financeiras
for select to authenticated using (public.tem_permissao('bancos_ver'));

drop policy if exists "movimentos_financeiros_select" on public.movimentos_financeiros;
create policy "movimentos_financeiros_select" on public.movimentos_financeiros
for select to authenticated using (public.tem_permissao('bancos_ver'));

drop policy if exists "transferencias_select" on public.transferencias;
create policy "transferencias_select" on public.transferencias
for select to authenticated using (public.tem_permissao('bancos_ver'));

-- ---------- menus do modulo financeiro ----------
insert into public.role_menus (role, path)
select r.role::public.app_role, m.path
  from (values ('admin'), ('gestor'), ('financeiro')) as r(role)
  cross join (values
    ('/financeiro'), ('/contas'), ('/categorias-financeiras'),
    ('/movimentacoes'), ('/dre'), ('/relatorios-financeiros')
  ) as m(path)
 where exists (select 1 from public.role_menus)
on conflict do nothing;

insert into public.role_menus (role, path)
select 'admin'::public.app_role, '/rota-despesas'
 where exists (select 1 from public.role_menus)
on conflict do nothing;

-- ---------- fim da fase 36 ----------
