-- Fase 53: limpeza total de dados (somente administradores).
-- Mantém acesso e configurações: usuários, papéis, permissões, menus, centros,
-- empresa, parâmetros, Sicredi, plano de contas, formas de pagamento, faixas de desconto.
create or replace function public.admin_limpar_dados(_confirmacao text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  manter text[] := array['centros','empresas','papeis','parametros','permissoes','profiles',
    'role_menus','role_permissoes','user_roles','usuario_centros','sicredi_config',
    'lead_score_config','categorias_financeiras','formas_pagamento','desconto_faixas_peso'];
  lista text;
  qtd int;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Somente administradores podem limpar os dados';
  end if;
  if coalesce(_confirmacao, '') <> 'LIMPAR' then
    raise exception 'Digite LIMPAR para confirmar';
  end if;

  select string_agg(format('public.%I', c.relname), ', '), count(*)
    into lista, qtd
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and c.relname <> all (manter);

  execute 'truncate table ' || lista || ' restart identity';
  return qtd;
end;
$$;

revoke all on function public.admin_limpar_dados(text) from public, anon;
grant execute on function public.admin_limpar_dados(text) to authenticated;
