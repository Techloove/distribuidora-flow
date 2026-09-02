-- ============================================================
-- FASE 31 - Representante/comercial podem cadastrar pessoas
-- e clientes criados por representante ficam vinculados a ele.
-- Idempotente.
-- ============================================================

create or replace function public.pode_cadastrar_pessoa()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_manage(auth.uid())
      or public.has_role(auth.uid(), 'representante')
      or public.has_role(auth.uid(), 'comercial');
$$;

grant execute on function public.pode_cadastrar_pessoa() to authenticated;

-- ---------- pessoas: insert/update liberados ----------
drop policy if exists pessoas_insert_manage on public.pessoas;
create policy pessoas_insert_manage on public.pessoas
  for insert to authenticated
  with check (public.pode_cadastrar_pessoa());

drop policy if exists pessoas_update_manage on public.pessoas;
create policy pessoas_update_manage on public.pessoas
  for update to authenticated
  using (public.pode_cadastrar_pessoa())
  with check (public.pode_cadastrar_pessoa());

-- ---------- vincular ao representante logado ----------
create or replace function public.pessoa_definir_representante()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.representante_id is null and public.escopo_representante() then
    new.representante_id := public.meu_representante_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pessoa_definir_representante on public.pessoas;
create trigger trg_pessoa_definir_representante
before insert or update on public.pessoas
for each row execute function public.pessoa_definir_representante();

-- ---------- clientes: representante vê e edita a própria carteira ----------
drop policy if exists clientes_insert_manage on public.clientes;
create policy clientes_insert_manage on public.clientes
  for insert to authenticated
  with check (public.pode_cadastrar_pessoa());

drop policy if exists clientes_update_manage on public.clientes;
create policy clientes_update_manage on public.clientes
  for update to authenticated
  using (
    public.can_manage(auth.uid())
    or (public.pode_cadastrar_pessoa()
        and (not public.escopo_representante()
             or representante_id = public.meu_representante_id()))
  )
  with check (
    public.can_manage(auth.uid())
    or (public.pode_cadastrar_pessoa()
        and (not public.escopo_representante()
             or representante_id = public.meu_representante_id()))
  );
