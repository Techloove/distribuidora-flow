-- Cadastro público sob aprovação exclusiva de administrador.
-- Aplicar primeiro em homologação. Não altera o status dos usuários existentes.
begin;

-- O usuário que se cadastra pelo Supabase Auth nasce sem autorização.
alter table public.profiles
  alter column ativo set default false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nome, email, ativo, todos_centros)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data->>'nome'), ''), ''),
    new.email,
    false,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Proteger campos de autorização mesmo se uma policy de UPDATE próprio
-- continuar ativa. O usuário pode editar dados pessoais, mas nunca aprovar-se.
create or replace function public.proteger_aprovacao_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.ativo is distinct from old.ativo
    or new.todos_centros is distinct from old.todos_centros
    or new.empresa_id is distinct from old.empresa_id
  ) and auth.uid() is not null
    and not public.has_role(auth.uid(), 'admin')
  then
    raise exception 'Apenas administradores podem modificar a autorização de acesso';
  end if;
  return new;
end;
$$;

drop trigger if exists proteger_aprovacao_profile_trg on public.profiles;
create trigger proteger_aprovacao_profile_trg
before update of ativo, todos_centros, empresa_id on public.profiles
for each row execute function public.proteger_aprovacao_profile();

-- Mesmo que um papel seja cadastrado antes da aprovação, permissões de módulo
-- e autorização por centro continuam bloqueadas para perfis inativos.
create or replace function public.tem_permissao(_permissao text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.usuario_ativo()
    and (
      public.has_role(auth.uid(), 'admin')
      or public.has_role(auth.uid(), 'gestor')
      or exists (
        select 1
        from public.user_roles ur
        join public.role_permissoes rp on rp.role = ur.role::text
        where ur.user_id = auth.uid() and rp.permissao = _permissao
      )
    );
$$;

create or replace function public.usuario_pode_acessar_centro(_centro_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.usuario_ativo()
    and (
      public.has_role(auth.uid(), 'admin')
      or public.has_role(auth.uid(), 'gestor')
      or (
        _centro_id is not null
        and (
          coalesce((select p.todos_centros from public.profiles p where p.id = auth.uid()), false)
          or exists (
            select 1
            from public.usuario_centros uc
            where uc.user_id = auth.uid()
              and uc.centro_id = _centro_id
          )
        )
      )
    );
$$;

-- Auditoria e autorização são realizadas no servidor; nunca pela interface.
create or replace function public.admin_aprovar_cadastro(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil public.profiles;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Somente administradores podem aprovar novos cadastros';
  end if;
  if _user_id is null then
    raise exception 'Usuário obrigatório';
  end if;

  select * into v_perfil
  from public.profiles
  where id = _user_id
  for update;

  if v_perfil.id is null then
    raise exception 'Cadastro não encontrado';
  end if;

  if not exists (select 1 from public.user_roles where user_id = _user_id) then
    raise exception 'Atribua ao menos um papel antes de aprovar o cadastro';
  end if;

  if v_perfil.ativo then return; end if;

  update public.profiles set ativo = true where id = _user_id;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values (
    'profiles', _user_id, 'aprovar_cadastro',
    jsonb_build_object('aprovado_por', auth.uid()),
    auth.uid()
  );
end;
$$;

revoke all on function public.admin_aprovar_cadastro(uuid) from public, anon;
grant execute on function public.admin_aprovar_cadastro(uuid) to authenticated;

commit;
