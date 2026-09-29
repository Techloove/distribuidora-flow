-- Fase 71: perímetro financeiro e centros.
-- Fecha escrita direta em movimentos/transferências e impede uso de conta
-- financeira de outro centro em operações críticas.

begin;

create or replace function public.usuario_pode_acessar_conta_financeira(_conta_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_centro uuid;
begin
  if _conta_id is null then return false; end if;
  select centro_id into v_centro from public.contas_financeiras where id=_conta_id;
  if not found then return false; end if;
  if v_centro is null then return public.can_finance(auth.uid()); end if;
  return public.usuario_pode_acessar_centro(v_centro);
end;
$$;

revoke all on function public.usuario_pode_acessar_conta_financeira(uuid) from public;
grant execute on function public.usuario_pode_acessar_conta_financeira(uuid) to authenticated;

alter table public.movimentos_financeiros enable row level security;
alter table public.transferencias enable row level security;

drop policy if exists "movimentos_financeiros_write" on public.movimentos_financeiros;
create policy "movimentos_financeiros_write" on public.movimentos_financeiros
for insert to authenticated
with check (
  public.can_finance(auth.uid())
  and public.usuario_pode_acessar_conta_financeira(conta_id)
  and (
    centro_id is null
    or public.usuario_pode_acessar_centro(centro_id)
  )
);

drop policy if exists "movimentos_financeiros_update" on public.movimentos_financeiros;
create policy "movimentos_financeiros_update" on public.movimentos_financeiros
for update to authenticated
using (public.can_finance(auth.uid()) and public.usuario_pode_acessar_conta_financeira(conta_id))
with check (public.can_finance(auth.uid()) and public.usuario_pode_acessar_conta_financeira(conta_id));

drop policy if exists "movimentos_financeiros_delete" on public.movimentos_financeiros;

drop policy if exists "transferencias_write" on public.transferencias;
create policy "transferencias_write" on public.transferencias
for insert to authenticated
with check (
  public.can_finance(auth.uid())
  and public.usuario_pode_acessar_conta_financeira(conta_origem_id)
  and public.usuario_pode_acessar_conta_financeira(conta_destino_id)
);

drop policy if exists "transferencias_update" on public.transferencias;
create policy "transferencias_update" on public.transferencias
for update to authenticated
using (public.can_finance(auth.uid()))
with check (public.can_finance(auth.uid()));

drop policy if exists "transferencias_delete" on public.transferencias;

revoke insert, update, delete on public.movimentos_financeiros from authenticated;
revoke insert, update, delete on public.transferencias from authenticated;
grant select on public.movimentos_financeiros to authenticated;
grant select on public.transferencias to authenticated;

create or replace function public.transferir_entre_contas(
  _origem uuid, _destino uuid, _valor numeric,
  _data date default current_date, _historico text default null
) returns public.transferencias
language plpgsql security definer set search_path=public
as $$
declare
  t public.transferencias;
  oc uuid;
  dc uuid;
begin
  if not public.can_finance(auth.uid()) then raise exception 'Sem permissão para transferir valores'; end if;
  if _origem is null or _destino is null or _origem=_destino then
    raise exception 'Escolha contas diferentes';
  end if;
  if coalesce(_valor,0)<=0 then raise exception 'Informe um valor maior que zero'; end if;

  select centro_id into oc from public.contas_financeiras where id=_origem and ativo;
  if not found then raise exception 'Conta de origem não encontrada ou inativa'; end if;
  select centro_id into dc from public.contas_financeiras where id=_destino and ativo;
  if not found then raise exception 'Conta de destino não encontrada ou inativa'; end if;

  if oc is not null and not public.usuario_pode_acessar_centro(oc) then
    raise exception 'Sem acesso ao centro da conta de origem';
  end if;
  if dc is not null and not public.usuario_pode_acessar_centro(dc) then
    raise exception 'Sem acesso ao centro da conta de destino';
  end if;
  if oc is distinct from dc then
    raise exception 'As contas devem pertencer ao mesmo centro ou ambas serem contas globais';
  end if;

  insert into public.transferencias
    (conta_origem_id,conta_destino_id,valor,data,historico,created_by)
  values
    (_origem,_destino,_valor,coalesce(_data,current_date),nullif(_historico,''),auth.uid())
  returning * into t;

  insert into public.movimentos_financeiros
    (conta_id,data,tipo,origem,valor,transferencia_id,centro_id,descricao,created_by)
  values
    (_origem,t.data,'saida','transferencia',t.valor,t.id,oc,
     coalesce(t.historico,'Transferência entre contas'),auth.uid()),
    (_destino,t.data,'entrada','transferencia',t.valor,t.id,dc,
     coalesce(t.historico,'Transferência entre contas'),auth.uid());

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('transferencias',t.id,'transferir',
         jsonb_build_object('origem',_origem,'destino',_destino,
                            'valor',t.valor,'centro_id',oc),auth.uid());
  return t;
end;
$$;

create or replace function public.lancar_movimento(
  _conta_id uuid,_tipo text,_valor numeric,
  _data date default current_date,_categoria_id uuid default null,
  _centro_id uuid default null,_descricao text default null,_documento text default null
) returns public.movimentos_financeiros
language plpgsql security definer set search_path=public
as $$
declare
  m public.movimentos_financeiros;
  conta_centro uuid;
  centro_final uuid;
begin
  if not public.can_finance(auth.uid()) then raise exception 'Sem permissão para lançar movimentações'; end if;
  if _tipo not in ('entrada','saida') then raise exception 'Tipo inválido'; end if;
  if coalesce(_valor,0)<=0 then raise exception 'Informe um valor maior que zero'; end if;

  select centro_id into conta_centro from public.contas_financeiras
   where id=_conta_id and ativo;
  if not found then raise exception 'Conta financeira não encontrada ou inativa'; end if;

  centro_final:=coalesce(_centro_id,conta_centro);
  if centro_final is not null and not public.usuario_pode_acessar_centro(centro_final) then
    raise exception 'Sem acesso ao centro informado';
  end if;
  if conta_centro is not null and centro_final is distinct from conta_centro then
    raise exception 'Centro da movimentação deve coincidir com o centro da conta';
  end if;

  insert into public.movimentos_financeiros
    (conta_id,data,tipo,origem,valor,categoria_id,centro_id,descricao,documento,created_by)
  values
    (_conta_id,coalesce(_data,current_date),_tipo,
     case when _tipo='entrada' then 'receita' else 'despesa' end,
     _valor,_categoria_id,centro_final,nullif(_descricao,''),nullif(_documento,''),auth.uid())
  returning * into m;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('movimentos_financeiros',m.id,'lancar',
         jsonb_build_object('tipo',_tipo,'valor',_valor,
                            'conta_id',_conta_id,'centro_id',centro_final),auth.uid());
  return m;
end;
$$;

-- Reforça que baixa de título não pode movimentar conta de outro centro.
create or replace function public.receber_titulo(
  _id uuid,_valor numeric,_data date default current_date,
  _conta_id uuid default null,_forma_id uuid default null,
  _juros numeric default 0,_multa numeric default 0,_desconto numeric default 0,
  _observacao text default null
) returns public.contas_receber
language plpgsql security definer set search_path=public
as $$
declare
  titulo public.contas_receber;
  pago numeric(14,2);
  devido numeric(14,2);
  conta uuid;
  conta_centro uuid;
begin
  if not public.can_finance(auth.uid()) then raise exception 'Somente financeiro/gestor pode receber títulos'; end if;
  if coalesce(_valor,0)<=0 then raise exception 'Informe um valor maior que zero'; end if;

  select * into titulo from public.contas_receber where id=_id for update;
  if titulo.id is null then raise exception 'Título não encontrado'; end if;
  if titulo.centro_id is null then raise exception 'Título sem centro'; end if;
  if not public.usuario_pode_acessar_centro(titulo.centro_id) then raise exception 'Título pertence a outro centro'; end if;
  if titulo.status in ('cancelado','pago') then raise exception 'Título não pode ser baixado no status atual'; end if;

  conta:=coalesce(_conta_id,titulo.conta_financeira_id,
    (select id from public.contas_financeiras where ativo and (centro_id is null or centro_id=titulo.centro_id) order by created_at limit 1));
  if conta is null then raise exception 'Cadastre uma conta de banco/caixa para o centro antes de receber'; end if;

  select centro_id into conta_centro from public.contas_financeiras where id=conta and ativo;
  if not found then raise exception 'Conta financeira não encontrada ou inativa'; end if;
  if conta_centro is not null and conta_centro<>titulo.centro_id then raise exception 'Conta pertence a outro centro'; end if;

  if coalesce(_juros,0)<0 or coalesce(_multa,0)<0 or coalesce(_desconto,0)<0 then
    raise exception 'Juros, multa e desconto não podem ser negativos';
  end if;

  update public.contas_receber
     set juros=juros+coalesce(_juros,0), multa=multa+coalesce(_multa,0),
         desconto=desconto+coalesce(_desconto,0)
   where id=_id returning * into titulo;

  devido:=titulo.valor+titulo.juros+titulo.multa+titulo.acrescimo-titulo.desconto;
  if _valor>greatest(devido-coalesce(titulo.valor_pago,0),0) then
    raise exception 'Valor da baixa excede o saldo do título';
  end if;
  pago:=coalesce(titulo.valor_pago,0)+_valor;

  update public.contas_receber
     set valor_pago=pago,conta_financeira_id=conta,
         forma_pagamento_id=coalesce(_forma_id,forma_pagamento_id),
         data_pagamento=case when pago>=devido then coalesce(_data,current_date) else data_pagamento end,
         status=case when pago>=devido then 'pago' when pago>0 then 'parcial' else 'aberto' end,
         observacao=coalesce(nullif(_observacao,''),observacao)
   where id=_id returning * into titulo;

  insert into public.movimentos_financeiros
    (conta_id,data,tipo,origem,valor,centro_id,forma_pagamento_id,conta_receber_id,categoria_id,descricao,documento,created_by)
  values
    (conta,coalesce(_data,current_date),'entrada','recebimento',_valor,titulo.centro_id,
     coalesce(_forma_id,titulo.forma_pagamento_id),titulo.id,
     coalesce(titulo.categoria_id,(select id from public.categorias_financeiras
       where tipo='receita' and grupo_dre='receita_bruta' and parent_id is null order by ordem limit 1)),
     'Recebimento '||coalesce(titulo.documento,'titulo')||' parcela '||coalesce(titulo.parcela,1)::text,
     titulo.documento,auth.uid());

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('contas_receber',_id,'baixa',
         jsonb_build_object('valor',_valor,'pago_depois',pago,'conta_id',conta),auth.uid());
  return titulo;
end;
$$;

grant execute on function public.transferir_entre_contas(uuid,uuid,numeric,date,text) to authenticated;
grant execute on function public.lancar_movimento(uuid,text,numeric,date,uuid,uuid,text,text) to authenticated;
grant execute on function public.receber_titulo(uuid,numeric,date,uuid,uuid,numeric,numeric,numeric,text) to authenticated;

commit;
