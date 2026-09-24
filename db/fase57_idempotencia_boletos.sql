-- Fase 57: idempotência e concorrência de boletos.
-- Evita registros duplicados para o mesmo "seu número" e serializa emissão/liquidação.

create unique index if not exists boletos_banco_seu_numero_uq
  on public.boletos (banco, seu_numero)
  where seu_numero is not null and btrim(seu_numero) <> '';

create or replace function public.emitir_boleto(_conta_id uuid)
returns public.boletos
language plpgsql
security definer
set search_path = public
as $$
declare
  cr record;
  b public.boletos;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissão para emitir boletos';
  end if;

  select *
    into cr
    from public.contas_receber
   where id = _conta_id
   for update;

  if cr is null then
    raise exception 'Título não encontrado';
  end if;

  if cr.centro_id is null then
    raise exception 'O título não possui centro definido';
  end if;

  if not public.usuario_pode_acessar_centro(cr.centro_id) then
    raise exception 'Usuário sem acesso ao centro do título';
  end if;

  if exists (
    select 1
      from public.boletos
     where conta_receber_id = _conta_id
       and status in ('pendente','registrado','liquidado')
  ) then
    raise exception 'Já existe boleto ativo para este título';
  end if;

  insert into public.boletos
    (conta_receber_id, cliente_id, centro_id, seu_numero, valor, vencimento, created_by)
  values
    (_conta_id,
     cr.cliente_id,
     cr.centro_id,
     cr.documento || '/' || cr.parcela,
     greatest(cr.valor - coalesce(cr.valor_pago, 0), 0),
     cr.vencimento,
     auth.uid())
  returning * into b;

  insert into public.auditoria
    (tabela, registro_id, acao, detalhe, user_id)
  values
    ('boletos', b.id, 'emitir',
     jsonb_build_object('valor', b.valor, 'centro_id', b.centro_id),
     auth.uid());

  return b;
exception
  when unique_violation then
    raise exception 'Já existe boleto para este número do título';
end;
$$;

create or replace function public.liquidar_boleto(
  _boleto_id uuid,
  _valor numeric,
  _data date default current_date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.boletos;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissão para conciliar boletos';
  end if;

  if _valor is null or _valor <= 0 then
    raise exception 'Valor de liquidação deve ser maior que zero';
  end if;

  select *
    into b
    from public.boletos
   where id = _boleto_id
   for update;

  if b is null then
    raise exception 'Boleto não encontrado';
  end if;

  if not public.usuario_pode_acessar_centro(b.centro_id) then
    raise exception 'Usuário sem acesso ao centro do boleto';
  end if;

  if b.status in ('baixado','cancelado') then
    raise exception 'Boleto já baixado ou cancelado';
  end if;

  update public.boletos
     set status = 'liquidado',
         valor_liquidado = _valor,
         data_liquidacao = _data
   where id = _boleto_id;

  if b.conta_receber_id is not null then
    perform public.baixar_receber(b.conta_receber_id, _valor, _data);
  end if;

  insert into public.auditoria
    (tabela, registro_id, acao, detalhe, user_id)
  values
    ('boletos', b.id, 'liquidar',
     jsonb_build_object('valor', _valor, 'data', _data),
     auth.uid());
end;
$$;

grant execute on function public.emitir_boleto(uuid) to authenticated;
grant execute on function public.liquidar_boleto(uuid, numeric, date) to authenticated;
