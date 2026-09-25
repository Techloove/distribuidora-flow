-- Fase 100: incorpora hardening complementar identificado na revisão cruzada com Codex.
-- Fecha cadastro público, endurece helper de centro e aplica security_invoker às views.
begin;

do $$
begin
  if to_regclass('public.profiles') is not null then
    alter table public.profiles alter column todos_centros set default false;
    revoke insert on public.profiles from authenticated;
  end if;
end $$;

-- Novo cadastro cria somente o perfil. Papel de acesso deve ser atribuído por administrador.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, nome, email, todos_centros)
  values(new.id, coalesce(new.raw_user_meta_data->>'nome', ''), new.email, false)
  on conflict(id) do nothing;
  return new;
end;
$$;

-- Centros efetivamente acessíveis ao usuário autenticado e ativo.
create or replace function public.meus_centros()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.centros c
  where public.usuario_ativo()
    and (
      public.can_manage(auth.uid())
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and coalesce(p.todos_centros,false)
      )
      or exists (
        select 1 from public.usuario_centros uc
        where uc.user_id = auth.uid() and uc.centro_id = c.id
      )
    );
$$;

create or replace function public.usuario_pode_acessar_centro(_centro_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.usuario_ativo() and (
    (_centro_id is not null and _centro_id in (select public.meus_centros()))
    or (
      _centro_id is null
      and (
        public.can_manage(auth.uid())
        or exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and coalesce(p.todos_centros,false)
        )
      )
    )
  );
$$;

grant execute on function public.meus_centros() to authenticated;
grant execute on function public.usuario_pode_acessar_centro(uuid) to authenticated;
revoke execute on function public.meus_centros() from public, anon;
revoke execute on function public.usuario_pode_acessar_centro(uuid) from public, anon;

-- Representante não pode ampliar sua carteira pela tabela unificada de pessoas.
do $$
begin
  if to_regclass('public.pessoas') is not null then
    alter table public.pessoas enable row level security;
    drop policy if exists pessoas_carteira_restrita on public.pessoas;
    create policy pessoas_carteira_restrita
      on public.pessoas as restrictive for all to authenticated
      using (not public.escopo_representante() or representante_id = public.meu_representante_id())
      with check (not public.escopo_representante() or representante_id = public.meu_representante_id());
  end if;
end $$;

-- Views do schema público devem respeitar as permissões/RLS do chamador.
do $$
declare v record;
begin
  for v in
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind = 'v'
  loop
    execute format('alter view public.%I set (security_invoker = on)', v.relname);
  end loop;
end $$;

-- Índices de escopo usados com frequência.
do $$
begin
  if to_regclass('public.pedidos') is not null then
    create index if not exists pedidos_centro_data_idx on public.pedidos(centro_id, data_pedido desc);
    create index if not exists pedidos_representante_data_idx on public.pedidos(representante_id, data_pedido desc);
  end if;
  if to_regclass('public.pessoas') is not null then
    create index if not exists pessoas_representante_idx on public.pessoas(representante_id);
  end if;
end $$;

commit;