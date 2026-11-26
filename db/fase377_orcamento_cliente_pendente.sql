begin;
do $$begin
 if to_regprocedure('public.exigir_cadastro_cliente_334(uuid)') is null
  or to_regprocedure('public.exigir_rota_aprovacao_336()') is null then
  raise exception 'Aplique as fases334 e336 de cadastro e rota antes da fase377';
 end if;
end $$;
-- O motor privado do orçamento foi copiado antes da rota opcional da fase336.
-- Atualiza somente essa validação; conserva carteira, loja, perfil e pagamento.
do $patch$
declare d text; alvo text;
begin
 select pg_get_functiondef('public.criar_orcamento_base_240(uuid,uuid,uuid,uuid,date,text,uuid,date)'::regprocedure) into d;
 if position('orcamento_sem_rota_377' in d)=0 then
  alvo:='if _rota_id is null then raise exception ''Rota de entrega obrigatoria''; end if;';
  if position(alvo in d)=0 then raise exception 'Criação de orçamento incompatível com a fase377; revise a validação de rota';end if;
  d:=replace(d,alvo,$nova$
  -- orcamento_sem_rota_377
  perform 1 from public.clientes where id=_cliente_id for share;
  if _rota_id is null and not exists(select 1 from public.clientes c join public.pessoas p on p.id=c.pessoa_id where c.id=_cliente_id and p.credito_pendente) then
   raise exception 'Rota de entrega obrigatoria';
  end if;
$nova$);
  alvo:='if not exists (select 1 from public.rotas where id = _rota_id and ativo) then';
  if position(alvo in d)=0 then raise exception 'Validação de rota do orçamento incompatível';end if;
  execute replace(d,alvo,'if _rota_id is not null and not exists (select 1 from public.rotas where id = _rota_id and ativo) then');
 end if;
 select pg_get_functiondef('public.decidir_orcamento_236(uuid,text,text)'::regprocedure) into d;
 if position('cadastro_orcamento_377' in d)=0 then
  alvo:='validacoes:=public.validar_pedido(_pedido);';
  if position(alvo in d)=0 or position('public.decidir_orcamento_base_241' in d)=0 then raise exception 'Aplique a fase241 antes da fase377';end if;
  execute replace(d,alvo,$guarda$
 -- cadastro_orcamento_377: aceite comercial permanece independente da aprovação interna.
 if exists(select 1 from public.clientes c join public.pessoas cad on cad.id=c.pessoa_id where c.id=p.cliente_id and cad.credito_pendente)
  or not exists(select 1 from public.rotas r where r.id=p.rota_id and r.ativo) then
  bloqueios:=jsonb_build_array(jsonb_build_object('nivel','bloqueio','mensagem','Aguardando revisão administrativa do cadastro, da rota e do limite do cliente.'));
  update public.pedidos set status='aguardando_aprovacao',aprovacao_automatica_em=null,aprovacao_automatica_motivos=bloqueios where id=_pedido returning * into p;
  insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',_pedido,'orcamento_cliente_pendente_377',auth.uid(),jsonb_build_object('bloqueios',bloqueios));
  return p;
 end if;
 validacoes:=public.validar_pedido(_pedido);
$guarda$);
 end if;
end $patch$;
revoke all on function public.criar_orcamento_base_240(uuid,uuid,uuid,uuid,date,text,uuid,date) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
