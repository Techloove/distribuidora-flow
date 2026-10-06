-- Grupo de produtos: cadastro único, igual à marca.
begin;

alter table public.produtos add column if not exists grupo text;

create table if not exists public.cad_grupos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  nome_norm text generated always as (public.norm_txt(nome)) stored,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists cad_grupos_norm_uq on public.cad_grupos(nome_norm);

grant select, insert, update, delete on public.cad_grupos to authenticated;
grant all on public.cad_grupos to service_role;
alter table public.cad_grupos enable row level security;

drop policy if exists cad_grupos_select on public.cad_grupos;
create policy cad_grupos_select on public.cad_grupos for select to authenticated
  using (public.usuario_ativo());
drop policy if exists cad_grupos_write on public.cad_grupos;
create policy cad_grupos_write on public.cad_grupos for all to authenticated
  using (public.usuario_ativo() and public.can_manage(auth.uid()))
  with check (public.usuario_ativo() and public.can_manage(auth.uid()));

-- Ao salvar o produto, o grupo usa o nome do cadastro (cria se não existir).
create or replace function public.trg_produto_grupo_f203()
returns trigger language plpgsql security definer set search_path = public as $$
declare n text; r text;
begin
  n := public.norm_txt(new.grupo);
  if n is null then new.grupo := null; return new; end if;
  select nome into r from public.cad_grupos where nome_norm = n;
  if r is null then
    insert into public.cad_grupos(nome) values (upper(btrim(new.grupo)))
    on conflict (nome_norm) do update set nome = public.cad_grupos.nome
    returning nome into r;
  end if;
  new.grupo := r;
  return new;
end $$;
revoke all on function public.trg_produto_grupo_f203() from public, anon, authenticated;

drop trigger if exists trg_produto_grupo on public.produtos;
create trigger trg_produto_grupo before insert or update of grupo on public.produtos
  for each row execute function public.trg_produto_grupo_f203();

-- Renomear o grupo atualiza todos os produtos.
create or replace function public.trg_grupo_renomear_f203()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.nome is distinct from old.nome then
    update public.produtos set grupo = new.nome where public.norm_txt(grupo) = old.nome_norm;
  end if;
  return new;
end $$;
revoke all on function public.trg_grupo_renomear_f203() from public, anon, authenticated;

drop trigger if exists zz_renomear on public.cad_grupos;
create trigger zz_renomear after update of nome on public.cad_grupos
  for each row execute function public.trg_grupo_renomear_f203();

commit;
