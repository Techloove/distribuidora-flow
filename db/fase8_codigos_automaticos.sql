-- =====================================================================
-- Fase 8 — Códigos automáticos e sequenciais em todos os cadastros
-- Rode INTEIRO no SQL Editor do Supabase (depois das fases 1 a 7).
-- Gera codigo no padrao PREFIXO-000001 quando o campo vem vazio,
-- e preenche os registros antigos que estao sem codigo.
-- =====================================================================

create sequence if not exists public.seq_codigo_clientes as bigint start 1;
create sequence if not exists public.seq_codigo_produtos as bigint start 1;
create sequence if not exists public.seq_codigo_representantes as bigint start 1;
create sequence if not exists public.seq_codigo_fornecedores as bigint start 1;
create sequence if not exists public.seq_codigo_centros as bigint start 1;
create sequence if not exists public.seq_codigo_transportadoras as bigint start 1;

-- gera o proximo codigo livre da tabela (evita colidir com codigos já usados)
create or replace function public.gerar_codigo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _prefixo text := tg_argv[0];
  _seq     text := tg_argv[1];
  _cod     text;
  _existe  boolean;
begin
  if new.codigo is not null and btrim(new.codigo) <> '' then
    return new;
  end if;

  loop
    _cod := _prefixo || '-' || lpad(nextval(_seq)::text, 6, '0');
    execute format('select exists (select 1 from public.%I where codigo = $1)', tg_table_name)
      into _existe using _cod;
    exit when not _existe;
  end loop;

  new.codigo := _cod;
  return new;
end $$;

-- aplica o gatilho e alinha a sequencia com o maior numero já existente
do $$
declare
  _t record;
  _max bigint;
begin
  for _t in
    select * from (values
      ('clientes','CLI','public.seq_codigo_clientes'),
      ('produtos','PRD','public.seq_codigo_produtos'),
      ('representantes','REP','public.seq_codigo_representantes'),
      ('fornecedores','FOR','public.seq_codigo_fornecedores'),
      ('centros','CEN','public.seq_codigo_centros'),
      ('transportadoras','TRA','public.seq_codigo_transportadoras')
    ) as t(tabela, prefixo, seq)
  loop
    if to_regclass('public.' || _t.tabela) is null then
      continue;
    end if;

    execute format(
      'select coalesce(max(nullif(regexp_replace(codigo, ''\D'', '''', ''g''), '''')::bigint), 0)
         from public.%I where codigo like %L', _t.tabela, _t.prefixo || '-%')
      into _max;
    execute format('select setval(%L, greatest(%s, 1), %L)', _t.seq, _max, _max > 0);

    execute format('drop trigger if exists trg_codigo_%s on public.%I', _t.tabela, _t.tabela);
    execute format(
      'create trigger trg_codigo_%s before insert on public.%I
         for each row execute function public.gerar_codigo(%L, %L)',
      _t.tabela, _t.tabela, _t.prefixo, _t.seq);

    -- preenche registros antigos sem codigo
    execute format(
      'update public.%I set codigo = %L || ''-'' || lpad(nextval(%L)::text, 6, ''0'')
         where codigo is null or btrim(codigo) = ''''',
      _t.tabela, _t.prefixo, _t.seq);
  end loop;
end $$;
