-- Fase 148: gate de reconciliacao da revisao externa/Codex.
-- Nao altera dados nem privilegios. Valida que os achados relevantes da revisao paralela
-- foram incorporados sem duplicar a arquitetura atual do ERP.
begin;

-- 1) Usuario precisa estar ativo e possuir papel.
do $$
declare
  r regprocedure := to_regprocedure('public.usuario_ativo()');
  def text;
begin
  if r is null then
    raise exception 'Fase 148: usuario_ativo() ausente';
  end if;

  select pg_get_functiondef(r::oid) into def;
  if position('profiles' in def) = 0
     or position('user_roles' in def) = 0
     or position('ativo' in def) = 0 then
    raise exception 'Fase 148: usuario_ativo() nao valida perfil ativo e papel';
  end if;

  if has_function_privilege('anon', r, 'EXECUTE') then
    raise exception 'Fase 148: anon executa usuario_ativo()';
  end if;
end $$;

-- 2) has_role precisa considerar perfil ativo.
do $$
declare
  r regprocedure := to_regprocedure('public.has_role(uuid,public.app_role)');
  def text;
begin
  if r is null then
    raise exception 'Fase 148: has_role(uuid,app_role) ausente';
  end if;

  select pg_get_functiondef(r::oid) into def;
  if position('profiles' in def) = 0 or position('ativo' in def) = 0 then
    raise exception 'Fase 148: has_role nao considera perfil ativo';
  end if;
end $$;

-- 3) Cadastro de usuario nao pode conceder papel implicitamente.
do $$
declare
  r regprocedure := to_regprocedure('public.handle_new_user()');
  def text;
  padrao text;
begin
  if r is null then
    raise exception 'Fase 148: handle_new_user() ausente';
  end if;

  select pg_get_functiondef(r::oid) into def;
  if position('user_roles' in def) > 0 then
    raise exception 'Fase 148: handle_new_user ainda atribui papel automaticamente';
  end if;

  select column_default
    into padrao
    from information_schema.columns
   where table_schema='public'
     and table_name='profiles'
     and column_name='todos_centros';

  if padrao is null or lower(padrao) not in ('false','false::boolean') then
    raise exception 'Fase 148: profiles.todos_centros nao possui default false';
  end if;

  if has_table_privilege('authenticated','public.profiles','INSERT') then
    raise exception 'Fase 148: authenticated ainda possui INSERT direto em profiles';
  end if;
end $$;

-- 4) Campos de autorizacao do perfil precisam de trigger de protecao.
do $$
begin
  if not exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public'
       and c.relname='profiles'
       and t.tgname='trg_proteger_campos_perfil'
       and not t.tgisinternal
       and t.tgenabled <> 'D'
  ) then
    raise exception 'Fase 148: trigger trg_proteger_campos_perfil ausente ou desabilitado';
  end if;
end $$;

-- 5) Papeis nao podem ser alterados diretamente pelo navegador.
do $$
begin
  if has_table_privilege('anon','public.user_roles','INSERT')
     or has_table_privilege('anon','public.user_roles','UPDATE')
     or has_table_privilege('anon','public.user_roles','DELETE')
     or has_table_privilege('authenticated','public.user_roles','INSERT')
     or has_table_privilege('authenticated','public.user_roles','UPDATE')
     or has_table_privilege('authenticated','public.user_roles','DELETE') then
    raise exception 'Fase 148: escrita direta em user_roles ainda liberada ao cliente';
  end if;
end $$;

-- 6) Views publicas comuns devem executar com privilegios do invocador.
do $$
declare
  v record;
begin
  for v in
    select c.relname, c.reloptions
      from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public'
       and c.relkind='v'
  loop
    if not ('security_invoker=true' = any(coalesce(v.reloptions,array[]::text[]))) then
      raise exception 'Fase 148: view public.% nao esta com security_invoker=true', v.relname;
    end if;
  end loop;
end $$;

-- 7) Reserva de emissao Sicredi deve ser server-only para evitar emissao externa duplicada.
do $$
declare
  r regprocedure := to_regprocedure('public.preparar_boleto_sicredi_servidor(uuid,uuid)');
begin
  if r is null then
    raise exception 'Fase 148: preparar_boleto_sicredi_servidor(uuid,uuid) ausente';
  end if;

  if has_function_privilege('anon', r, 'EXECUTE')
     or has_function_privilege('authenticated', r, 'EXECUTE') then
    raise exception 'Fase 148: reserva Sicredi exposta ao cliente';
  end if;

  if not has_function_privilege('service_role', r, 'EXECUTE') then
    raise exception 'Fase 148: service_role sem acesso a reserva Sicredi';
  end if;

  if to_regclass('public.boletos_conta_ativa_uq') is null then
    raise exception 'Fase 148: indice unico de boleto ativo por titulo ausente';
  end if;
end $$;

-- 8) Credenciais bancarias devem permanecer inacessiveis ao navegador.
do $$
begin
  if to_regclass('public.sicredi_config') is null then
    raise exception 'Fase 148: sicredi_config ausente';
  end if;

  if has_table_privilege('anon','public.sicredi_config','SELECT')
     or has_table_privilege('authenticated','public.sicredi_config','SELECT')
     or has_table_privilege('anon','public.sicredi_config','INSERT')
     or has_table_privilege('authenticated','public.sicredi_config','INSERT')
     or has_table_privilege('anon','public.sicredi_config','UPDATE')
     or has_table_privilege('authenticated','public.sicredi_config','UPDATE')
     or has_table_privilege('anon','public.sicredi_config','DELETE')
     or has_table_privilege('authenticated','public.sicredi_config','DELETE') then
    raise exception 'Fase 148: sicredi_config exposta ao cliente';
  end if;
end $$;

commit;
