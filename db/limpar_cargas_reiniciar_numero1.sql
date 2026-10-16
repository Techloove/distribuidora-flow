-- Limpeza pontual autorizada das cargas; próxima carga número1.
-- Execute integralmente como proprietário no SQL Editor, sem desativar RLS.
-- Preserva pedidos, separações, romaneios, comprovantes, estoque e financeiro.
begin;
lock table public.cargas,public.carga_pedidos,public.pedidos,public.expedicoes in access exclusive mode nowait;
do $limpeza$
declare sequencia text; retrato jsonb; quantidade bigint;
begin
 sequencia:=pg_get_serial_sequence('public.cargas','numero');
 if sequencia is null then raise exception 'Não foi encontrada a sequência de cargas.numero; nenhuma carga foi excluída'; end if;
 -- Não apaga por cascata dados de outras rotinas adicionadas ao banco.
 if exists(select 1 from pg_constraint where contype='f' and confrelid='public.cargas'::regclass
  and conrelid not in ('public.carga_pedidos'::regclass,'public.expedicoes'::regclass)) then
  raise exception 'Existe outra tabela vinculada às cargas. Confira essa dependência antes da limpeza';
 end if;
 if exists(select 1 from public.pedidos p where p.status='em_carga'
  and (exists(select 1 from public.carga_pedidos cp where cp.pedido_id=p.id)
   or exists(select 1 from public.expedicoes e where e.pedido_id=p.id and e.carga_id is not null))
  and (exists(select 1 from public.expedicoes e where e.pedido_id=p.id and e.status in ('em_rota','entregue'))
   or exists(select 1 from public.entrega_registros er where er.pedido_id=p.id and (er.tipo='entrega' or exists(select 1 from public.entrega_itens it where it.registro_id=er.id))))) then
  raise exception 'Há pedido em_carga com evidência de saída/recebimento. Confira a situação logística antes da limpeza';
 end if;
 select count(*) into quantidade from public.cargas;
 if quantidade>0 then
  -- Guarda cópia dos dados removidos/vínculos e dos status anteriores na auditoria.
  select jsonb_build_object(
   'cargas',coalesce((select jsonb_agg(to_jsonb(c)) from public.cargas c),'[]'::jsonb),
   'vinculos',coalesce((select jsonb_agg(to_jsonb(cp)) from public.carga_pedidos cp),'[]'::jsonb),
   'romaneios',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'pedido_id',e.pedido_id,'carga_id',e.carga_id,'status',e.status)) from public.expedicoes e where e.carga_id is not null),'[]'::jsonb),
   'pedidos',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'status',p.status)) from public.pedidos p where exists(select 1 from public.carga_pedidos cp where cp.pedido_id=p.id) or exists(select 1 from public.expedicoes e where e.pedido_id=p.id and e.carga_id is not null)),'[]'::jsonb)
  ) into retrato;
  insert into public.auditoria(tabela,acao,user_id,detalhe)
   values('cargas','limpeza_reinicio_numero1',auth.uid(),retrato);
 end if;
 -- Apenas pedidos ainda aguardando saída são liberados para nova montagem.
 update public.pedidos p set status=case when exists(select 1 from public.notas_saida n where n.pedido_id=p.id and n.status in ('autorizada','emitida')) then 'nf_emitida' else 'faturado' end
  where p.status='em_carga' and (exists(select 1 from public.carga_pedidos cp where cp.pedido_id=p.id)
   or exists(select 1 from public.expedicoes e where e.pedido_id=p.id and e.carga_id is not null));
 update public.expedicoes set carga_id=null where carga_id is not null;
 delete from public.carga_pedidos;
 delete from public.cargas;
 -- ALTER SEQUENCE é transacional; não consome o número1 como nextval faria.
 execute format('alter sequence %s restart with 1',sequencia::regclass);
 raise notice '% carga(s) excluída(s). A próxima carga receberá número1',quantidade;
end $limpeza$;
select count(*) cargas_restantes,1 proximo_numero_carga from public.cargas;
commit;
