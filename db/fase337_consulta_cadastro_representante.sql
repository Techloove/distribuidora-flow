-- Somente autorização do próprio usuário. Não expõe cadastros nem concede acesso a tabelas.
begin;
create or replace function public.consulta_cliente_representante_permitida_337() returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce(
  public.usuario_ativo() and public.saas_acesso_330() and public.escopo_representante()
  and public.pode_rotina('clientes_cadastrar')
  and exists(select 1 from public.profiles p where p.id=auth.uid() and p.ativo and not coalesce(p.precisa_completar_cadastro,false))
  and exists(select 1 from public.representantes r where r.id=public.meu_representante_id() and r.profile_id=auth.uid() and r.ativo),false)
$$;
revoke all on function public.consulta_cliente_representante_permitida_337() from public,anon,authenticated,service_role;
grant execute on function public.consulta_cliente_representante_permitida_337() to authenticated;
notify pgrst,'reload schema';
commit;
