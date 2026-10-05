-- Fase 202: a limpeza total também reinicia os códigos automáticos (voltam a 1).
-- As sequências seq_codigo_* não pertencem às colunas, então TRUNCATE ... RESTART IDENTITY
-- não as reinicia. Centros, formas de pagamento e categorias financeiras são mantidos.
begin;

create or replace function public.admin_reiniciar_codigos_f202()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s text;
begin
  foreach s in array array['seq_codigo_pessoa','seq_codigo_clientes','seq_codigo_produtos',
    'seq_codigo_representantes','seq_codigo_fornecedores','seq_codigo_transportadoras',
    'seq_codigo_rota','seq_codigo_conta_financeira','seq_codigo_onda']
  loop
    if to_regclass('public.' || s) is not null then
      execute format('select setval(%L, 1, false)', 'public.' || s);
    end if;
  end loop;
end;
$$;

revoke execute on function public.admin_reiniciar_codigos_f202() from public, anon, authenticated;
grant execute on function public.admin_reiniciar_codigos_f202() to service_role;

create or replace function public.admin_limpar_dados(_confirmacao text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  qtd int;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'Apenas administradores podem limpar os dados do sistema';
  end if;

  if btrim(coalesce(_confirmacao,'')) <> 'LIMPAR' then
    raise exception 'Confirmação inválida. Digite LIMPAR';
  end if;

  qtd := public.admin_limpar_dados_interno_f130(_confirmacao);
  perform public.admin_reiniciar_codigos_f202();
  return qtd;
end;
$$;

revoke execute on function public.admin_limpar_dados(text) from public, anon;
grant execute on function public.admin_limpar_dados(text) to authenticated, service_role;

-- Reinício imediato (a base já foi limpa).
select public.admin_reiniciar_codigos_f202();

commit;
