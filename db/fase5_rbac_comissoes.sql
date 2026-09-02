-- ============================================================
-- ERP DISTRIBUIDORA - FASE 5
-- Administracao de usuarios/papeis (RBAC) + regras flexiveis de comissao
-- Rode este arquivo inteiro no SQL Editor do Supabase DEPOIS das Fases 1 a 4.
-- ============================================================

-- ---------- RBAC: administracao de usuarios ----------

-- admins e gestores podem ver todos os perfis; cada usuario ve o seu
drop policy if exists "profiles_select_self" on public.profiles;
drop policy if exists "profiles_select_manage" on public.profiles;
create policy "profiles_select_manage" on public.profiles
for select to authenticated
using (id = auth.uid() or public.can_manage(auth.uid()));

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
for update to authenticated
using (id = auth.uid() or public.can_manage(auth.uid()))
with check (id = auth.uid() or public.can_manage(auth.uid()));

-- leitura de papeis: o proprio usuario e os gestores
drop policy if exists "user_roles_select_self" on public.user_roles;
drop policy if exists "user_roles_select_manage" on public.user_roles;
create policy "user_roles_select_manage" on public.user_roles
for select to authenticated
using (user_id = auth.uid() or public.can_manage(auth.uid()));

-- alteracao de papeis somente por funcao controlada (evita escalonamento)
grant insert, delete on public.user_roles to authenticated;

drop policy if exists "user_roles_insert_admin" on public.user_roles;
create policy "user_roles_insert_admin" on public.user_roles
for insert to authenticated
with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "user_roles_delete_admin" on public.user_roles;
create policy "user_roles_delete_admin" on public.user_roles
for delete to authenticated
using (public.has_role(auth.uid(), 'admin'));

create or replace function public.definir_papel(_user_id uuid, _role public.app_role, _conceder boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Apenas administradores podem alterar papeis';
  end if;

  if _conceder then
    insert into public.user_roles (user_id, role) values (_user_id, _role)
    on conflict (user_id, role) do nothing;
  else
    if _role = 'admin'
       and (select count(*) from public.user_roles where role = 'admin') <= 1 then
      raise exception 'E necessario manter ao menos um administrador';
    end if;
    delete from public.user_roles where user_id = _user_id and role = _role;
  end if;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('user_roles', _user_id, case when _conceder then 'conceder_papel' else 'remover_papel' end,
          jsonb_build_object('role', _role), auth.uid());
end;
$$;

grant execute on function public.definir_papel(uuid, public.app_role, boolean) to authenticated;

-- ---------- regras flexiveis de comissao ----------
create table if not exists public.regras_comissao (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  representante_id uuid references public.representantes(id) on delete cascade,
  cliente_id uuid references public.clientes(id) on delete cascade,
  produto_id uuid references public.produtos(id) on delete cascade,
  categoria text,
  uf text,
  percentual numeric(5,2) not null default 0 check (percentual >= 0 and percentual <= 100),
  prioridade int not null default 0,
  vigencia_inicio date,
  vigencia_fim date,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists regras_comissao_rep_idx on public.regras_comissao(representante_id);
create index if not exists regras_comissao_cli_idx on public.regras_comissao(cliente_id);

grant select, insert, update, delete on public.regras_comissao to authenticated;
grant all on public.regras_comissao to service_role;
alter table public.regras_comissao enable row level security;

drop policy if exists "regras_comissao_select_auth" on public.regras_comissao;
create policy "regras_comissao_select_auth" on public.regras_comissao
for select to authenticated using (true);

drop policy if exists "regras_comissao_write_manage" on public.regras_comissao;
create policy "regras_comissao_write_manage" on public.regras_comissao
for all to authenticated
using (public.can_manage(auth.uid()))
with check (public.can_manage(auth.uid()));

drop trigger if exists trg_regras_comissao_updated on public.regras_comissao;
create trigger trg_regras_comissao_updated
before update on public.regras_comissao
for each row execute function public.set_updated_at();

-- resolve o percentual aplicavel: da regra mais especifica para a mais generica
create or replace function public.resolver_comissao(_representante_id uuid, _cliente_id uuid, _data date default current_date)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pct numeric(5,2);
  cli record;
begin
  if _representante_id is null then return 0; end if;
  select uf into cli from public.clientes where id = _cliente_id;

  select r.percentual into pct
    from public.regras_comissao r
   where r.ativo
     and (r.vigencia_inicio is null or r.vigencia_inicio <= _data)
     and (r.vigencia_fim is null or r.vigencia_fim >= _data)
     and (r.representante_id is null or r.representante_id = _representante_id)
     and (r.cliente_id is null or r.cliente_id = _cliente_id)
     and (r.uf is null or r.uf = cli.uf)
   order by r.prioridade desc,
            (r.cliente_id is not null)::int desc,
            (r.representante_id is not null)::int desc,
            (r.uf is not null)::int desc,
            r.created_at desc
   limit 1;

  if pct is not null then return pct; end if;

  select coalesce(comissao_percentual, 0) into pct
    from public.representantes where id = _representante_id;

  return coalesce(pct, 0);
end;
$$;

grant execute on function public.resolver_comissao(uuid, uuid, date) to authenticated;

-- o recalculo do pedido passa a usar as regras quando nao houver percentual manual
create or replace function public.recalcular_pedido(_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  soma numeric(14,2);
  pct numeric(5,2);
  ped record;
begin
  select coalesce(sum(total), 0) into soma from public.pedido_itens where pedido_id = _pedido_id;
  select * into ped from public.pedidos where id = _pedido_id;
  if ped is null then return; end if;

  pct := coalesce(ped.comissao_percentual, 0);
  if pct = 0 then
    pct := public.resolver_comissao(ped.representante_id, ped.cliente_id, ped.data_pedido);
  end if;

  update public.pedidos
     set total_itens = soma,
         total_liquido = greatest(soma - coalesce(desconto_valor,0) + coalesce(frete_valor,0), 0),
         comissao_percentual = pct,
         comissao_valor = round(greatest(soma - coalesce(desconto_valor,0), 0) * pct / 100, 2)
   where id = _pedido_id;
end;
$$;

-- ---------- fim da fase 5 ----------
