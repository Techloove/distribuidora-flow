-- ============================================================
-- FASE 28 - Cadastro / alteracao / exclusao de usuarios via SQL
-- Nao depende da service_role key: tudo por RPC security definer,
-- restrito a quem tem o papel admin.
-- Idempotente.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- criar usuario ----------
create or replace function public.admin_criar_usuario(
  _email text,
  _senha text,
  _nome text default '',
  _telefone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  novo_id uuid := gen_random_uuid();
  email_norm text := lower(trim(_email));
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Apenas admin pode cadastrar usuários';
  end if;
  if email_norm is null or email_norm = '' then
    raise exception 'Informe o e-mail';
  end if;
  if _senha is null or length(_senha) < 6 then
    raise exception 'A senha deve ter ao menos 6 caracteres';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = email_norm) then
    raise exception 'Já existe usuário com este e-mail';
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    novo_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    email_norm,
    extensions.crypt(_senha, extensions.gen_salt('bf')),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('nome', coalesce(_nome, '')),
    now(),
    now()
  );

  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(),
    novo_id,
    novo_id::text,
    'email',
    jsonb_build_object('sub', novo_id::text, 'email', email_norm, 'email_verified', true),
    null,
    now(),
    now()
  );

  insert into public.profiles (id, nome, email, telefone)
  values (novo_id, coalesce(nullif(trim(_nome), ''), email_norm), email_norm, nullif(trim(coalesce(_telefone,'')), ''))
  on conflict (id) do update
    set nome = excluded.nome, email = excluded.email, telefone = excluded.telefone;

  return novo_id;
end;
$$;

grant execute on function public.admin_criar_usuario(text, text, text, text) to authenticated;

-- ---------- atualizar usuario ----------
create or replace function public.admin_atualizar_usuario(
  _user_id uuid,
  _nome text default null,
  _email text default null,
  _telefone text default null,
  _ativo boolean default null,
  _senha text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  email_norm text := lower(nullif(trim(coalesce(_email, '')), ''));
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Apenas admin pode alterar usuários';
  end if;

  if email_norm is not null then
    if exists (select 1 from auth.users u where lower(u.email) = email_norm and u.id <> _user_id) then
      raise exception 'Já existe usuário com este e-mail';
    end if;
    update auth.users
       set email = email_norm,
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at = now()
     where id = _user_id;
    update auth.identities
       set identity_data = identity_data || jsonb_build_object('email', email_norm),
           updated_at = now()
     where user_id = _user_id and provider = 'email';
  end if;

  if _senha is not null and _senha <> '' then
    if length(_senha) < 6 then
      raise exception 'A senha deve ter ao menos 6 caracteres';
    end if;
    update auth.users
       set encrypted_password = extensions.crypt(_senha, extensions.gen_salt('bf')),
           updated_at = now()
     where id = _user_id;
  end if;

  update public.profiles
     set nome = coalesce(nullif(trim(coalesce(_nome, '')), ''), nome),
         email = coalesce(email_norm, email),
         telefone = case when _telefone is null then telefone
                         else nullif(trim(_telefone), '') end,
         ativo = coalesce(_ativo, ativo)
   where id = _user_id;
end;
$$;

grant execute on function public.admin_atualizar_usuario(uuid, text, text, text, boolean, text) to authenticated;

-- ---------- excluir usuario ----------
create or replace function public.admin_excluir_usuario(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Apenas admin pode excluir usuários';
  end if;
  if _user_id = auth.uid() then
    raise exception 'Você não pode excluir o próprio usuário';
  end if;

  delete from public.user_roles where user_id = _user_id;
  delete from auth.users where id = _user_id;
end;
$$;

grant execute on function public.admin_excluir_usuario(uuid) to authenticated;
