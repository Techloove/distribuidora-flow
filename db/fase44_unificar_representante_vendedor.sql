-- ============================================================
-- Fase 44 — Unificar cadastro de representante e vendedor
-- Um único cadastro (public.pessoas). A tabela public.representantes
-- passa a ser um espelho automático, mantida apenas porque é
-- referenciada por pedidos, comissões, metas, clientes etc.
-- Idempotente; preserva todos os dados existentes.
-- ============================================================

-- 1) Espelha a pessoa marcada como representante/vendedor em public.representantes
create or replace function public.sincronizar_representante_de_pessoa()
returns trigger language plpgsql security definer set search_path = public as $$
declare _rep_id uuid;
begin
  select id into _rep_id from public.representantes where pessoa_id = new.id;

  if new.is_representante then
    if _rep_id is null then
      -- tenta reaproveitar um representante antigo com o mesmo nome (evita duplicidade)
      select id into _rep_id
        from public.representantes
       where pessoa_id is null
         and lower(btrim(nome)) = lower(btrim(new.razao_social))
       limit 1;
    end if;

    if _rep_id is null then
      insert into public.representantes
        (pessoa_id, nome, email, telefone, regiao, comissao_percentual, centro_id, profile_id, ativo)
      values
        (new.id, new.razao_social, new.email, new.telefone, new.regiao,
         coalesce(new.comissao_percentual, 0), new.centro_id, new.profile_id,
         coalesce(new.ativo, true) and coalesce(new.status, 'ativo') = 'ativo');
    else
      update public.representantes set
        pessoa_id = new.id,
        nome = new.razao_social,
        email = new.email,
        telefone = new.telefone,
        regiao = new.regiao,
        comissao_percentual = coalesce(new.comissao_percentual, 0),
        centro_id = new.centro_id,
        profile_id = coalesce(new.profile_id, profile_id),
        ativo = coalesce(new.ativo, true) and coalesce(new.status, 'ativo') = 'ativo'
      where id = _rep_id;
    end if;
  elsif _rep_id is not null then
    -- deixou de ser vendedor: apenas inativa (preserva histórico e vínculos)
    update public.representantes set ativo = false where id = _rep_id;
  end if;

  return new;
end $$;

drop trigger if exists trg_pessoa_sincroniza_representante on public.pessoas;
create trigger trg_pessoa_sincroniza_representante
after insert or update of is_representante, razao_social, email, telefone, regiao,
  comissao_percentual, centro_id, profile_id, ativo, status
on public.pessoas
for each row execute function public.sincronizar_representante_de_pessoa();

-- 2) Vincula representantes existentes à pessoa de mesmo nome (quando houver)
update public.representantes r
   set pessoa_id = p.id
  from public.pessoas p
 where r.pessoa_id is null
   and lower(btrim(p.razao_social)) = lower(btrim(r.nome));

-- 3) Cria a pessoa correspondente para representantes que ainda não têm cadastro unificado
insert into public.pessoas
  (razao_social, tipo_pessoa, email, telefone, regiao, comissao_percentual,
   centro_id, profile_id, is_representante, ativo)
select r.nome, 'PF', r.email, r.telefone, r.regiao, r.comissao_percentual,
       r.centro_id, r.profile_id, true, r.ativo
  from public.representantes r
 where r.pessoa_id is null;

update public.representantes r
   set pessoa_id = p.id
  from public.pessoas p
 where r.pessoa_id is null
   and lower(btrim(p.razao_social)) = lower(btrim(r.nome));

-- 4) Garante espelho para pessoas já marcadas como representante
insert into public.representantes
  (pessoa_id, nome, email, telefone, regiao, comissao_percentual, centro_id, profile_id, ativo)
select p.id, p.razao_social, p.email, p.telefone, p.regiao,
       coalesce(p.comissao_percentual, 0), p.centro_id, p.profile_id,
       coalesce(p.ativo, true) and coalesce(p.status, 'ativo') = 'ativo'
  from public.pessoas p
 where p.is_representante
   and not exists (select 1 from public.representantes r where r.pessoa_id = p.id);

-- 5) Marca is_representante nas pessoas que já são espelho de um representante
update public.pessoas p
   set is_representante = true
  from public.representantes r
 where r.pessoa_id = p.id
   and p.is_representante = false;

-- 6) Descobre o representante (vendedor) de uma pessoa do cadastro unificado
create or replace function public.representante_da_pessoa(_pessoa_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.representantes where pessoa_id = _pessoa_id limit 1;
$$;
grant execute on function public.representante_da_pessoa(uuid) to authenticated;
