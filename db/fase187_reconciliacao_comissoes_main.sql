-- Fase 187: reconcilia a unificacao de comissoes trazida pelas alteracoes recentes de main.
-- Mantem /gestao-comissoes apenas como rota legada/alias; o menu passa a usar /comissoes.
begin;

insert into public.role_menus (role, path)
select distinct rm.role, '/comissoes'
from public.role_menus rm
where rm.path = '/gestao-comissoes'
on conflict (role, path) do nothing;

delete from public.role_menus where path = '/gestao-comissoes';

commit;