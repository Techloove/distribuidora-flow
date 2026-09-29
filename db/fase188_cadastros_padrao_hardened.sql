-- Fase 188: reconciliacao segura dos cadastros padrao adicionados na main.
-- Categoria, marca e cidade passam a ter cadastro mestre sem reabrir RPCs/trigger functions ao cliente.
begin;

create or replace function public.norm_txt(t text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    lower(
      translate(
        btrim(regexp_replace(coalesce(t,''), '\s+', ' ', 'g')),
        'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
        'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'
      )
    ),
    ''
  )
$$;

create table if not exists public.cad_categorias (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  nome_norm text generated always as (public.norm_txt(nome)) stored,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists cad_categorias_norm_uq on public.cad_categorias(nome_norm);

create table if not exists public.cad_marcas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  nome_norm text generated always as (public.norm_txt(nome)) stored,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists cad_marcas_norm_uq on public.cad_marcas(nome_norm);

create table if not exists public.cad_cidades (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  uf text not null default '',
  codigo_ibge text,
  nome_norm text generated always as (public.norm_txt(nome)) stored,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists cad_cidades_norm_uq on public.cad_cidades(nome_norm, uf);

grant select, insert, update, delete on public.cad_categorias, public.cad_marcas, public.cad_cidades to authenticated;
grant all on public.cad_categorias, public.cad_marcas, public.cad_cidades to service_role;

do $$
declare t text;
begin
  foreach t in array array['cad_categorias','cad_marcas','cad_cidades'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.usuario_ativo())',
      t || '_select', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.usuario_ativo() and public.can_manage(auth.uid())) with check (public.usuario_ativo() and public.can_manage(auth.uid()))',
      t || '_write', t
    );
  end loop;
end $$;

create or replace function public.cad_resolver(_tipo text, _nome text, _uf text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n text := public.norm_txt(_nome);
  r text;
  u text := upper(coalesce(btrim(_uf),''));
begin
  if n is null then return null; end if;

  if _tipo = 'categoria' then
    select nome into r from public.cad_categorias where nome_norm = n;
    if r is null then
      insert into public.cad_categorias(nome) values (btrim(_nome))
      on conflict (nome_norm) do update set nome = public.cad_categorias.nome
      returning nome into r;
    end if;
  elsif _tipo = 'marca' then
    select nome into r from public.cad_marcas where nome_norm = n;
    if r is null then
      insert into public.cad_marcas(nome) values (btrim(_nome))
      on conflict (nome_norm) do update set nome = public.cad_marcas.nome
      returning nome into r;
    end if;
  elsif _tipo = 'cidade' then
    select nome into r from public.cad_cidades where nome_norm = n and uf = u;
    if r is null then
      insert into public.cad_cidades(nome, uf) values (btrim(_nome), u)
      on conflict (nome_norm, uf) do update set nome = public.cad_cidades.nome
      returning nome into r;
    end if;
  else
    raise exception 'Tipo de cadastro padrao invalido';
  end if;

  return r;
end;
$$;

revoke all on function public.cad_resolver(text,text,text) from public, anon, authenticated;

create or replace function public.trg_cad_produto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.categoria := public.cad_resolver('categoria', new.categoria);
  new.marca := public.cad_resolver('marca', new.marca);
  return new;
end;
$$;

create or replace function public.trg_cad_cidade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.uf := nullif(upper(btrim(coalesce(new.uf,''))), '');
  new.cidade := public.cad_resolver('cidade', new.cidade, new.uf);
  return new;
end;
$$;

revoke all on function public.trg_cad_produto() from public, anon, authenticated;
revoke all on function public.trg_cad_cidade() from public, anon, authenticated;

-- Backfill de categorias e marcas existentes.
insert into public.cad_categorias(nome)
select distinct on (public.norm_txt(categoria)) btrim(categoria)
from public.produtos
where public.norm_txt(categoria) is not null
order by public.norm_txt(categoria), btrim(categoria)
on conflict do nothing;

insert into public.cad_marcas(nome)
select distinct on (public.norm_txt(marca)) btrim(marca)
from public.produtos
where public.norm_txt(marca) is not null
order by public.norm_txt(marca), btrim(marca)
on conflict do nothing;

-- Cidades: registra somente tabelas/colunas realmente existentes.
do $$
declare
  t text;
begin
  foreach t in array array['pessoas','clientes','fornecedores','transportadoras','centros','empresas','rota_cidades'] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='cidade'
    ) or not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='uf'
    ) then
      continue;
    end if;

    execute format(
      'insert into public.cad_cidades(nome,uf)
       select distinct on (public.norm_txt(cidade), upper(coalesce(btrim(uf),'''')))
              btrim(cidade), upper(coalesce(btrim(uf),''''))
       from public.%I
       where public.norm_txt(cidade) is not null
       order by public.norm_txt(cidade), upper(coalesce(btrim(uf),'''')), btrim(cidade)
       on conflict do nothing',
      t
    );
  end loop;
end $$;

drop trigger if exists aa_cad_produto on public.produtos;
create trigger aa_cad_produto
before insert or update of categoria, marca on public.produtos
for each row execute function public.trg_cad_produto();

update public.produtos
set categoria = categoria, marca = marca
where categoria is not null or marca is not null;

do $$
declare
  t text;
begin
  foreach t in array array['pessoas','clientes','fornecedores','transportadoras','centros','empresas','rota_cidades'] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='cidade'
    ) or not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='uf'
    ) then
      continue;
    end if;

    execute format('drop trigger if exists aa_cad_cidade on public.%I', t);
    execute format(
      'create trigger aa_cad_cidade before insert or update of cidade, uf on public.%I for each row execute function public.trg_cad_cidade()',
      t
    );
    execute format('update public.%I set cidade = cidade where cidade is not null', t);
  end loop;
end $$;

create or replace function public.trg_cad_renomear()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
begin
  if new.nome is not distinct from old.nome then return new; end if;

  if tg_table_name = 'cad_categorias' then
    update public.produtos
    set categoria = new.nome
    where public.norm_txt(categoria) = old.nome_norm;
  elsif tg_table_name = 'cad_marcas' then
    update public.produtos
    set marca = new.nome
    where public.norm_txt(marca) = old.nome_norm;
  else
    foreach t in array array['pessoas','clientes','fornecedores','transportadoras','centros','empresas','rota_cidades'] loop
      if to_regclass('public.' || t) is null then continue; end if;
      if not exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name=t and column_name='cidade'
      ) or not exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name=t and column_name='uf'
      ) then
        continue;
      end if;
      execute format(
        'update public.%I set cidade = $1 where public.norm_txt(cidade) = $2 and coalesce(uf,'''') = $3',
        t
      ) using new.nome, old.nome_norm, old.uf;
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function public.trg_cad_renomear() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['cad_categorias','cad_marcas','cad_cidades'] loop
    execute format('drop trigger if exists zz_renomear on public.%I', t);
    execute format(
      'create trigger zz_renomear after update of nome on public.%I for each row execute function public.trg_cad_renomear()',
      t
    );
  end loop;
end $$;

commit;
