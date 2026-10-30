-- O histórico é consultado com a sessão do usuário. Não expõe o helper privado de serviço.
-- Mantém leitura somente para administrador ativo, dentro do escopo de centros existente.
begin;
drop policy if exists consultar_condicoes_292 on public.sicredi_condicoes_historico_292;
create policy consultar_condicoes_292 on public.sicredi_condicoes_historico_292
 for select to authenticated using (
 public.usuario_ativo()
 and public.has_role(auth.uid(),'admin')
 and public.usuario_pode_acessar_centro(centro_id)
 );
notify pgrst,'reload schema';
commit;
