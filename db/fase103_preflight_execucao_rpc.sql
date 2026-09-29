-- Fase 103: preflight do perimetro de EXECUTE das RPCs criticas.
-- Diagnostico estrito: nao altera dados; aborta se houver exposicao indevida.
begin;

do $$
declare
  sig text;
  r regprocedure;
  funcoes text[] := array[
    'public.lancar_movimento_estoque(uuid,uuid,text,numeric,numeric,text,uuid,text)',
    'public.transferir_estoque(uuid,uuid,jsonb,text,text)',
    'public.receber_compra(uuid)',
    'public.confirmar_pedido(uuid)',
    'public.receber_titulo(uuid,numeric,date,uuid,uuid,numeric,numeric,numeric,text)',
    'public.pagar_titulo(uuid,numeric,date,uuid,uuid,numeric,numeric,numeric,text)',
    'public.pagar_comissoes(uuid,uuid[],date,uuid,uuid,uuid,text)',
    'public.criar_despesa(uuid,uuid,uuid,text,text,numeric,integer,date,integer,uuid,uuid)',
    'public.cancelar_titulo(text,uuid,text)',
    'public.transferir_entre_contas(uuid,uuid,numeric,date,text)',
    'public.lancar_movimento(uuid,text,numeric,date,uuid,uuid,text,text)',
    'public.emitir_boleto(uuid)',
    'public.liquidar_boleto(uuid,numeric,date)',
    'public.estornar_movimento_financeiro(uuid,text)',
    'public.estornar_transferencia_financeira(uuid,text)',
    'public.atualizar_status_comissao(uuid,text)',
    'public.criar_credito_devolucao(uuid,uuid,uuid,numeric,text)',
    'public.aplicar_credito_cliente(uuid,uuid,numeric,text)',
    'public.aplicar_creditos_cliente_pedido(uuid,numeric,text)',
    'public.cancelar_aplicacao_credito(uuid)',
    'public.confirmar_devolucao(uuid)',
    'public.cancelar_devolucao(uuid)',
    'public.cancelar_pedido(uuid)',
    'public.migrar_credito_dev(uuid)',
    'public.criar_pedido_rascunho(uuid,uuid,uuid,uuid,date,text,uuid,date)',
    'public.atualizar_pedido_comercial(uuid,uuid,numeric,numeric,numeric)',
    'public.adicionar_item_pedido(uuid,uuid,numeric,numeric,numeric)',
    'public.atualizar_item_pedido(uuid,numeric,numeric,numeric)',
    'public.remover_item_pedido(uuid)',
    'public.atualizar_dados_expedicao(uuid,uuid,text,text,date,numeric,numeric,uuid,text,text)'
  ];
begin
  foreach sig in array funcoes loop
    r := to_regprocedure(sig);
    if r is null then
      raise exception 'Preflight EXECUTE: RPC obrigatoria ausente: %', sig;
    end if;

    if exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = r::oid
        and a.grantee = 0
        and a.privilege_type = 'EXECUTE'
    ) then
      raise exception 'Preflight EXECUTE: PUBLIC ainda executa %', r;
    end if;

    if has_function_privilege('anon', r, 'EXECUTE') then
      raise exception 'Preflight EXECUTE: anon ainda executa %', r;
    end if;

    if not has_function_privilege('authenticated', r, 'EXECUTE') then
      raise exception 'Preflight EXECUTE: authenticated sem EXECUTE em %', r;
    end if;
  end loop;
end $$;

-- Helpers internos nunca devem ser chamaveis diretamente pelo cliente.
do $$
declare
  sig text;
  r regprocedure;
  internos text[] := array[
    'public.restaurar_creditos_cancelamento_pedido(uuid)',
    'public.registrar_movimento_estoque_controlado(uuid,uuid,text,numeric,numeric,text,uuid,text)'
  ];
begin
  foreach sig in array internos loop
    r := to_regprocedure(sig);
    if r is not null and (
      exists (
        select 1
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = r::oid
          and a.grantee = 0
          and a.privilege_type = 'EXECUTE'
      )
      or has_function_privilege('anon', r, 'EXECUTE')
      or has_function_privilege('authenticated', r, 'EXECUTE')
    ) then
      raise exception 'Preflight EXECUTE: helper interno exposto ao cliente: %', r;
    end if;
  end loop;
end $$;

-- Assinaturas legadas conhecidas nao podem permanecer acessiveis.
do $$
declare
  r regprocedure;
begin
  r := to_regprocedure('public.transferir_estoque(uuid,uuid,jsonb,text)');
  if r is not null then
    raise exception 'Preflight EXECUTE: assinatura legada de transferir_estoque ainda existe: %', r;
  end if;

  r := to_regprocedure('public.criar_pedido_rascunho(uuid,uuid,uuid,uuid,date,text,uuid)');
  if r is not null and (
    exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = r::oid
        and a.grantee = 0
        and a.privilege_type = 'EXECUTE'
    )
    or has_function_privilege('anon', r, 'EXECUTE')
    or has_function_privilege('authenticated', r, 'EXECUTE')
  ) then
    raise exception 'Preflight EXECUTE: assinatura legada de criar_pedido_rascunho ainda acessivel: %', r;
  end if;
end $$;

commit;
