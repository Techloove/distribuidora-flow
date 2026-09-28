-- Fase 82: unifica "Comissões" e "Gestão de comissões" em um único módulo (/comissoes)
-- Quem tinha acesso à tela antiga (role_menus./gestao-comissoes) passa a ter acesso à tela unificada.

begin;

insert into public.role_menus (role, path)
select distinct rm.role, '/comissoes'
from public.role_menus rm
where rm.path = '/gestao-comissoes'
on conflict (role, path) do nothing;

delete from public.role_menus where path = '/gestao-comissoes';

commit;

-- conferência
select role::text, path
from public.role_menus
where path in ('/comissoes', '/gestao-comissoes')
order by role, path;
