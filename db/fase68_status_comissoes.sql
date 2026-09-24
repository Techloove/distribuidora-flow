-- Fase 68: centralizar alteracao de status de comissoes.
-- Evita que o frontend altere diretamente o status financeiro da comissao.

begin;

create or replace function public.atualizar_status_comissao(
  _comissao_id uuid,
  _status text
)
returns public.comissoes
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.comissoes;
  centro uuid;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Sem permissao para alterar comissoes';
  end if;

  if _status not in ('prevista','liberada','paga','cancelada') then
    raise exception 'Status de comissao invalido';
  end if;

  select * into c
    from public.comissoes
   where id = _comissao_id
   for update;

  if c.id is null then
    raise exception 'Comissao nao encontrada';
  end if;

  select p.centro_id into centro
    from public.pedidos p
   where p.id = c.pedido_id;

  if centro is not null and not public.usuario_pode_acessar_centro(centro) then
    raise exception 'Comissao pertence a outro centro';
  end if;

  if c.status = 'cancelada' and _status <> 'cancelada' then
    raise exception 'Comissao cancelada nao pode ser reaberta';
  end if;

  if c.status = 'paga' and _status <> 'paga' then
    raise exception 'Comissao paga nao pode retornar de status';
  end if;

  if c.status = 'prevista' and _status not in ('prevista','liberada','cancelada') then
    raise exception 'Transicao de comissao invalida';
  end if;

  if c.status = 'liberada' and _status not in ('liberada','paga','cancelada') then
    raise exception 'Transicao de comissao invalida';
  end if;

  update public.comissoes
     set status = _status
   where id = _comissao_id
   returning * into c;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values(
    'comissoes',
    _comissao_id,
    'alterar_status',
    jsonb_build_object('status_anterior', c.status, 'status_novo', _status),
    auth.uid()
  );

  return c;
end;
$$;

grant execute on function public.atualizar_status_comissao(uuid,text) to authenticated;

commit;
