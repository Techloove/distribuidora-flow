-- Fase 87: eliminar escrita direta de dados da expedicao pela interface.
begin;

create or replace function public.atualizar_dados_expedicao(
  _id uuid,
  _transportadora_id uuid default null,
  _motorista text default null,
  _placa text default null,
  _previsao_entrega date default null,
  _volumes numeric default 1,
  _peso_kg numeric default 0,
  _rota_id uuid default null,
  _romaneio text default null,
  _observacoes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exp public.expedicoes;
begin
  if not public.can_ship(auth.uid()) then
    raise exception 'Sem permissao para atualizar expedicao';
  end if;

  select * into v_exp
  from public.expedicoes
  where id = _id
  for update;

  if v_exp.id is null then
    raise exception 'Expedicao nao encontrada';
  end if;

  if not public.usuario_pode_acessar_centro(v_exp.centro_id) then
    raise exception 'Expedicao pertence a outro centro';
  end if;

  if v_exp.status = 'entregue' then
    raise exception 'Expedicao entregue nao pode ter dados operacionais alterados';
  end if;

  if _volumes < 1 then
    raise exception 'Quantidade de volumes deve ser maior que zero';
  end if;

  if _peso_kg < 0 then
    raise exception 'Peso nao pode ser negativo';
  end if;

  if _transportadora_id is not null and not exists (
    select 1 from public.transportadoras t
    where t.id = _transportadora_id
  ) then
    raise exception 'Transportadora nao encontrada';
  end if;

  if _rota_id is not null and not exists (
    select 1 from public.rotas r
    where r.id = _rota_id and r.ativo = true
  ) then
    raise exception 'Rota invalida ou inativa';
  end if;

  update public.expedicoes
  set transportadora_id = _transportadora_id,
      motorista = nullif(trim(_motorista), ''),
      placa = nullif(upper(trim(_placa)), ''),
      previsao_entrega = _previsao_entrega,
      volumes = _volumes,
      peso_kg = _peso_kg,
      rota_id = _rota_id,
      romaneio = nullif(trim(_romaneio), ''),
      observacoes = nullif(trim(_observacoes), '')
  where id = _id;

  insert into public.auditoria(tabela, registro_id, acao, detalhe, user_id)
  values (
    'expedicoes', _id, 'expedicao_dados_atualizados',
    jsonb_build_object('status', v_exp.status), auth.uid()
  );
end;
$$;

revoke all on function public.atualizar_dados_expedicao(uuid,uuid,text,text,date,numeric,numeric,uuid,text,text) from public;
grant execute on function public.atualizar_dados_expedicao(uuid,uuid,text,text,date,numeric,numeric,uuid,text,text) to authenticated;

revoke insert, update, delete on public.expedicoes from anon, authenticated;

commit;
