-- Torna techloove1@gmail.com ADMIN do ERP.
-- Rode INTEIRO no SQL Editor do Supabase (não precisa editar nada).
-- Se o e-mail não existir em auth.users, o script avisa com uma mensagem clara.

do $$
declare
  _email text := 'techloove1@gmail.com';
  _uid uuid;
begin
  select id into _uid from auth.users where lower(email) = lower(_email) limit 1;

  if _uid is null then
    raise exception 'Nenhum usuario com o e-mail % existe em auth.users. Crie o acesso na tela de cadastro do app primeiro.', _email;
  end if;

  insert into public.profiles (id, nome, email)
  values (_uid, coalesce(split_part(_email, '@', 1), 'Administrador'), _email)
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (_uid, 'admin'::public.app_role)
  on conflict (user_id, role) do nothing;

  raise notice 'OK: % agora e admin (id %)', _email, _uid;
end $$;

-- Conferencia: deve aparecer techloove1@gmail.com com role = admin
select u.email, r.role, u.created_at
from auth.users u
left join public.user_roles r on r.user_id = u.id
order by u.created_at;
