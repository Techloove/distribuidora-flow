-- Aplicar em homologacao, apos reconciliar o schema real com os scripts versionados.
-- Nao cria multi-tenancy entre empresas. Preserva as atribuicoes existentes.
begin;

create or replace function public.usuario_ativo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.ativo)
     and exists (select 1 from public.user_roles r where r.user_id = auth.uid());
$$;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles r join public.profiles p on p.id = r.user_id
    where r.user_id = _user_id and r.role = _role and p.ativo);
$$;
create or replace function public.can_manage(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_user_id, 'admin') or public.has_role(_user_id, 'gestor');
$$;

create or replace function public.can_finance(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage(_user_id) or public.has_role(_user_id, 'financeiro');
$$;
create or replace function public.can_stock(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage(_user_id) or public.has_role(_user_id, 'estoque') or public.has_role(_user_id, 'expedicao');
$$;
create or replace function public.can_operate(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles r join public.profiles p on p.id = r.user_id
    where r.user_id = _user_id and p.ativo
      and r.role in ('admin','gestor','comercial','financeiro','estoque','expedicao','representante'));
$$;

alter table public.profiles alter column todos_centros set default false;
revoke insert on public.profiles from authenticated;

-- O cadastro publico nunca concede um papel, nem mesmo para o primeiro usuario.
-- O primeiro administrador deve ser provisionado pelo operador do banco.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, nome, email, todos_centros)
  values(new.id, coalesce(new.raw_user_meta_data->>'nome', ''), new.email, false)
  on conflict(id) do nothing;
  return new;
end;
$$;

-- Impede escalada por UPDATE do proprio perfil, inclusive com policies antigas.
create or replace function public.proteger_campos_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.can_manage(auth.uid())
     and (to_jsonb(new) - array['nome','telefone','updated_at'])
         is distinct from (to_jsonb(old) - array['nome','telefone','updated_at']) then
    raise exception 'Somente administradores podem alterar campos de acesso' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_proteger_campos_perfil on public.profiles;
create trigger trg_proteger_campos_perfil before update on public.profiles
for each row execute function public.proteger_campos_perfil();

create or replace function public.meus_centros()
returns setof uuid language sql stable security definer set search_path = public as $$
  select c.id from public.centros c
  where public.usuario_ativo() and (
    public.can_manage(auth.uid())
    or exists(select 1 from public.profiles p where p.id = auth.uid() and p.todos_centros)
    or exists(select 1 from public.usuario_centros uc where uc.user_id = auth.uid() and uc.centro_id = c.id)
  );
$$;

create or replace function public.usuario_pode_acessar_centro(_centro_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.usuario_ativo() and (
    (_centro_id is not null and _centro_id in (select public.meus_centros()))
    or (_centro_id is null and (public.can_manage(auth.uid())
      or exists(select 1 from public.profiles p where p.id = auth.uid() and p.todos_centros)))
  );
$$;

-- RESTRICTIVE faz AND com as policies existentes; uma permissiva antiga nao contorna o filtro.
do $$
declare t record;
begin
  for t in select c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity
      and c.relname not in ('profiles','user_roles')
  loop
    execute format('drop policy if exists acesso_usuario_ativo on public.%I', t.relname);
    execute format('create policy acesso_usuario_ativo on public.%I as restrictive for all to authenticated using (public.usuario_ativo()) with check (public.usuario_ativo())', t.relname);
    if exists(select 1 from information_schema.columns where table_schema = 'public'
      and table_name = t.relname and column_name = 'centro_id' and udt_name = 'uuid') then
      execute format('drop policy if exists acesso_centro_restrito on public.%I', t.relname);
      execute format('create policy acesso_centro_restrito on public.%I as restrictive for all to authenticated using (public.usuario_pode_acessar_centro(centro_id)) with check (public.usuario_pode_acessar_centro(centro_id))', t.relname);
    end if;
  end loop;
end;
$$;

drop policy if exists pessoas_carteira_restrita on public.pessoas;
create policy pessoas_carteira_restrita on public.pessoas as restrictive for all to authenticated
using (not public.escopo_representante() or representante_id = public.meu_representante_id())
with check (not public.escopo_representante() or representante_id = public.meu_representante_id());

-- Views de relatorios nao devem executar com o acesso do dono da view.
do $$
declare v record;
begin
  for v in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  loop
    execute format('alter view public.%I set (security_invoker = true)', v.relname);
  end loop;
end;
$$;

-- Remove acesso anonimo a RPCs SECURITY DEFINER existentes, preservando acesso autenticado.
do $$
declare f record;
begin
  for f in select p.oid, p.oid::regprocedure as signature from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prokind = 'f'
  loop
    if has_function_privilege('authenticated', f.oid, 'EXECUTE') then
      execute format('grant execute on function %s to authenticated', f.signature);
    end if;
    execute format('revoke execute on function %s from public, anon', f.signature);
  end loop;
end;
$$;

create index if not exists pedidos_centro_data_idx on public.pedidos(centro_id, data_pedido desc);
create index if not exists pedidos_representante_data_idx on public.pedidos(representante_id, data_pedido desc);
create index if not exists pessoas_representante_idx on public.pessoas(representante_id);
commit;
