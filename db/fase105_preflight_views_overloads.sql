-- Fase 105: preflight de views sensiveis e overloads legados.
-- Nao altera dados; aborta se encontrar caminho alternativo que possa contornar o perimetro atual.
begin;

-- Views sensiveis que existem devem executar com privilegios do chamador.
do $$
declare
  v text;
  relopts text[];
  views text[] := array[
    'vw_vendas_rota',
    'vw_vendas_rota_cidade',
    'vw_produtos_rota',
    'vw_vendas_representante_rota',
    'vw_conciliacao_creditos_dev'
  ];
begin
  foreach v in array views loop
    if to_regclass('public.' || v) is not null then
      select c.reloptions into relopts
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=v and c.relkind='v';

      if not ('security_invoker=true' = any(coalesce(relopts,array[]::text[]))) then
        raise exception 'Preflight: view publica %.% sem security_invoker=true', 'public', v;
      end if;
    end if;
  end loop;
end $$;

-- Nomes de RPC criticos nao devem manter assinaturas extras alem das explicitamente permitidas.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as assinatura, p.proname
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'transferir_estoque','confirmar_pedido','cancelar_pedido',
        'emitir_boleto','liquidar_boleto','aplicar_creditos_cliente_pedido',
        'atualizar_dados_expedicao'
      )
  loop
    if f.proname='transferir_estoque' and f.assinatura <> 'public.transferir_estoque(uuid,uuid,jsonb,text,text)'::regprocedure then
      raise exception 'Preflight: overload inesperado de transferir_estoque: %', f.assinatura;
    elsif f.proname='confirmar_pedido' and f.assinatura <> 'public.confirmar_pedido(uuid)'::regprocedure then
      raise exception 'Preflight: overload inesperado de confirmar_pedido: %', f.assinatura;
    elsif f.proname='cancelar_pedido' and f.assinatura <> 'public.cancelar_pedido(uuid)'::regprocedure then
      raise exception 'Preflight: overload inesperado de cancelar_pedido: %', f.assinatura;
    elsif f.proname='emitir_boleto' and f.assinatura <> 'public.emitir_boleto(uuid)'::regprocedure then
      raise exception 'Preflight: overload inesperado de emitir_boleto: %', f.assinatura;
    elsif f.proname='liquidar_boleto' and f.assinatura <> 'public.liquidar_boleto(uuid,numeric,date)'::regprocedure then
      raise exception 'Preflight: overload inesperado de liquidar_boleto: %', f.assinatura;
    elsif f.proname='aplicar_creditos_cliente_pedido' and f.assinatura <> 'public.aplicar_creditos_cliente_pedido(uuid,numeric,text)'::regprocedure then
      raise exception 'Preflight: overload inesperado de aplicar_creditos_cliente_pedido: %', f.assinatura;
    elsif f.proname='atualizar_dados_expedicao' and f.assinatura <> 'public.atualizar_dados_expedicao(uuid,uuid,text,text,date,numeric,numeric,uuid,text,text)'::regprocedure then
      raise exception 'Preflight: overload inesperado de atualizar_dados_expedicao: %', f.assinatura;
    end if;
  end loop;
end $$;

commit;
