-- Fase 196: cadastros publicos permanecem pendentes ate aprovacao do admin.
-- Cadastro de usuario nao concede acesso ao ERP automaticamente.
begin;

create or replace function public.novo_perfil_pendente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Todo perfil recem-criado precisa ser aprovado por um administrador.
  new.ativo := false;
  return new;
end;
$$;

drop trigger if exists trg_novo_perfil_pendente on public.profiles;
create trigger trg_novo_perfil_pendente
before insert on public.profiles
for each row execute function public.novo_perfil_pendente();

create or replace function public.admin_aprovar_cadastro(
  _user_id uuid,
  _role public.app_role
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  perfil public.profiles;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Somente administradores podem aprovar cadastros' using errcode='42501';
  end if;

  if _user_id is null or _role is null then
    raise exception 'Informe usuario e papel';
  end if;

  select * into perfil
  from public.profiles
  where id = _user_id
  for update;

  if perfil.id is null then
    raise exception 'Cadastro nao encontrado';
  end if;
  if coalesce(perfil.ativo, false) then
    raise exception 'O usuario ja esta ativo';
  end if;

  -- Perfil fica ativo apenas na mesma transacao da atribuicao de papel.
  -- Papéis preexistentes de cadastro pendente não devem conceder acesso inesperado.
  delete from public.user_roles where user_id = _user_id;
  insert into public.user_roles(user_id,role) values (_user_id,_role);
  update public.profiles set ativo = true where id = _user_id;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values(
    'profiles',_user_id,'aprovar_cadastro',
    jsonb_build_object('papel', _role, 'aprovado_por', auth.uid()),
    auth.uid()
  );
end;
$$;

revoke all on function public.admin_aprovar_cadastro(uuid, public.app_role) from public, anon;
grant execute on function public.admin_aprovar_cadastro(uuid, public.app_role) to authenticated;

revoke all on function public.novo_perfil_pendente() from public, anon, authenticated;

commit;
