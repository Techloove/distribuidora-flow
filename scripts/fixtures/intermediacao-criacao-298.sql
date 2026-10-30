CREATE OR REPLACE FUNCTION public.criar_pedido_rascunho(_cliente_id uuid, _centro_id uuid, _rota_id uuid, _forma_pagamento_id uuid, _data_pedido date DEFAULT CURRENT_DATE, _observacoes text DEFAULT NULL::text, _representante_id uuid DEFAULT NULL::uuid, _previsao_entrega date DEFAULT NULL::date)
 RETURNS pedidos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ped public.pedidos;
  rep uuid;
  cliente_centro uuid;
BEGIN
 -- carteira_rpc_206

 if public.escopo_representante() and _cliente_id is not null and not public.documento_na_minha_carteira('clientes',_cliente_id) then raise exception 'Documento fora da sua carteira de representante'; end if;

 if public.escopo_representante() then _representante_id := public.meu_representante_id(); end if;

  if not public.can_operate(auth.uid()) then
    raise exception 'Sem permissao para criar pedidos';
  end if;

  if _cliente_id is null then raise exception 'Cliente obrigatorio'; end if;
  if _centro_id is null or not public.usuario_pode_acessar_centro(_centro_id) then
    raise exception 'Centro invalido ou sem acesso';
  end if;
  if _rota_id is null then raise exception 'Rota de entrega obrigatoria'; end if;
  if _forma_pagamento_id is null then raise exception 'Forma de pagamento obrigatoria'; end if;

  select c.centro_id into cliente_centro from public.clientes c where c.id = _cliente_id;
  if not found then raise exception 'Cliente nao encontrado'; end if;
  if cliente_centro is not null and cliente_centro is distinct from _centro_id then
    raise exception 'Cliente pertence a outro centro';
  end if;

  if not exists (select 1 from public.rotas where id = _rota_id and ativo) then
    raise exception 'Rota nao encontrada ou inativa';
  end if;
  if not exists (select 1 from public.formas_pagamento where id = _forma_pagamento_id and ativo) then
    raise exception 'Forma de pagamento nao encontrada ou inativa';
  end if;

  rep := _representante_id;
  if public.has_role(auth.uid(), 'representante')
     and not public.has_role(auth.uid(), 'admin')
     and not public.has_role(auth.uid(), 'gestor') then
    rep := public.meu_representante_id();
    if rep is null then raise exception 'Usuario representante sem vinculo cadastrado'; end if;
  elsif rep is not null then
    if not exists (select 1 from public.representantes where id = rep and ativo) then
      raise exception 'Representante invalido ou inativo';
    end if;
  end if;

  insert into public.pedidos
    (cliente_id, centro_id, rota_id, forma_pagamento_id, representante_id,
     data_pedido, previsao_entrega, observacoes)
  values
    (_cliente_id, _centro_id, _rota_id, _forma_pagamento_id, rep,
     coalesce(_data_pedido,current_date), _previsao_entrega, nullif(_observacoes,''))
  returning * into ped;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values(
    'pedidos',ped.id,'criar',
    jsonb_build_object('numero',ped.numero,'centro_id',ped.centro_id,'cliente_id',ped.cliente_id,
      'rota_id',ped.rota_id,'previsao_entrega',ped.previsao_entrega),
    auth.uid()
  );
  return ped;
end;
$function$;

CREATE OR REPLACE FUNCTION public.criar_orcamento_base_240(_cliente_id uuid, _centro_id uuid, _rota_id uuid, _forma_pagamento_id uuid, _data_pedido date DEFAULT CURRENT_DATE, _observacoes text DEFAULT NULL::text, _representante_id uuid DEFAULT NULL::uuid, _previsao_entrega date DEFAULT NULL::date)
 RETURNS pedidos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ped public.pedidos;
  rep uuid;
  cliente_centro uuid;
BEGIN
 -- carteira_rpc_206

 if public.escopo_representante() and _cliente_id is not null and not public.documento_na_minha_carteira('clientes',_cliente_id) then raise exception 'Documento fora da sua carteira de representante'; end if;

 if public.escopo_representante() then _representante_id := public.meu_representante_id(); end if;

  if not public.can_operate(auth.uid()) then
    raise exception 'Sem permissao para criar pedidos';
  end if;

  if _cliente_id is null then raise exception 'Cliente obrigatorio'; end if;
  if _centro_id is null or not public.usuario_pode_acessar_centro(_centro_id) then
    raise exception 'Centro invalido ou sem acesso';
  end if;
  if _rota_id is null then raise exception 'Rota de entrega obrigatoria'; end if;
  if _forma_pagamento_id is null then raise exception 'Forma de pagamento obrigatoria'; end if;

  select c.centro_id into cliente_centro from public.clientes c where c.id = _cliente_id;
  if not found then raise exception 'Cliente nao encontrado'; end if;
  if cliente_centro is not null and cliente_centro is distinct from _centro_id then
    raise exception 'Cliente pertence a outro centro';
  end if;

  if not exists (select 1 from public.rotas where id = _rota_id and ativo) then
    raise exception 'Rota nao encontrada ou inativa';
  end if;
  if not exists (select 1 from public.formas_pagamento where id = _forma_pagamento_id and ativo) then
    raise exception 'Forma de pagamento nao encontrada ou inativa';
  end if;

  rep := _representante_id;
  if public.has_role(auth.uid(), 'representante')
     and not public.has_role(auth.uid(), 'admin')
     and not public.has_role(auth.uid(), 'gestor') then
    rep := public.meu_representante_id();
    if rep is null then raise exception 'Usuario representante sem vinculo cadastrado'; end if;
  elsif rep is not null then
    if not exists (select 1 from public.representantes where id = rep and ativo) then
      raise exception 'Representante invalido ou inativo';
    end if;
  end if;

  insert into public.pedidos
    (cliente_id, centro_id, rota_id, forma_pagamento_id, representante_id,
     data_pedido, previsao_entrega, observacoes, tipo_documento, orcamento_situacao, orcamento_data, orcamento_validade)
  values
    (_cliente_id, _centro_id, _rota_id, _forma_pagamento_id, rep,
     coalesce(_data_pedido,current_date), _previsao_entrega, nullif(_observacoes,''),
 'orcamento', 'negociacao', coalesce(_data_pedido,(now() at time zone 'America/Sao_Paulo')::date),
 greatest(coalesce(_data_pedido,(now() at time zone 'America/Sao_Paulo')::date),(now() at time zone 'America/Sao_Paulo')::date))
  returning * into ped;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values(
    'pedidos',ped.id,'criar',
    jsonb_build_object('numero',ped.numero,'centro_id',ped.centro_id,'cliente_id',ped.cliente_id,
      'rota_id',ped.rota_id,'previsao_entrega',ped.previsao_entrega),
    auth.uid()
  );
  return ped;
end;
$function$;

CREATE OR REPLACE FUNCTION public.criar_orcamento_236(_cliente_id uuid, _centro_id uuid, _rota_id uuid, _forma_pagamento_id uuid, _validade date, _data_pedido date DEFAULT NULL::date, _observacoes text DEFAULT NULL::text, _representante_id uuid DEFAULT NULL::uuid)
 RETURNS pedidos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p236 public.pedidos; hoje236 date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if not public.usuario_ativo() or not public.can_operate(auth.uid()) or not public.pode_rotina('pedidos_orcamentos') then raise exception 'Criação de orçamentos não liberada'; end if;
 if _validade is null or _validade<hoje236 or _validade<coalesce(_data_pedido,hoje236) or length(coalesce(_observacoes,''))>4000 then raise exception 'Informe validade atual/futura e observações de até4000 caracteres'; end if;
 -- O cliente fica protegido contra troca concorrente de carteira durante a criação.
 perform 1 from public.clientes where id=_cliente_id for share;
 if public.escopo_representante() then
  if not public.cliente_na_minha_carteira(_cliente_id) then raise exception 'Cliente fora da sua carteira'; end if;
  _representante_id:=public.meu_representante_id();
 end if;
 p236:=public.criar_orcamento_base_240(_cliente_id,_centro_id,_rota_id,_forma_pagamento_id,coalesce(_data_pedido,hoje236),_observacoes,_representante_id,null);
 if not public.orcamento_acessivel_236(p236.id) then raise exception 'Orçamento sem acesso'; end if;
 if exists(select 1 from public.comissoes where pedido_id=p236.id) then raise exception 'A criação de documento gerou comissão inesperada; nenhuma proposta foi criada'; end if;
 update public.pedidos set tipo_documento='orcamento',orcamento_situacao='negociacao',orcamento_data=data_pedido,orcamento_validade=_validade where id=p236.id returning * into p236;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',p236.id,'criar_orcamento_236',auth.uid(),jsonb_build_object('validade',_validade));
 return p236;
end $function$;

CREATE OR REPLACE FUNCTION public.margem_inadequada_215(_pedido uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 select exists(select 1 from public.pedidos p join lateral (
  select sum(i.quantidade*coalesce(i.custo_unitario_base,nullif(pr.custo_medio,0),nullif(pr.preco_custo,0),nullif(pr.ultimo_custo,0),0)) custo,
  bool_or(coalesce(i.custo_unitario_base,nullif(pr.custo_medio,0),nullif(pr.preco_custo,0),nullif(pr.ultimo_custo,0),0)<=0) sem_custo
  from public.pedido_itens i join public.produtos pr on pr.id=i.produto_id where i.pedido_id=p.id
 ) x on true where p.id=_pedido and (
  coalesce(x.sem_custo,true) or p.total_liquido<=0 or
  (p.total_liquido-coalesce(x.custo,0)-p.comissao_valor-p.custo_frete-p.tributos_estimados-p.despesas_variaveis)/nullif(p.total_liquido,0)*100<coalesce((select nullif(valor,'')::numeric from public.parametros_da_loja_243((select centro_id from public.pedidos where id=_pedido)) where chave='margem_liquida_minima'),0)
 ));
$function$;
