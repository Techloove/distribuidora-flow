-- Leitura de clientes explicitamente compartilhados da própria carteira.
-- Mantém a proteção de centro original para INSERT/UPDATE/DELETE.
begin;
do $$declare t text;p record;leitura text;begin
 foreach t in array array['pessoas','clientes'] loop
  select * into p from pg_policy where polrelid=format('public.%I',t)::regclass and polname='acesso_centro_restrito';
  if not found or p.polpermissive or p.polcmd not in('*','r') or p.polroles<>array['authenticated'::regrole::oid] then
   raise exception 'Revise a política de centro de % antes da fase338',t;end if;
  if p.polcmd='*' and pg_get_expr(p.polqual,p.polrelid)<>'usuario_pode_acessar_centro(centro_id)' then
   raise exception 'Política de centro customizada em %, preserve-a antes de instalar',t;end if;
  leitura:='public.usuario_pode_acessar_centro(centro_id) or (public.escopo_representante() and representante_id=public.meu_representante_id() and centro_id is null and not loja_pendente and exists(select 1 from public.meus_centros()))';
  if t='pessoas' then leitura:='public.usuario_pode_acessar_centro(centro_id) or (is_cliente and public.escopo_representante() and representante_id=public.meu_representante_id() and centro_id is null and not loja_pendente and exists(select 1 from public.meus_centros()))';end if;
  execute format('drop policy acesso_centro_restrito on public.%I',t);
  execute format('create policy acesso_centro_restrito on public.%I as restrictive for select to authenticated using (%s)',t,leitura);
  execute format('drop policy if exists acesso_centro_inserir_338 on public.%I',t);
  execute format('create policy acesso_centro_inserir_338 on public.%I as restrictive for insert to authenticated with check(public.usuario_pode_acessar_centro(centro_id))',t);
  execute format('drop policy if exists acesso_centro_editar_338 on public.%I',t);
  execute format('create policy acesso_centro_editar_338 on public.%I as restrictive for update to authenticated using(public.usuario_pode_acessar_centro(centro_id)) with check(public.usuario_pode_acessar_centro(centro_id))',t);
  execute format('drop policy if exists acesso_centro_excluir_338 on public.%I',t);
  execute format('create policy acesso_centro_excluir_338 on public.%I as restrictive for delete to authenticated using(public.usuario_pode_acessar_centro(centro_id))',t);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
