-- ============================================================
-- Fase 43 — Permitir incluir pedidos na carga sem nota fiscal
-- (configuração sim/não separada do boleto)
-- Idempotente; preserva todos os dados existentes.
-- ============================================================

-- 1) Novo parâmetro: exigir NF autorizada para incluir pedido na carga
insert into public.parametros (chave, valor, descricao)
select 'exigir_nf_carga', 'true', 'Exigir nota fiscal autorizada para incluir pedido na carga (true/false)'
where not exists (select 1 from public.parametros where chave = 'exigir_nf_carga');

-- 2) Redefine adicionar_pedido_carga para usar exigir_nf_carga (e não exigir_nf_boleto)
create or replace function public.adicionar_pedido_carga(_carga_id uuid, _pedido_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c record; ped record; msg text;
  exige boolean := coalesce((select valor from public.parametros where chave='exigir_nf_carga'), 'true') = 'true';
begin
  if not public.can_ship(auth.uid()) then
    raise exception 'Sem permissão para montar cargas';
  end if;
  select * into c from public.cargas where id = _carga_id for update;
  if c.id is null then raise exception 'Carga não encontrada'; end if;
  if c.status not in ('aberta','em_preparacao') then
    raise exception 'A carga já foi fechada';
  end if;

  select * into ped from public.pedidos where id = _pedido_id;
  if ped.id is null then raise exception 'Pedido não encontrado'; end if;

  msg := public.bloqueio_faturamento(_pedido_id);
  if msg is not null then
    raise exception 'Pedido % não pode entrar na carga: %', ped.numero, msg;
  end if;
  if ped.status not in ('faturado','nf_emitida') then
    raise exception 'Somente pedidos faturados e liberados podem entrar na carga (status: %)', ped.status;
  end if;
  if exige and not exists (select 1 from public.notas_saida
      where pedido_id = _pedido_id and status in ('autorizada','emitida')) then
    raise exception 'Pedido % está sem nota fiscal autorizada', ped.numero;
  end if;
  if c.rota_id is not null and ped.rota_id is distinct from c.rota_id then
    raise exception 'O pedido % é de outra rota', ped.numero;
  end if;
  if exists (select 1 from public.carga_pedidos cp join public.cargas cg on cg.id = cp.carga_id
              where cp.pedido_id = _pedido_id and cg.status <> 'cancelada' and cg.id <> _carga_id) then
    raise exception 'Pedido % já está em outra carga', ped.numero;
  end if;

  insert into public.carga_pedidos (carga_id, pedido_id, created_by)
  values (_carga_id, _pedido_id, auth.uid())
  on conflict (carga_id, pedido_id) do nothing;

  update public.pedidos set status = 'em_carga' where id = _pedido_id and status in ('faturado','nf_emitida');
  update public.expedicoes set carga_id = _carga_id, rota_id = coalesce(rota_id, c.rota_id)
   where pedido_id = _pedido_id and status not in ('entregue','cancelada');

  perform public.recalcular_carga(_carga_id);
end $$;
grant execute on function public.adicionar_pedido_carga(uuid, uuid) to authenticated;

-- 3) Descrição amigável para o parâmetro de boleto (usado na tela de Configurações)
update public.parametros
   set descricao = 'Exigir nota fiscal autorizada para emitir boleto (true/false)'
 where chave = 'exigir_nf_boleto' and coalesce(descricao, '') = '';
