-- Fase 159: endurece search_path de helpers SECURITY INVOKER apontados pelo advisor do Supabase.
-- Nao altera regras de negocio; apenas fixa a resolucao de nomes no schema public.
begin;

do $$
declare
  sig text;
  r regprocedure;
  funcoes text[] := array[
    'public.compra_itens_total()',
    'public.set_updated_at()',
    'public.pedido_itens_total()',
    'public.sync_status_ativo()',
    'public.sincronizar_markup_produto()',
    'public.so_digitos(text)',
    'public.norm_cidade(text)',
    'public.rota_cidades_touch()',
    'public.trg_cad_produto()',
    'public.trg_cad_cidade()',
    'public.norm_txt(text)'
  ];
begin
  foreach sig in array funcoes loop
    r := to_regprocedure(sig);
    if r is not null then
      execute format('alter function %s set search_path = public', r);
    end if;
  end loop;
end $$;

commit;
