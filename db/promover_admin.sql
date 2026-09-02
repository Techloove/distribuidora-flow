-- Torna um usuário existente ADMIN do ERP.
-- Troque o e-mail abaixo pelo seu e-mail de acesso e rode no SQL Editor do Supabase.

insert into public.user_roles (user_id, role)
select u.id, 'admin'::public.app_role
from auth.users u
where lower(u.email) = lower('SEU-EMAIL@EXEMPLO.COM')
on conflict (user_id, role) do nothing;

-- Conferir os papéis atuais:
select u.email, r.role
from auth.users u
left join public.user_roles r on r.user_id = u.id
order by u.created_at;
