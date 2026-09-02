-- ============================================================
-- FASE 30 - Unificar os perfis "Administrador" e "Gestor"
-- Quem era gestor passa a ser admin; o perfil gestor sai da lista.
-- Idempotente.
-- ============================================================

insert into public.user_roles (user_id, role)
select user_id, 'admin'::public.app_role
  from public.user_roles
 where role = 'gestor'
on conflict (user_id, role) do nothing;

delete from public.user_roles where role = 'gestor';
delete from public.role_menus where role = 'gestor';
delete from public.papeis where codigo = 'gestor';

update public.papeis set nome = 'Administrador / Gestor' where codigo = 'admin';
