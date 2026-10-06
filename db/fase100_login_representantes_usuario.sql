-- Login por nome para representantes. Aplicar SOMENTE após homologação.
-- O Supabase Auth continua usando identificador interno; o representante não precisa informar e-mail.
begin;

alter table public.profiles
  add column if not exists nome_usuario text,
  add column if not exists troca_senha_obrigatoria boolean not null default false;

create unique index if not exists profiles_nome_usuario_uq
  on public.profiles (lower(nome_usuario))
  where nome_usuario is not null;

-- Criação consciente pelo administrador (evita ativar contas 123456 em massa).
create or replace function public.admin_criar_acesso_representante(_representante_id uuid)
returns text
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  rep public.representantes;
  primeiro text;
  base text;
  usuario text;
  email_interno text;
  novo_id uuid;
  contador integer := 1;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Apenas administradores podem criar acessos de representantes';
  end if;

  select * into rep
  from public.representantes
  where id = _representante_id
  for update;

  if rep.id is null or not coalesce(rep.ativo, false) then
    raise exception 'Representante não encontrado ou inativo';
  end if;

  if rep.profile_id is not null then
    raise exception 'Representante já possui um usuário vinculado';
  end if;

  primeiro := lower(split_part(btrim(rep.nome), ' ', 1));
  base := regexp_replace(
    translate(primeiro, 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]', '', 'g'
  );
  if base = '' then base := 'representante'; end if;

  -- Evita disputa por nomes iguais em criações concorrentes.
  perform pg_advisory_xact_lock(hashtext('rep-login:' || base));
  loop
    usuario := base || case when contador = 1 then '' else contador::text end;
    email_interno := usuario || '@login.caparaosystem.invalid';
    exit when not exists (
      select 1 from public.profiles where lower(nome_usuario) = usuario
    ) and not exists (
      select 1 from auth.users where lower(email) = email_interno
    );
    contador := contador + 1;
  end loop;

  -- Mantém os mecanismos de hash/identity já usados pelo ERP.
  novo_id := public.admin_criar_usuario(email_interno, '123456', rep.nome, rep.telefone);

  update public.profiles
  set nome_usuario = usuario,
      troca_senha_obrigatoria = true,
      ativo = true
  where id = novo_id;

  update public.representantes set profile_id = novo_id where id = rep.id;
  update public.pessoas set profile_id = novo_id where id = rep.pessoa_id and rep.pessoa_id is not null;

  -- O papel representante só é liberado após a senha inicial ser trocada.
  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('representantes', rep.id, 'criar_acesso',
    jsonb_build_object('usuario', usuario, 'user_id', novo_id), auth.uid());

  return usuario;
end;
$$;

revoke all on function public.admin_criar_acesso_representante(uuid) from public, anon;
grant execute on function public.admin_criar_acesso_representante(uuid) to authenticated;

-- Executada pelo próprio representante já autenticado, APÓS auth.updateUser(password).
create or replace function public.concluir_primeiro_acesso_representante()
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  u uuid := auth.uid();
  perfil public.profiles;
  senha_hash text;
  centro uuid;
begin
  if u is null then raise exception 'Sessão obrigatória'; end if;

  select * into perfil from public.profiles where id = u for update;
  if perfil.id is null or perfil.ativo is distinct from true
    or perfil.nome_usuario is null then
    raise exception 'Cadastro de representante inválido';
  end if;

  if perfil.troca_senha_obrigatoria is distinct from true then
    return;
  end if;

  if not exists (select 1 from public.representantes r where r.profile_id = u and r.ativo) then
    raise exception 'Usuário não vinculado a representante ativo';
  end if;

  select encrypted_password into senha_hash from auth.users where id = u;
  if senha_hash is null or extensions.crypt('123456', senha_hash) = senha_hash then
    raise exception 'Altere a senha inicial antes de liberar o acesso';
  end if;

  update public.profiles set troca_senha_obrigatoria = false where id = u;
  insert into public.user_roles (user_id, role)
  values (u, 'representante')
  on conflict (user_id, role) do nothing;

  insert into public.auditoria(tabela, registro_id, acao, detalhe, user_id)
  values('profiles', u, 'primeiro_acesso_concluido',
    jsonb_build_object('usuario', perfil.nome_usuario),u);
end;
$$;

revoke all on function public.concluir_primeiro_acesso_representante() from public, anon;
grant execute on function public.concluir_primeiro_acesso_representante() to authenticated;

commit;
