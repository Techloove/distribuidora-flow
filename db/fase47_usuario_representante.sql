-- ============================================================
-- FASE 47 - Vinculo login <-> representante/vendedor
-- Reutiliza representantes.profile_id e pessoas.profile_id (ja existentes).
-- Nenhuma tabela nova. Idempotente.
-- ============================================================

begin;

-- vincula (ou desvincula, com _representante_id null) um usuario a um representante
create or replace function public.admin_vincular_representante(
  _user_id uuid,
  _representante_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _pessoa uuid;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Somente administradores podem vincular usuarios a representantes';
  end if;

  -- um login pertence a no maximo um representante
  update public.representantes set profile_id = null
   where profile_id = _user_id
     and (_representante_id is null or id <> _representante_id);

  update public.pessoas set profile_id = null
   where profile_id = _user_id
     and (_representante_id is null
          or id is distinct from (select pessoa_id from public.representantes where id = _representante_id));

  if _representante_id is not null then
    update public.representantes set profile_id = _user_id
     where id = _representante_id
    returning pessoa_id into _pessoa;

    if _pessoa is not null then
      update public.pessoas set profile_id = _user_id where id = _pessoa;
    end if;
  end if;
end;
$$;

grant execute on function public.admin_vincular_representante(uuid, uuid) to authenticated;

commit;

-- ---------- fim da fase 47 ----------
