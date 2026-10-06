-- Fase 203: autocadastro com liberação administrativa.
-- Novas contas públicas são criadas inativas e sem papéis.
-- Criações autenticadas realizadas pelo administrador conservam o fluxo existente.
-- Aplicar em homologação antes de produção.
begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  criado_por_admin boolean := coalesce(
    auth.uid() is not null and public.has_role(auth.uid(), 'admin'), false
  );
begin
  insert into public.profiles (id, nome, email, todos_centros, ativo)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data->>'nome'), ''), ''),
    new.email,
    false,
    criado_por_admin
  )
  on conflict (id) do nothing;

  -- Nunca atribuir papéis automaticamente no autocadastro.
  return new;
end;
$$;

commit;
