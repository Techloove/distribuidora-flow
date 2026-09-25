-- Fase 99: usuário ativo, RLS restritivo e fechamento de EXECUTE anônimo.
-- Incorporada após revisão cruzada da auditoria feita na branch codex/erp-seguranca-layout.
-- Não altera dados operacionais; endurece autorização existente.
begin;

create or replace function public.usuario_ativo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.ativo, false)
  )
  and exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
  );
$$;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = _user_id
      and ur.role = _role
      and coalesce(p.ativo, false)
  );
$$;

create or replace function public.can_manage(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(_user_id, 'admin') or public.has_role(_user_id, 'gestor');
$$;

create or replace function public.can_finance(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_manage(_user_id) or public.has_role(_user_id, 'financeiro');
$$;

create or replace function public.can_stock(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_manage(_user_id)
      or public.has_role(_user_id, 'estoque')
      or public.has_role(_user_id, 'expedicao');
$$;

create or replace function public.can_operate(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = _user_id
      and coalesce(p.ativo, false)
      and ur.role in ('admin','gestor','comercial','financeiro','estoque','expedicao','representante')
  );
$$;

-- Usuário comum só pode editar campos pessoais do próprio perfil.
create or replace function public.proteger_campos_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and not public.can_manage(auth.uid())
     and (to_jsonb(new) - array['nome','telefone','updated_at'])
         is distinct from (to_jsonb(old) - array['nome','telefone','updated_at']) then
    raise exception 'Somente administradores podem alterar campos de acesso' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_campos_perfil on public.profiles;
create trigger trg_proteger_campos_perfil
before update on public.profiles
for each row execute function public.proteger_campos_perfil();

-- Restrição adicional: qualquer tabela já protegida por RLS exige usuário ativo.
-- Em tabelas com centro_id UUID, também exige acesso ao centro.
do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind = 'r'
      and c.relrowsecurity
      and c.relname not in ('profiles','user_roles')
  loop
    execute format('drop policy if exists acesso_usuario_ativo on public.%I', t.relname);
    execute format(
      'create policy acesso_usuario_ativo on public.%I as restrictive for all to authenticated using (public.usuario_ativo()) with check (public.usuario_ativo())',
      t.relname
    );

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = t.relname
        and column_name = 'centro_id'
        and udt_name = 'uuid'
    ) then
      execute format('drop policy if exists acesso_centro_restrito on public.%I', t.relname);
      execute format(
        'create policy acesso_centro_restrito on public.%I as restrictive for all to authenticated using (public.usuario_pode_acessar_centro(centro_id)) with check (public.usuario_pode_acessar_centro(centro_id))',
        t.relname
      );
    end if;
  end loop;
end;
$$;

-- SECURITY DEFINER não deve ficar executável por anon/PUBLIC por herança implícita.
-- Se authenticated já conseguia executar (inclusive via PUBLIC), preserva esse acesso explicitamente.
do $$
declare f record;
begin
  for f in
    select p.oid, p.oid::regprocedure as signature
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosecdef
      and p.prokind = 'f'
  loop
    if has_function_privilege('authenticated', f.oid, 'EXECUTE') then
      execute format('grant execute on function %s to authenticated', f.signature);
    end if;
    execute format('revoke execute on function %s from public, anon', f.signature);
  end loop;
end;
$$;

grant execute on function public.usuario_ativo() to authenticated;

commit;