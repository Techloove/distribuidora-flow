-- Fase235: acompanhamento somente de leitura dentro de Pedidos.
-- Aplicar após fase234. Não concede operação de logística nem acesso a arquivos.
begin;
do $$ declare nova text; begin
 if to_regprocedure('public.despachar_carga_233(uuid,date)') is null or
  not exists(select 1 from public.permissoes where codigo='entrega_registrar' and modulo='/entregas') then
  raise exception 'Aplique as fases233 e234 antes da fase235';
 end if;
 insert into public.permissoes(codigo,nome,grupo,ordem,modulo)
  values('pedidos_acompanhar','Consultar andamento, data de entrega e recebedor','Pedidos',139,'/pedidos')
  on conflict do nothing returning codigo into nova;
 if nova is not null then
  insert into public.role_permissoes(role,permissao)
   select distinct role::text,'pedidos_acompanhar' from public.role_menus where path='/pedidos' on conflict do nothing;
 end if;
end $$;
create or replace function public.acompanhar_pedido_235(_pedido uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare p public.pedidos; resultado jsonb;
begin
 if not public.usuario_ativo() or not public.pode_rotina('pedidos_acompanhar') then raise exception 'Acompanhamento de pedidos não liberado para seu perfil'; end if;
 select * into p from public.pedidos where id=_pedido;
 if p.id is null or not public.usuario_pode_acessar_centro(p.centro_id)
  or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',p.id)) then
  raise exception 'Pedido não encontrado ou sem acesso';
 end if;
 -- Retorna apenas o resumo comercial. Não expõe comprovante, arquivo, observações,
 -- itens da carga, outros clientes ou identificadores das rotinas operacionais.
 select jsonb_build_object('pedido_id',p.id,'numero',p.numero,'status',p.status,'data_pedido',p.data_pedido,
  'data_saida',e.data_saida,'previsao_entrega',e.previsao_entrega,
  'data_entrega',case when p.status='entregue' then coalesce(p.data_entrega,e.data_entrega,er.data_entrega) end,
  'recebedor',case when p.status='entregue' then nullif(trim(er.recebedor),'') end,
  'carga_numero',cg.numero,'ultima_visita',visita.created_at,'recebedor_ultima_visita',nullif(trim(visita.recebedor),''),
  'possui_entrega_parcial',exists(select 1 from public.entrega_registros r join public.entrega_itens it on it.registro_id=r.id where r.expedicao_id=e.id and r.pedido_id=p.id and public.usuario_pode_acessar_centro(r.centro_id)))
 into resultado
 from (select 1) base
 left join lateral(select x.* from public.expedicoes x where x.pedido_id=p.id and x.status<>'cancelada'
  and public.usuario_pode_acessar_centro(x.centro_id) order by x.created_at desc,x.id desc limit 1) e on true
 left join lateral(select r.data_entrega,r.recebedor from public.entrega_registros r
  where r.expedicao_id=e.id and r.pedido_id=p.id and r.tipo='entrega' and public.usuario_pode_acessar_centro(r.centro_id)
  order by r.created_at desc,r.id desc limit 1) er on true
 left join lateral(select r.created_at,r.recebedor from public.entrega_registros r
  where r.expedicao_id=e.id and r.pedido_id=p.id and public.usuario_pode_acessar_centro(r.centro_id)
   and exists(select 1 from public.entrega_itens it where it.registro_id=r.id)
  order by r.created_at desc,r.id desc limit 1) visita on true
 left join lateral(select c.numero from public.carga_pedidos cp join public.cargas c on c.id=cp.carga_id
  where cp.pedido_id=p.id and c.status<>'cancelada' and (c.centro_id is null or public.usuario_pode_acessar_centro(c.centro_id))
  order by c.numero desc,c.id desc limit 1) cg on true;
 return resultado;
end $$;
revoke all on function public.acompanhar_pedido_235(uuid) from public,anon;
grant execute on function public.acompanhar_pedido_235(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
