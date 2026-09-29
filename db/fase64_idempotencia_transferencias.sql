-- Fase 64: idempotencia de transferencias de estoque.
-- Repeticoes da mesma requisicao nao podem movimentar estoque duas vezes.

begin;

alter table public.transferencias_estoque
  add column if not exists chave_idempotencia text;

alter table public.transferencias_estoque
  add column if not exists idempotencia_contexto jsonb;

create unique index if not exists transferencias_estoque_idempotencia_uq
  on public.transferencias_estoque(chave_idempotencia)
  where chave_idempotencia is not null and btrim(chave_idempotencia) <> '';

create or replace function public.transferir_estoque(
  _origem_centro_id uuid,
  _destino_centro_id uuid,
  _itens jsonb,
  _observacao text default null,
  _chave_idempotencia text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transferencia_id uuid;
  v_item jsonb;
  v_produto uuid;
  v_qtd numeric(14,3);
  v_custo numeric(14,4);
  v_chave text := nullif(btrim(_chave_idempotencia), '');
begin
  if not public.can_stock(auth.uid()) then
    raise exception 'Sem permissão para transferir estoque';
  end if;

  if _origem_centro_id is null or _destino_centro_id is null
     or _origem_centro_id = _destino_centro_id then
    raise exception 'Informe centros de origem e destino diferentes';
  end if;

  if not public.usuario_pode_acessar_centro(_origem_centro_id)
     or not public.usuario_pode_acessar_centro(_destino_centro_id) then
    raise exception 'Usuário sem acesso aos centros da transferência';
  end if;

  if _itens is null or jsonb_typeof(_itens) <> 'array'
     or jsonb_array_length(_itens) = 0 then
    raise exception 'Informe ao menos um item';
  end if;

  if v_chave is not null then
    -- Serializa chamadas concorrentes que reutilizam a mesma chave antes de consultar/inserir.
    perform pg_advisory_xact_lock(hashtextextended('transferir_estoque:' || v_chave, 0));

    select id into v_transferencia_id
      from public.transferencias_estoque
     where chave_idempotencia = v_chave
     limit 1;

    if v_transferencia_id is not null then
      -- A mesma chave só pode repetir exatamente a mesma operação.
      if exists (
        select 1
        from public.transferencias_estoque
        where id = v_transferencia_id
          and (
            origem_centro_id is distinct from _origem_centro_id
            or destino_centro_id is distinct from _destino_centro_id
            or idempotencia_contexto is distinct from jsonb_build_object(
              'origem_centro_id', _origem_centro_id,
              'destino_centro_id', _destino_centro_id,
              'itens', _itens,
              'observacao', nullif(_observacao,'')
            )
          )
      ) then
        raise exception 'Chave de idempotencia ja utilizada em outra transferencia ou com payload diferente';
      end if;
      return v_transferencia_id;
    end if;
  end if;

  insert into public.transferencias_estoque
    (origem_centro_id, destino_centro_id, observacao, created_by, chave_idempotencia, idempotencia_contexto)
  values
    (_origem_centro_id, _destino_centro_id, nullif(_observacao,''), auth.uid(), v_chave,
     case when v_chave is not null then jsonb_build_object(
       'origem_centro_id', _origem_centro_id,
       'destino_centro_id', _destino_centro_id,
       'itens', _itens,
       'observacao', nullif(_observacao,'')
     ) else null end)
  returning id into v_transferencia_id;

  -- Ordem deterministica por produto reduz risco de deadlock entre transferencias concorrentes
  -- que movimentam o mesmo conjunto de produtos em ordens diferentes.
  for v_item in
    select value
    from jsonb_array_elements(_itens)
    order by value->>'produto_id'
  loop
    begin
      v_produto := (v_item->>'produto_id')::uuid;
      v_qtd := (v_item->>'quantidade')::numeric;
    exception when invalid_text_representation then
      raise exception 'Item de transferência possui produto ou quantidade inválidos';
    end;

    if v_produto is null or v_qtd is null or v_qtd <= 0 then
      raise exception 'Item de transferência inválido';
    end if;

    select coalesce(
      (select s.custo_medio
         from public.estoque_saldos s
        where s.produto_id=v_produto
          and s.centro_id=_origem_centro_id),
      p.custo_medio, 0
    )
    into v_custo
    from public.produtos p
    where p.id=v_produto
    for update;

    if not found then
      raise exception 'Produto % não encontrado', v_produto;
    end if;

    insert into public.transferencias_estoque_itens
      (transferencia_id, produto_id, quantidade, custo_unitario)
    values (v_transferencia_id, v_produto, v_qtd, v_custo);

    insert into public.estoque_movimentos
      (produto_id, centro_id, tipo, quantidade, custo_unitario, origem, documento_id, observacao, created_by)
    values
      (v_produto, _origem_centro_id, 'saida', v_qtd, v_custo, 'transferencia', v_transferencia_id, _observacao, auth.uid()),
      (v_produto, _destino_centro_id, 'entrada', v_qtd, v_custo, 'transferencia', v_transferencia_id, _observacao, auth.uid());
  end loop;

  return v_transferencia_id;

exception
  when unique_violation then
    if v_chave is not null then
      select id into v_transferencia_id
        from public.transferencias_estoque
       where chave_idempotencia=v_chave
       limit 1;
      if v_transferencia_id is not null then
        if exists (
          select 1
          from public.transferencias_estoque
          where id = v_transferencia_id
            and (
              origem_centro_id is distinct from _origem_centro_id
              or destino_centro_id is distinct from _destino_centro_id
              or idempotencia_contexto is distinct from jsonb_build_object(
                'origem_centro_id', _origem_centro_id,
                'destino_centro_id', _destino_centro_id,
                'itens', _itens,
                'observacao', nullif(_observacao,'')
              )
            )
        ) then
          raise exception 'Chave de idempotencia ja utilizada em outra transferencia ou com payload diferente';
        end if;
        return v_transferencia_id;
      end if;
    end if;
    raise;
end;
$$;

grant execute on function public.transferir_estoque(uuid,uuid,jsonb,text,text) to authenticated;

commit;

-- A mesma chave nao pode representar payloads diferentes; o contexto fica persistido para validacao de retries.
