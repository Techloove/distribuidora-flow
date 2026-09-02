-- ============================================================
-- FASE 22 - vincula pessoas.representante_id ao registro criado
-- pelo gatilho de sincronizacao do cadastro unificado
-- ============================================================

create or replace function public.vincular_representante_pessoa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _rep uuid;
begin
  select id into _rep from public.representantes where pessoa_id = new.id limit 1;

  if new.is_representante and _rep is not null and new.representante_id is distinct from _rep then
    update public.pessoas set representante_id = _rep where id = new.id;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_vincular_representante_pessoa on public.pessoas;
create trigger trg_vincular_representante_pessoa
after insert or update of is_representante on public.pessoas
for each row execute function public.vincular_representante_pessoa();

-- alinhar registros existentes
update public.pessoas p
   set representante_id = r.id
  from public.representantes r
 where r.pessoa_id = p.id
   and p.is_representante
   and p.representante_id is distinct from r.id;

-- ---------- fim da fase 22 ----------
