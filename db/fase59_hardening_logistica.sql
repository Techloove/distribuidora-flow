-- Fase 59: endurecimento do isolamento por centro na logística.
-- Não substitui RLS existente; cria políticas apenas quando as tabelas existirem.
do $$
begin
  if to_regclass('public.expedicoes') is not null then
    alter table public.expedicoes enable row level security;
    drop policy if exists expedicoes_center_select on public.expedicoes;
    drop policy if exists expedicoes_select_auth on public.expedicoes;
    create policy expedicoes_center_select on public.expedicoes
      for select to authenticated
      using (public.usuario_pode_acessar_centro(centro_id));

    drop policy if exists expedicoes_center_update on public.expedicoes;
    drop policy if exists expedicoes_write_ship on public.expedicoes;
    create policy expedicoes_center_update on public.expedicoes
      for update to authenticated
      using (
        public.can_ship(auth.uid())
        and public.usuario_pode_acessar_centro(centro_id)
      )
      with check (public.usuario_pode_acessar_centro(centro_id));

    drop policy if exists expedicoes_center_insert on public.expedicoes;
    create policy expedicoes_center_insert on public.expedicoes
      for insert to authenticated
      with check (
        public.can_ship(auth.uid())
        and public.usuario_pode_acessar_centro(centro_id)
      );

    drop policy if exists expedicoes_center_delete on public.expedicoes;
    create policy expedicoes_center_delete on public.expedicoes
      for delete to authenticated
      using (
        public.can_ship(auth.uid())
        and public.usuario_pode_acessar_centro(centro_id)
      );
  end if;
end $;

create index if not exists expedicoes_centro_status_idx
  on public.expedicoes (centro_id, status)
  where centro_id is not null;


-- Transições de expedição são estritamente sequenciais no banco.
create or replace function public.avancar_expedicao(_id uuid, _status text, _data date default current_date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exp public.expedicoes;
  v_allowed boolean := false;
begin
  if not public.can_ship(auth.uid()) then
    raise exception 'Sem permissao para movimentar expedicoes';
  end if;

  select * into v_exp
  from public.expedicoes
  where id = _id
  for update;

  if v_exp.id is null then raise exception 'Expedicao nao encontrada'; end if;
  if not public.usuario_pode_acessar_centro(v_exp.centro_id) then
    raise exception 'Expedicao pertence a outro centro';
  end if;

  if v_exp.status = 'pendente' and _status = 'separacao' then v_allowed := true;
  elsif v_exp.status = 'separacao' and _status in ('em_rota','cancelada') then v_allowed := true;
  elsif v_exp.status = 'em_rota' and _status = 'entregue' then v_allowed := true;
  end if;

  if not v_allowed then
    raise exception 'Transicao de expedicao invalida: % -> %', v_exp.status, _status;
  end if;

  update public.expedicoes
  set status = _status,
      data_saida = case when _status = 'em_rota' then coalesce(_data,current_date) else data_saida end,
      data_entrega = case when _status = 'entregue' then coalesce(_data,current_date) else data_entrega end
  where id = _id;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('expedicoes', _id, 'expedicao_' || _status,
          jsonb_build_object('status_anterior',v_exp.status,'status',_status),auth.uid());
end;
$$;
grant execute on function public.avancar_expedicao(uuid,text,date) to authenticated;

create unique index if not exists expedicoes_pedido_ativa_uq
  on public.expedicoes(pedido_id)
  where status <> 'cancelada';
