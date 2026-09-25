-- Fase 149: fecha escrita direta de papeis de usuario.
-- Atribuicoes de acesso devem passar pelas RPCs administrativas controladas.
begin;

alter table public.user_roles enable row level security;

revoke insert, update, delete on public.user_roles from anon, authenticated;

-- Mantem leitura apenas quando as policies existentes permitirem.
grant select on public.user_roles to authenticated;

commit;
