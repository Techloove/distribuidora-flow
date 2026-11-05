-- Representante informa dados do cliente; rota pode ser definida na revisão administrativa.
begin;
do $$declare d text;alvo text;novo text;begin
 select pg_get_functiondef('public.proteger_credito_cliente_284()'::regprocedure) into d;
 if position('rota_opcional_336' in d)=0 then
  alvo:='if not public.rota_cliente_representante_284(new.rota_id) then raise exception ''Selecione uma rota vinculada ao representante ou já atendida pela sua carteira'';end if;';
  if position(alvo in d)=0 then raise exception 'Revise a proteção de cadastro antes da fase336';end if;
  execute replace(d,alvo,'-- rota_opcional_336'||E'\n   if new.rota_id is not null and not public.rota_cliente_representante_284(new.rota_id) then raise exception ''Rota fora da sua carteira'';end if;');
 end if;
 select pg_get_functiondef('public.cadastrar_cliente_representante_284(jsonb)'::regprocedure) into d;
 if position('nullif(_dados->>''rota_id''' in d)=0 then
  execute replace(d,'(_dados->>''rota_id'')::uuid','nullif(_dados->>''rota_id'','''')::uuid');
 end if;
 -- A atribuição automática por cidade não decide a rota de um cadastro ainda pendente.
 select pg_get_functiondef('public.cliente_rota_por_cidade()'::regprocedure) into d;
 if position('cadastro_pendente_336' in d)=0 then
  alvo:='if new.rota_id is null and new.cidade is not null then';
  if position(alvo in d)=0 then raise exception 'Revise a atribuição de rota por cidade';end if;
  execute replace(d,alvo,'-- cadastro_pendente_336'||E'\n  if new.rota_id is null and exists(select 1 from public.pessoas p where p.id=new.pessoa_id and p.credito_pendente) then return new;end if;\n  '||alvo);
 end if;
 select pg_get_functiondef('public.criar_pedido_rascunho(uuid,uuid,uuid,uuid,date,text,uuid,date)'::regprocedure) into d;
 if position('rascunho_sem_rota_336' in d)=0 then
  alvo:='if _rota_id is null then raise exception ''Rota de entrega obrigatoria''; end if;';
  if position(alvo in d)=0 then raise exception 'Revise a criação de pedido antes da fase336';end if;
  novo:='-- rascunho_sem_rota_336'||E'\n  perform 1 from public.clientes where id=_cliente_id for share;\n  if _rota_id is null and not exists(select 1 from public.clientes c join public.pessoas p on p.id=c.pessoa_id where c.id=_cliente_id and p.credito_pendente) then raise exception ''Rota de entrega obrigatoria'';end if;';
  d:=replace(d,alvo,novo);
  alvo:='if not exists (select 1 from public.rotas where id = _rota_id and ativo) then';
  if position(alvo in d)=0 then raise exception 'Revise a validação da rota do pedido';end if;
  execute replace(d,alvo,'if _rota_id is not null and not exists (select 1 from public.rotas where id = _rota_id and ativo) then');
 end if;
 select pg_get_functiondef('public.liberar_credito_cliente_284(uuid,numeric)'::regprocedure) into d;
 if position('revisao_rota_336' in d)=0 then
  alvo:='update public.pessoas set limite_credito=_limite,credito_pendente=false,status=''ativo'' where id=_pessoa;';
  if position(alvo in d)=0 then raise exception 'Revise a liberação administrativa de clientes';end if;
  novo:='-- revisao_rota_336'||E'\n perform 1 from public.rotas where id=p.rota_id and ativo for share;\n if not found then raise exception ''Defina uma rota ativa no Cadastro Unificado antes de liberar o cliente'';end if;\n '||alvo||E'\n update public.pedidos d set rota_id=p.rota_id where d.cliente_id in(select c.id from public.clientes c where c.pessoa_id=p.id) and d.centro_id=p.centro_id and d.rota_id is null and d.status in(''rascunho'',''digitacao'',''aguardando_aprovacao'');';
  execute replace(d,alvo,novo);
 end if;
end $$;
-- Uma venda não é aprovada ou confirmada sem rota ativa. Documentos históricos não são regravados.
create or replace function public.exigir_rota_aprovacao_336() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if tg_op='UPDATE' then
  if new.status is not distinct from old.status and new.rota_id is not distinct from old.rota_id and new.tipo_documento is not distinct from old.tipo_documento then return new;end if;
 end if;
 if new.tipo_documento='pedido' and new.status in('aprovado','confirmado') and not exists(select 1 from public.rotas r where r.id=new.rota_id and r.ativo) then
  raise exception 'Defina uma rota ativa para o pedido antes de aprovar ou confirmar';end if;
 return new;
end $$;
revoke all on function public.exigir_rota_aprovacao_336() from public,anon,authenticated,service_role;
drop trigger if exists exigir_rota_aprovacao_336 on public.pedidos;
create trigger exigir_rota_aprovacao_336 before insert or update on public.pedidos for each row execute function public.exigir_rota_aprovacao_336();
notify pgrst,'reload schema';
commit;
