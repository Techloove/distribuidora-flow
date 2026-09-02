-- =====================================================================
-- Fase 9 — Codigos sequenciais SOMENTE numericos em todos os cadastros
-- Rode INTEIRO no SQL Editor do Supabase (depois da fase 8).
-- Troca o padrao PREFIXO-000001 por 1, 2, 3, ... e reconverte os
-- registros ja existentes mantendo a ordem de criacao.
-- =====================================================================

create sequence if not exists public.seq_codigo_clientes as bigint start 1;
create sequence if not exists public.seq_codigo_produtos as bigint start 1;
create sequence if not exists public.seq_codigo_representantes as bigint start 1;
create sequence if not exists public.seq_codigo_fornecedores as bigint start 1;
create sequence if not exists public.seq_codigo_centros as bigint start 1;
create sequence if not exists public.seq_codigo_transportadoras as bigint start 1;

-- gera o proximo codigo numerico livre da tabela
create or replace function public.gerar_codigo()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  _seq    text := tg_argv[1];
  _cod    text;
  _existe boolean;
begin
  if new.codigo is not null and btrim(new.codigo) <> '' then
    return new;
  end if;

  loop
    _cod := nextval(_seq)::text;
    execute format('select exists (select 1 from public.%I where codigo = $1)', tg_table_name)
      into _existe using _cod;
    exit when not _existe;
  end loop;

  new.codigo := _cod;
  return new;
end $function$;

do $migra$
declare
  _t record;
  _max bigint;
begin
  for _t in
    select * from (values
      ('clientes','public.seq_codigo_clientes'),
      ('produtos','public.seq_codigo_produtos'),
      ('representantes','public.seq_codigo_representantes'),
      ('fornecedores','public.seq_codigo_fornecedores'),
      ('centros','public.seq_codigo_centros'),
      ('transportadoras','public.seq_codigo_transportadoras')
    ) as t(tabela, seq)
  loop
    if to_regclass('public.' || _t.tabela) is null then
      continue;
    end if;

    -- gatilho com o novo formato numerico
    execute format('drop trigger if exists trg_codigo_%s on public.%I', _t.tabela, _t.tabela);
    execute format(
      'create trigger trg_codigo_%s before insert on public.%I
         for each row execute function public.gerar_codigo(%L, %L)',
      _t.tabela, _t.tabela, '', _t.seq);

    -- renumera todos os registros: 1, 2, 3, ... na ordem de criacao
    execute format(
      'with ordenado as (
         select id, row_number() over (order by created_at nulls last, id) as n
           from public.%I
       )
       update public.%I t set codigo = o.n::text
         from ordenado o where o.id = t.id and t.codigo is distinct from o.n::text',
      _t.tabela, _t.tabela);

    -- alinha a sequencia com o maior numero em uso
    execute format(
      'select coalesce(max(nullif(regexp_replace(codigo, ''\D'', '''', ''g''), '''')::bigint), 0)
         from public.%I', _t.tabela)
      into _max;
    execute format('select setval(%L, greatest(%s, 1), %L)', _t.seq, _max, _max > 0);
  end loop;
end $migra$;

-- conferencia
select 'clientes' as tabela, codigo from public.clientes order by codigo::bigint limit 5;
