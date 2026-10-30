-- Motores existentes na fase295 para regressão em banco descartável; sem dados de produção.
CREATE OR REPLACE FUNCTION public.confirmar_pedido(_pedido_id uuid)
 RETURNS pedidos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ped public.pedidos;
  item record;
  app record;
  n int;
  parcelas int;
  valor_total numeric(14,2);
  credito_total numeric(14,2);
  valor_parcela numeric(14,2);
  saldo numeric(14,2);
  cred public.creditos_clientes;
begin
 -- orcamento_motor_236
 if exists(select 1 from public.pedidos q236 where q236.id=_pedido_id and q236.tipo_documento='orcamento') then raise exception 'Use as ações de orçamento: aceite e conversão precedem a aprovação interna'; end if;
 
 -- carteira_rpc_206

 if public.escopo_representante() and _pedido_id is not null and not public.documento_na_minha_carteira('pedidos',_pedido_id) then raise exception 'Documento fora da sua carteira de representante'; end if;

  if not public.can_operate(auth.uid()) then
    raise exception 'Sem permissao para confirmar pedidos';
  end if;

  select * into ped from public.pedidos where id = _pedido_id for update;

  if ped.id is null then
    raise exception 'Pedido nao encontrado';
  end if;

  if ped.centro_id is null then
    raise exception 'Centro do pedido obrigatorio';
  end if;

  if not public.usuario_pode_acessar_centro(ped.centro_id) then
    raise exception 'Pedido pertence a outro centro';
  end if;

  if ped.status = 'confirmado' then
    return ped;
  end if;

  if ped.status not in ('rascunho','digitacao','aprovado') then
    raise exception 'Pedido nao pode ser confirmado no status atual: %', ped.status;
  end if;

  if not exists (select 1 from public.pedido_itens where pedido_id = _pedido_id) then
    raise exception 'Inclua ao menos um item no pedido';
  end if;

  perform public.recalcular_pedido(_pedido_id);
 -- confirmacao_209
 if ped.status<>'aprovado' and exists(select 1 from jsonb_array_elements(public.validar_pedido(_pedido_id)) v where v->>'nivel'='bloqueio') then raise exception 'Pedido requer aprovação da gestão antes de confirmar'; end if;

  select * into ped from public.pedidos where id = _pedido_id for update;
  valor_total := coalesce(ped.total_liquido,0);

  -- Bloqueia e valida todas as reservas do pedido.
  credito_total := 0;
  for app in
    select *
    from public.creditos_clientes_aplicacoes
    where pedido_id = _pedido_id
      and status = 'reservado'
    order by credito_id, id
    for update
  loop
    select * into cred from public.creditos_clientes where id = app.credito_id for update;

    if cred.id is null or cred.status = 'cancelado' then
      raise exception 'Credito da aplicacao % esta indisponivel', app.id;
    end if;
    if cred.cliente_id is distinct from ped.cliente_id then
      raise exception 'Credito aplicado pertence a outro cliente';
    end if;
    if cred.centro_id is distinct from ped.centro_id then
      raise exception 'Credito aplicado pertence a outro centro';
    end if;
    if cred.saldo < 0 then
      raise exception 'Credito % esta inconsistente', cred.id;
    end if;

    credito_total := credito_total + app.valor;
  end loop;

  if credito_total > valor_total then
    raise exception 'Creditos aplicados excedem o valor do pedido';
  end if;

  for item in
    select produto_id, sum(quantidade) qtd
    from public.pedido_itens
    where pedido_id = _pedido_id
    group by produto_id
  loop
    perform public.registrar_movimento_estoque_controlado(
      item.produto_id, ped.centro_id, 'saida', item.qtd, null,
      'pedido', _pedido_id, 'Baixa por confirmacao de pedido'
    );
  end loop;

  -- Gera recebiveis apenas sobre o saldo apos credito.
  parcelas := greatest(coalesce(ped.parcelas,1),1);
  saldo := valor_total - credito_total;
  if saldo > 0 then
    valor_parcela := round(saldo / parcelas,2);
    for n in 1..parcelas loop
      if n = parcelas then
        valor_parcela := saldo;
      end if;

      insert into public.contas_receber
        (cliente_id,pedido_id,documento,parcela,valor,vencimento,centro_id,data_emissao,status)
      values
        (ped.cliente_id,ped.id,'PED-'||ped.numero,n,valor_parcela,
         public.vencimento_pedido_227(ped.id,n),ped.centro_id,current_date,'aberto');

      saldo := saldo - valor_parcela;
    end loop;
  end if;

  -- Consome o credito somente dentro da mesma transacao da confirmacao.
  for app in
    select *
    from public.creditos_clientes_aplicacoes
    where pedido_id = _pedido_id
      and status = 'reservado'
    order by credito_id, id
    for update
  loop
    select * into cred from public.creditos_clientes where id = app.credito_id for update;

    -- O valor ja foi reservado no momento da aplicacao.
    -- Aqui apenas tornamos a reserva definitiva.
    update public.creditos_clientes_aplicacoes
    set status = 'aplicado', aplicado_em = now()
    where id = app.id;
  end loop;

  if ped.representante_id is not null and ped.comissao_valor > 0 and not exists(select 1 from public.comissoes where pedido_id=ped.id) then
    insert into public.comissoes
      (representante_id,pedido_id,base_calculo,percentual,valor,centro_id)
    values
      (ped.representante_id,ped.id,ped.total_itens,ped.comissao_percentual,ped.comissao_valor,ped.centro_id);
  end if;

  update public.pedidos set status='confirmado' where id=_pedido_id returning * into ped;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values(
    'pedidos',_pedido_id,'confirmar',
    jsonb_build_object(
      'total',ped.total_liquido,
      'credito_aplicado',credito_total,
      'saldo_a_receber',greatest(ped.total_liquido-credito_total,0),
      'parcelas',ped.parcelas,
      'centro_id',ped.centro_id
    ),
    auth.uid()
  );

  return ped;
end;
$function$;

CREATE OR REPLACE FUNCTION public.recalcular_pedido(_pedido_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  soma numeric(14,2);
  base numeric(14,2);
  pct numeric(5,2);
  ped record;
  fp record;
  acr numeric(14,2) := 0;
  dsc numeric(14,2) := 0;
BEGIN
 -- carteira_rpc_206

 if public.escopo_representante() and _pedido_id is not null and not public.documento_na_minha_carteira('pedidos',_pedido_id) then raise exception 'Documento fora da sua carteira de representante'; end if;

  select coalesce(sum(total), 0) into soma from public.pedido_itens where pedido_id = _pedido_id;
  perform public.calcular_frete_volume_250(_pedido_id); select * into ped from public.pedidos where id = _pedido_id;
  if ped is null then return; end if;

  base := greatest(soma - coalesce(ped.desconto_valor, 0), 0);
  pct := coalesce(ped.comissao_percentual,0);

  if ped.forma_pagamento_id is not null then
    select * into fp from public.formas_pagamento where id = ped.forma_pagamento_id;
    if fp.id is not null then
      acr := round(base * coalesce(fp.taxa_percentual, 0) / 100, 2);
      dsc := round(base * coalesce(fp.desconto_percentual, 0) / 100, 2);
    end if;
  end if;

  update public.pedidos
     set total_itens = soma,
         forma_acrescimo_valor = acr,
         forma_desconto_valor = dsc,
         total_liquido = greatest(base + coalesce(frete_valor,0) + acr - dsc + coalesce(frete_volume_valor,0) + coalesce(outras_despesas,0), 0),
         comissao_percentual = pct,
         comissao_valor = round(base * pct / 100, 2)
   where id = _pedido_id;

  update public.pedidos set comissao_valor=public.calcular_comissao_itens_215(_pedido_id), comissao_percentual=case when base>0 then least(999.99,round(public.calcular_comissao_itens_215(_pedido_id)/base*100,2)) else 0 end where id=_pedido_id; perform public.apurar_comissao_pedido(_pedido_id);
end $function$;

CREATE OR REPLACE FUNCTION public.validar_pedido(_pedido_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ped record; cli record;
  res jsonb := '[]'::jsonb;
  vencidos numeric(14,2); aberto numeric(14,2);
  margem numeric(14,4); custo numeric(14,4);
  margem_min numeric := coalesce((select valor::numeric from public.parametros_da_loja_243((select centro_id from public.pedidos where id=_pedido_id)) where chave = 'margem_minima'), 10);
  desc_max numeric := coalesce((select valor::numeric from public.parametros_da_loja_243((select centro_id from public.pedidos where id=_pedido_id)) where chave = 'desconto_maximo'), 15);
  regra_limite boolean := coalesce((select valor from public.parametros_da_loja_243((select centro_id from public.pedidos where id=_pedido_id)) where chave = 'aprovacao_limite_credito'), 'true') = 'true';
  regra_vencidos boolean := coalesce((select valor from public.parametros_da_loja_243((select centro_id from public.pedidos where id=_pedido_id)) where chave = 'aprovacao_titulos_vencidos'), 'true') = 'true';
  regra_util boolean := coalesce((select valor from public.parametros_da_loja_243((select centro_id from public.pedidos where id=_pedido_id)) where chave = 'vencimento_fim_semana_feriado'), 'true') = 'true';
  tolerancia int := coalesce((select nullif(valor,'')::int from public.parametros_da_loja_243((select centro_id from public.pedidos where id=_pedido_id)) where chave = 'tolerancia_dias_vencidos'), 0);
  item record;
BEGIN
 -- margem_209
 if not public.usuario_ativo() or not exists(select 1 from public.pedidos where id=_pedido_id and public.usuario_pode_acessar_centro(centro_id)) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',_pedido_id)) then raise exception 'Pedido sem acesso'; end if;
 -- carteira_rpc_206

 if public.escopo_representante() and _pedido_id is not null and not public.documento_na_minha_carteira('pedidos',_pedido_id) then raise exception 'Documento fora da sua carteira de representante'; end if;

  select * into ped from public.pedidos where id = _pedido_id;
  if ped is null then return res; end if;
  select * into cli from public.clientes where id = ped.cliente_id;

  select coalesce(sum(valor - coalesce(valor_pago,0)), 0) into vencidos
    from public.contas_receber
   where cliente_id = ped.cliente_id and status not in ('pago','cancelado')
     and (case when regra_util then public.vencimento_util(vencimento) else vencimento end) + tolerancia < current_date;
  select coalesce(sum(valor - coalesce(valor_pago,0)), 0) into aberto
    from public.contas_receber
   where cliente_id = ped.cliente_id and status not in ('pago','cancelado');

  if cli.status = 'bloqueado' then
    res := res || jsonb_build_object('nivel','bloqueio','mensagem','Cliente bloqueado no cadastro');
  end if;
  if regra_vencidos and vencidos > 0 then
    res := res || jsonb_build_object('nivel','bloqueio',
      'mensagem','Cliente possui ' || to_char(vencidos,'FM999999990.00') || ' em títulos vencidos');
  end if;
  if regra_limite and coalesce(cli.limite_credito,0) > 0 and ((aberto + case when exists (select 1 from public.contas_receber cr291 where cr291.pedido_id=ped.id and cr291.cliente_id=ped.cliente_id and cr291.ciclo_pedido_289=ped.ciclo_reabertura_289 and cr291.status<>'cancelado') then 0 else ped.total_liquido end)) > cli.limite_credito then
    res := res || jsonb_build_object('nivel','bloqueio',
      'mensagem','Limite de crédito excedido (limite ' || to_char(cli.limite_credito,'FM999999990.00')
        || ', exposição ' || to_char((aberto + case when exists (select 1 from public.contas_receber cr291 where cr291.pedido_id=ped.id and cr291.cliente_id=ped.cliente_id and cr291.ciclo_pedido_289=ped.ciclo_reabertura_289 and cr291.status<>'cancelado') then 0 else ped.total_liquido end),'FM999999990.00') || ')');
  end if;
  if ped.forma_pagamento_id is null then
    res := res || jsonb_build_object('nivel','alerta','mensagem','Forma de pagamento não informada');
  end if;
  if ped.centro_id is null then
    res := res || jsonb_build_object('nivel','alerta','mensagem','Centro de custo não informado');
  end if;

  for item in
    select pi.quantidade, pi.preco_unitario, pi.desconto_percentual,
           p.descricao, p.estoque_atual, p.custo_medio, p.margem_minima
      from public.pedido_itens pi join public.produtos p on p.id = pi.produto_id
     where pi.pedido_id = _pedido_id
  loop
    if item.quantidade > coalesce(item.estoque_atual,0) then
      res := res || jsonb_build_object('nivel','alerta',
        'mensagem','Estoque insuficiente de ' || item.descricao ||
          ' (disponível ' || to_char(coalesce(item.estoque_atual,0),'FM999999990.###') || ')');
    end if;
    custo := coalesce(item.custo_medio, 0);
    if custo > 0 and item.preco_unitario > 0 then
      margem := round(((item.preco_unitario * (1 - coalesce(item.desconto_percentual,0)/100) / custo) - 1) * 100, 2);
      if margem < greatest(coalesce(item.margem_minima,0), margem_min) then
        res := res || jsonb_build_object('nivel','bloqueio',
          'mensagem','Margem de ' || item.descricao || ' abaixo do mínimo (' || margem || '%)');
      end if;
    end if;
    if coalesce(item.desconto_percentual,0) > desc_max then
      res := res || jsonb_build_object('nivel','bloqueio',
        'mensagem','Desconto de ' || item.descricao || ' acima do máximo permitido (' || desc_max || '%)');
    end if;
  end loop;
  if public.margem_inadequada_215(_pedido_id) then
 res := res || jsonb_build_object('nivel','bloqueio','mensagem','Margem de contribuição abaixo do mínimo ou produto sem custo: requer aprovação');
 end if;
 
  -- catalogo_loja_244
  if exists(select 1 from public.pedido_itens i join public.pedidos p on p.id=i.pedido_id left join public.loja_produtos l on l.centro_id=p.centro_id and l.produto_id=i.produto_id where p.id=_pedido_id and (l.disponivel is distinct from true or not public.produto_categoria_loja_246(p.centro_id,i.produto_id))) then
   res:=res||jsonb_build_object('nivel','bloqueio','mensagem','Pedido contém produto indisponível nesta loja');
  end if;
  if exists(select 1 from public.pedido_itens i join public.pedidos p on p.id=i.pedido_id join public.loja_produtos l on l.centro_id=p.centro_id and l.produto_id=i.produto_id where p.id=_pedido_id and l.desconto_maximo is not null and coalesce(i.desconto_percentual,0)>l.desconto_maximo) then
   res:=res||jsonb_build_object('nivel','bloqueio','mensagem','Desconto de produto acima do máximo configurado para esta loja');
  end if;
  return res;
end $function$;

CREATE OR REPLACE FUNCTION public.confirmar_devolucao(_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  dev public.devolucoes;
  ped public.pedidos;
  it record;
  op_id uuid;
  qtd_vendida numeric(14,3);
  qtd_devolvida numeric(14,3);
BEGIN
 -- acao_guard_211
 if not public.pode_rotina('devolucao_operar') then raise exception 'Ação não liberada para seu perfil'; end if;

 -- carteira_devolucao_209
 if not public.usuario_ativo() or (public.escopo_representante() and not public.documento_na_minha_carteira('devolucoes',_id)) then raise exception 'Devolução sem acesso à carteira'; end if;
  if not public.can_manage(auth.uid()) then
    raise exception 'Sem permissao para confirmar devolucoes';
  end if;

  select * into dev from public.devolucoes where id=_id for update;
  if dev.id is null then raise exception 'Devolucao nao encontrada'; end if;

  if dev.pedido_id is not null then
    select * into ped from public.pedidos where id=dev.pedido_id for update;
    if ped.id is null then raise exception 'Pedido de origem nao encontrado'; end if;
    if not public.usuario_pode_acessar_centro(ped.centro_id) then
      raise exception 'Pedido pertence a outro centro';
    end if;
    if /* devolucao_estagios_285 */ ped.status not in ('confirmado','separacao','separado','conferido','faturado','nf_emitida','em_carga','em_rota','entregue','parcial','nao_entregue','devolvido') and not (ped.status in ('em_rota','em_carga') and exists(select 1 from public.entrega_itens where devolucao_id=dev.id)) then -- recusa_rota_214
      raise exception 'Pedido no status % nao permite devolucao',ped.status;
    end if;
    if dev.centro_id is null then
      dev.centro_id := ped.centro_id;
    elsif dev.centro_id <> ped.centro_id then
      raise exception 'Centro da devolucao difere do centro do pedido';
    end if;
  else
    if not public.usuario_pode_acessar_centro(dev.centro_id) then
      raise exception 'Devolucao pertence a outro centro';
    end if;
  end if;

  if dev.status='confirmada' then return; end if;
  if dev.status<>'rascunho' then
    raise exception 'Somente devolucoes em rascunho podem ser confirmadas';
  end if;
  if not exists(select 1 from public.devolucao_itens where devolucao_id=_id) then
    raise exception 'Inclua ao menos um item na devolucao';
  end if;
  if dev.centro_id is null then raise exception 'Centro da devolucao obrigatorio'; end if;
  if dev.cliente_id is null then raise exception 'Cliente da devolucao obrigatorio para gerar credito'; end if;
  if coalesce(dev.valor_total,0) <= 0 then raise exception 'Valor da devolucao deve ser maior que zero'; end if;

  insert into public.devolucao_operacoes(devolucao_id,tipo,created_by)
  values(_id,'confirmacao',auth.uid())
  on conflict(devolucao_id,tipo) do nothing
  returning id into op_id;

  if op_id is null then return; end if;

  for it in
    select produto_id,sum(quantidade) as qtd,sum(total) as total
    from public.devolucao_itens
    where devolucao_id=_id
    group by produto_id
  loop
    if dev.pedido_id is not null then
      select coalesce(sum(quantidade),0) into qtd_vendida
      from public.pedido_itens
      where pedido_id=dev.pedido_id and produto_id=it.produto_id;

      select coalesce(sum(di.quantidade),0) into qtd_devolvida
      from public.devolucao_itens di
      join public.devolucoes d on d.id=di.devolucao_id
      where d.pedido_id=dev.pedido_id
        and di.produto_id=it.produto_id
        and d.status='confirmada'
        and d.id<>_id;

      if it.qtd > greatest(qtd_vendida-qtd_devolvida,0) then
        raise exception 'Quantidade devolvida do produto % excede a quantidade vendida disponivel',it.produto_id;
      end if;
    end if;

    insert into public.estoque_movimentos
      (produto_id,centro_id,tipo,quantidade,custo_unitario,origem,documento_id,observacao,created_by)
    values
      (it.produto_id,dev.centro_id,'entrada',it.qtd,
       case when it.qtd<>0 then it.total/it.qtd else 0 end,
       'devolucao',dev.id,'Entrada de devolucao '||dev.numero,auth.uid());
  end loop;

  update public.devolucoes
  set centro_id=dev.centro_id,status='confirmada'
  where id=_id;

  perform public.criar_credito_devolucao(
    _id,dev.cliente_id,dev.centro_id,dev.valor_total,
    'Credito gerado pela devolucao '||dev.numero
  );

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values(
    'devolucoes',_id,'confirmar',
    jsonb_build_object(
      'numero',dev.numero,
      'valor',dev.valor_total,
      'centro_id',dev.centro_id,
      'credito_cliente',true
    ),
    auth.uid()
  );

  perform public.notificar(
    'Devolucao confirmada',
    'Devolucao '||dev.numero||' retornou ao estoque e gerou credito ao cliente.',
    'alerta','/devolucoes'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.reservar_pedido_212()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare i record; saldo numeric; reservado numeric;
begin
 if new.status='aprovado' and old.status is distinct from new.status then
  if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.usuario_pode_acessar_centro(new.centro_id) or
   (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',new.id)) then raise exception 'Sem acesso para reservar pedido'; end if;
  if new.centro_id is null or not exists(select 1 from public.pedido_itens where pedido_id=new.id) then raise exception 'Centro e itens obrigatórios para reservar'; end if;
  for i in select produto_id,sum(quantidade) qtd from public.pedido_itens where pedido_id=new.id group by produto_id order by produto_id loop
   perform 1 from public.produtos where id=i.produto_id for update;
   perform 1 from public.centros where id=new.centro_id for share;
   perform 1 from public.cad_categorias where id=(select categoria_produtos_id from public.centros where id=new.centro_id) for share;
   if new.centro_id is distinct from public.loja_produto_estoque_271(i.produto_id) then raise exception 'Produto não pertence ao estoque desta loja';end if;
   select coalesce((select quantidade from public.estoque_saldos where produto_id=i.produto_id and centro_id=new.centro_id),0) into saldo;
   select coalesce(sum(quantidade),0) into reservado from public.estoque_reservas where produto_id=i.produto_id and centro_id=new.centro_id and pedido_id<>new.id;
   if i.qtd<=0 or i.qtd::text in ('NaN','Infinity','-Infinity') or saldo-reservado<i.qtd then raise exception 'Estoque disponível insuficiente para reservar produto % (disponível %)',i.produto_id,saldo-reservado; end if;
   insert into public.estoque_reservas(pedido_id,produto_id,centro_id,quantidade) values(new.id,i.produto_id,new.centro_id,i.qtd)
   on conflict(pedido_id,produto_id) do update set quantidade=excluded.quantidade,centro_id=excluded.centro_id;
  end loop;
 elsif new.status<>'aprovado' and old.status='aprovado' then
  delete from public.estoque_reservas where pedido_id=new.id;
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.calcular_frete_volume_250(_pedido uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$declare ped250 public.pedidos;total250 numeric:=0;detalhes250 jsonb:='[]';usar253 boolean;opcao253 text;begin
 select * into ped250 from public.pedidos where id=_pedido for update;
 if ped250.id is null or ped250.status not in ('rascunho','digitacao') then return;end if;
 opcao253:=ped250.frete_volume_opcao;
 if opcao253='legado' then
  opcao253:=case when not ped250.frete_volume_ativo and
   (select a.detalhe->>'frete_volume_ativo' from public.auditoria a where a.tabela='pedidos' and a.registro_id=ped250.id and a.acao='encargos_250' order by a.created_at desc,a.id desc limit 1)='false'
   then 'dispensar' else 'automatico' end;
 end if;
 usar253:=case opcao253
  when 'dispensar' then false when 'cobrar' then true else exists(
   select 1 from public.pedido_itens i join public.loja_fretes_volume f on f.produto_id=i.produto_id and f.centro_id=ped250.centro_id and f.ativo where i.pedido_id=ped250.id
  ) end;
 if usar253 then
  select coalesce(sum(round(i.quantidade*f.valor_unitario,2)),0),coalesce(jsonb_agg(jsonb_build_object(
   'produto_id',i.produto_id,'codigo',pr.codigo,'produto',pr.descricao,'unidade',pr.unidade,'quantidade',i.quantidade,
   'cidade',f.cidade,'uf',f.uf,'valor_unitario',f.valor_unitario,'total',round(i.quantidade*f.valor_unitario,2)) order by i.id),'[]'::jsonb)
  into total250,detalhes250 from public.pedido_itens i join public.produtos pr on pr.id=i.produto_id
  join public.clientes c on c.id=ped250.cliente_id
  join public.loja_fretes_volume f on f.centro_id=ped250.centro_id and f.produto_id=i.produto_id and f.ativo
   and f.cidade=public.chave_cidade_250(c.cidade) and f.uf=public.chave_cidade_250(c.uf)
  where i.pedido_id=ped250.id;
 end if;
 update public.pedidos set frete_volume_opcao=opcao253,frete_volume_ativo=usar253,frete_volume_valor=total250,frete_volume_detalhes=detalhes250 where id=ped250.id
  and (frete_volume_opcao is distinct from opcao253 or frete_volume_ativo is distinct from usar253 or frete_volume_valor is distinct from total250 or frete_volume_detalhes is distinct from detalhes250);
end $function$;

CREATE OR REPLACE FUNCTION public.salvar_parametros_loja_243(_loja uuid, _valores jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; v text;n numeric;
begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('configuracao_rotinas_editar') or not public.usuario_pode_acessar_centro(_loja) or not exists(select 1 from public.centros where id=_loja and ativo) then raise exception 'Sem permissão para configurar esta loja';end if;
 if jsonb_typeof(_valores) is distinct from 'object' then raise exception 'Parâmetros inválidos';end if;
 perform 1 from public.centros where id=_loja for update;
 for r in select * from jsonb_each(_valores) loop
  if jsonb_typeof(r.value)<>'string' then raise exception 'Informe valores textuais para os parâmetros';end if;
  v:=btrim(r.value#>>'{}');
  if not exists(select 1 from public.parametros where chave=r.key) or r.key='desconto_maximo_percentual' then raise exception 'Parâmetro não configurável: %',r.key;end if;
  if r.key in ('aprovacao_limite_credito','aprovacao_titulos_vencidos','vencimento_fim_semana_feriado','exigir_nf_carga','exigir_nf_boleto','alerta_estoque_minimo') then
   if v not in ('true','false') then raise exception 'Informe Sim ou Não para %',r.key;end if;
  elsif r.key='comissao_fato_gerador' then
   if v not in ('venda','recebimento') then raise exception 'Regra de liberação da comissão inválida';end if;
  elsif r.key in ('margem_minima','margem_liquida_minima','desconto_maximo','prazo_padrao_dias','tolerancia_dias_vencidos') then
   if v!~'^[0-9]+(\.[0-9]+)?$' or length(v)>12 then raise exception 'Valor numérico inválido para %',r.key;end if;
   n:=v::numeric;
   if (r.key in ('margem_liquida_minima','desconto_maximo') and n>100) or (r.key='margem_minima' and n>1000) or
    (r.key in ('prazo_padrao_dias','tolerancia_dias_vencidos') and (n>3650 or n<>trunc(n))) then raise exception 'Valor fora do intervalo permitido para %',r.key;end if;
  else raise exception 'Este parâmetro requer implantação específica: %',r.key;
  end if;
  insert into public.loja_parametros(centro_id,chave,valor,updated_by) values(_loja,r.key,v,auth.uid())
   on conflict(centro_id,chave) do update set valor=excluded.valor,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 end loop;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('centros',_loja,'configurar_parametros_loja_243',auth.uid(),jsonb_build_object('parametros',_valores));
end $function$;

CREATE OR REPLACE FUNCTION public.pedido_itens_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.total := round(new.quantidade * new.preco_unitario
    * (1 - coalesce(new.desconto_percentual,0) / 100), 2);
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.capturar_custo_pedido_209()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if new.status='confirmado' and old.status is distinct from new.status then
  update public.pedido_itens i set custo_unitario_base=coalesce(nullif(pr.custo_medio,0),nullif(pr.preco_custo,0),nullif(pr.ultimo_custo,0),0)
  from public.produtos pr where i.produto_id=pr.id and i.pedido_id=new.id and i.custo_unitario_base is null;
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.pedido_itens_after()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 -- custo_item_209
 if tg_op='UPDATE' and old.custo_unitario_base is distinct from new.custo_unitario_base and (to_jsonb(new)-'custo_unitario_base'-'updated_at')=(to_jsonb(old)-'custo_unitario_base'-'updated_at') then return null; end if;
  perform public.recalcular_pedido(coalesce(new.pedido_id, old.pedido_id));
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.concluir_separacao(_pedido_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ped record; faltando int; sem_acao int; it record;
BEGIN
 -- logistica_guard_233
 if not public.pode_rotina('separacao_concluir') then raise exception 'Ação não liberada para seu perfil'; end if;
 
    perform 1 from public.pedidos where id=_pedido_id for update;
    perform 1 from public.clientes where id=(select cliente_id from public.pedidos where id=_pedido_id) for share;
    if not public.pedido_confirmado_logistica_233(_pedido_id) then raise exception 'Pedido sem acesso ou sem confirmação operacional'; end if;
    if exists(select 1 from public.pedido_itens where pedido_id=_pedido_id and quantidade_separada is not null and quantidade_separada<>quantidade) then raise exception 'Resolva as divergências antes de concluir a separação'; end if;
   

 -- carteira_rpc_206

 if public.escopo_representante() and _pedido_id is not null and not public.documento_na_minha_carteira('pedidos',_pedido_id) then raise exception 'Documento fora da sua carteira de representante'; end if;

  if not public.can_stock(auth.uid()) then
    raise exception 'Sem permissão para separar pedidos';
  end if;
  select * into ped from public.pedidos where id = _pedido_id for update;
  if ped.id is null then raise exception 'Pedido não encontrado'; end if;
  if ped.status <> 'separacao' then
    raise exception 'O pedido não está em separação';
  end if;

  select count(*) into faltando from public.pedido_itens
   where pedido_id = _pedido_id and quantidade_separada is null;
  if faltando > 0 then
    raise exception 'Informe a quantidade separada de todos os itens (% pendente(s))', faltando;
  end if;

  select count(*) into sem_acao from public.pedido_itens
   where pedido_id = _pedido_id and quantidade_separada <> quantidade and divergencia_acao is null;
  if sem_acao > 0 then
    raise exception 'Defina o tratamento das % divergência(s) antes de concluir a separação', sem_acao;
  end if;

  -- aplica as definições das divergências
  for it in select * from public.pedido_itens
             where pedido_id = _pedido_id and quantidade_separada <> quantidade loop
    if it.divergencia_acao = 'alterar_quantidade' then
      update public.pedido_itens set quantidade = it.quantidade_separada where id = it.id;
    elsif it.divergencia_acao in ('retirar_item','cancelar_item') then
      delete from public.pedido_itens where id = it.id;
    end if;
  end loop;

  perform public.recalcular_pedido(_pedido_id);

  update public.pedido_separacoes
     set status = case when exists (
           select 1 from public.pedido_itens
            where pedido_id = _pedido_id
              and coalesce(quantidade_separada,0) <> quantidade
              and coalesce(divergencia_acao,'aguardar') = 'aguardar')
         then 'divergente' else 'separada' end,
         separada_em = now(),
         separador_id = coalesce(separador_id, auth.uid())
   where pedido_id = _pedido_id;

  update public.pedidos set status = 'separado' where id = _pedido_id;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('pedidos', _pedido_id, 'separacao_concluida',
          jsonb_build_object('numero', ped.numero), auth.uid());
end $function$;

CREATE OR REPLACE FUNCTION public.conferir_separacao(_pedido_id uuid, _obs text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ped record; divs int;
BEGIN
 -- logistica_guard_233
 if not public.pode_rotina('separacao_concluir') then raise exception 'Ação não liberada para seu perfil'; end if;
 
    perform 1 from public.pedidos where id=_pedido_id for update;
    perform 1 from public.clientes where id=(select cliente_id from public.pedidos where id=_pedido_id) for share;
    if not public.pedido_confirmado_logistica_233(_pedido_id) then raise exception 'Pedido sem acesso ou sem confirmação operacional'; end if;
    if exists(select 1 from public.pedido_itens where pedido_id=_pedido_id and quantidade_separada is not null and quantidade_separada<>quantidade) then raise exception 'Resolva as divergências antes de concluir a separação'; end if;
   

 -- carteira_rpc_206

 if public.escopo_representante() and _pedido_id is not null and not public.documento_na_minha_carteira('pedidos',_pedido_id) then raise exception 'Documento fora da sua carteira de representante'; end if;

  if not public.can_stock(auth.uid()) then
    raise exception 'Sem permissão para conferir a separação';
  end if;
  select * into ped from public.pedidos where id = _pedido_id for update;
  if ped.id is null then raise exception 'Pedido não encontrado'; end if;
  if ped.status <> 'separado' then
    raise exception 'Conclua a separação antes de conferir';
  end if;

  select count(*) into divs from public.pedido_itens
   where pedido_id = _pedido_id
     and (quantidade_separada is null or coalesce(quantidade_separada,0) <> quantidade);
  if divs > 0 then
    raise exception 'Ainda existem % item(ns) divergente(s). A conferência só pode ser concluída com todas as quantidades corretas.', divs;
  end if;

  update public.pedido_itens set conferido = true where pedido_id = _pedido_id;
  update public.pedido_separacoes
     set status = 'conferida', conferida_em = now(), conferente_id = auth.uid(),
         observacoes = coalesce(nullif(_obs,''), observacoes)
   where pedido_id = _pedido_id;
  update public.pedidos set status = 'conferido' where id = _pedido_id;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('pedidos', _pedido_id, 'separacao_conferida',
          jsonb_build_object('numero', ped.numero), auth.uid());

  perform public.notificar('Pedido ' || ped.numero || ' conferido',
    'Separação concluída e liberada para montagem da carga.', 'sucesso', '/cargas');
end $function$;

CREATE OR REPLACE FUNCTION public.enviar_pedidos_separacao_233(_pedidos uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pid uuid; p public.pedidos; feitos integer:=0;
begin
 if not public.usuario_ativo() or not public.pode_rotina('pedidos_enviar_separacao') or not (public.can_operate(auth.uid()) or public.can_stock(auth.uid())) then raise exception 'Sem acesso ao envio para separação'; end if;
 if _pedidos is null or cardinality(_pedidos) not between 1 and 100 or array_position(_pedidos,null) is not null or (select count(distinct x) from unnest(_pedidos) x)<>cardinality(_pedidos) then raise exception 'Selecione de 1 a 100 pedidos distintos'; end if;
 for pid in select unnest(_pedidos) order by 1 loop
  select * into p from public.pedidos where id=pid for update;
  perform 1 from public.clientes where id=p.cliente_id for share;
  if p.id is null or not public.pedido_confirmado_logistica_233(pid) then raise exception 'Pedido sem acesso ou sem confirmação operacional: %',pid; end if;
  if p.status not in ('confirmado','separacao') then raise exception 'Pedido % não está confirmado para separação (status: %)',p.numero,p.status; end if;
  if p.status='confirmado' then perform public.avancar_pedido(pid,'separacao'); feitos:=feitos+1; end if;
  insert into public.pedido_separacoes(pedido_id,status) values(pid,'em_separacao') on conflict(pedido_id) do nothing;
 end loop;
 insert into public.auditoria(tabela,acao,user_id,detalhe) values('pedidos','enviar_separacao_lote_233',auth.uid(),jsonb_build_object('pedidos',_pedidos,'enviados',feitos));
 return feitos;
end $function$;

CREATE OR REPLACE FUNCTION public.avancar_pedido(_pedido_id uuid, _novo_status text)
 RETURNS pedidos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ped public.pedidos;
  permitido boolean := false;
begin
 -- orcamento_motor_236
 if exists(select 1 from public.pedidos q236 where q236.id=_pedido_id and q236.tipo_documento='orcamento') then raise exception 'Use as ações de orçamento: aceite e conversão precedem a aprovação interna'; end if;
 
 -- carteira_rpc_206

 if public.escopo_representante() and _pedido_id is not null and not public.documento_na_minha_carteira('pedidos',_pedido_id) then raise exception 'Documento fora da sua carteira de representante'; end if;

  select * into ped from public.pedidos where id = _pedido_id for update;
  if ped.id is null then raise exception 'Pedido não encontrado'; end if;

  if _novo_status in ('separado','conferido','faturado','nf_emitida','em_carga')
     and not public.can_manage(auth.uid()) then
    raise exception 'Este status é definido pelas telas de separação, faturamento ou carga';
  end if;

  permitido := case ped.status
    when 'rascunho'             then _novo_status in ('digitacao','aguardando_aprovacao','cancelado')
    when 'digitacao'            then _novo_status in ('aguardando_aprovacao','cancelado')
    when 'aguardando_aprovacao' then _novo_status in ('aprovado','recusado','cancelado')
    when 'recusado'             then _novo_status in ('digitacao','cancelado')
    when 'aprovado'             then _novo_status in ('separacao','confirmado','cancelado')
    when 'confirmado'           then _novo_status in ('separacao','cancelado')
    when 'separacao'            then _novo_status in ('separado','cancelado')
    when 'separado'             then _novo_status in ('conferido','separacao','cancelado')
    when 'conferido'            then _novo_status in ('faturado','cancelado')
    when 'faturado'             then _novo_status in ('nf_emitida','em_carga','cancelado')
    when 'nf_emitida'           then _novo_status in ('em_carga','em_rota','cancelado')
    when 'em_carga'             then _novo_status in ('em_rota','cancelado')
    when 'em_rota'              then _novo_status in ('entregue','parcial','nao_entregue','devolvido')
    else false end;

  if not permitido then
    raise exception 'Transição inválida: % → %', ped.status, _novo_status;
  end if;

  if _novo_status in ('aprovado','recusado') and not public.can_manage(auth.uid()) then
    raise exception 'Somente admin/gestor pode aprovar ou recusar pedidos';
  end if;
  if _novo_status not in ('aprovado','recusado') and not public.can_operate(auth.uid())
     and not public.can_ship(auth.uid()) and not public.can_stock(auth.uid()) then
    raise exception 'Sem permissão para alterar o status do pedido';
  end if;

  update public.pedidos set status = _novo_status where id = _pedido_id returning * into ped;

  insert into public.auditoria (tabela, registro_id, acao, detalhe, user_id)
  values ('pedidos', _pedido_id, 'status',
          jsonb_build_object('de', _novo_status, 'numero', ped.numero), auth.uid());

  perform public.notificar('Pedido ' || ped.numero,
    'Novo status: ' || _novo_status, 'info', '/pedidos');
  return ped;
end $function$;

CREATE OR REPLACE FUNCTION public.pedido_confirmado_logistica_233(_pedido uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 select public.usuario_ativo() and exists(select 1 from public.pedidos p where p.id=_pedido
  and public.usuario_pode_acessar_centro(p.centro_id)
  and (not public.escopo_representante() or public.documento_na_minha_carteira('pedidos',p.id))
  and exists(select 1 from public.estoque_movimentos m where m.documento_id=p.id and m.origem='pedido' and m.tipo='saida'));
$function$;

CREATE OR REPLACE FUNCTION public.cancelar_pedido_admin_285(_pedido uuid, _motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p public.pedidos; item record; carga record; op uuid; excluir boolean;
begin
 perform public.exigir_admin_pedido_285(_pedido,_motivo);
 select * into p from public.pedidos where id=_pedido for update;
 if p.status='cancelado' then return;end if;
 perform 1 from public.expedicoes where pedido_id=_pedido order by id for update;
 perform 1 from public.cargas where id in(select carga_id from public.carga_pedidos where pedido_id=_pedido) order by id for update;
 if p.status not in('rascunho','digitacao','aguardando_aprovacao','aprovado','recusado','confirmado','separacao','separado','conferido','faturado','nf_emitida','em_carga') or
 exists(select 1 from public.expedicoes where pedido_id=_pedido and (status in('em_rota','entregue') or data_saida is not null)) or
 exists(select 1 from public.cargas c join public.carga_pedidos cp on cp.carga_id=c.id where cp.pedido_id=_pedido and c.status not in('aberta','em_preparacao')) then
  raise exception 'A venda passou da montagem da carga. Registre devolução dos itens em vez de cancelar diretamente';end if;
 if exists(select 1 from public.devolucoes where pedido_id=_pedido and status='confirmada') then raise exception 'Pedido já tem devolução. Conclua o fluxo de devolução e acerto financeiro';end if;
 if exists(select 1 from public.comissoes where pedido_id=_pedido and status='paga') then raise exception 'Pedido com comissão paga exige acerto financeiro específico';end if;
 if exists(select 1 from public.notas_saida where pedido_id=_pedido and status in('autorizada','emitida')) then raise exception 'Pedido com nota fiscal autorizada exige cancelamento fiscal ou devolução antes do encerramento';end if;
 excluir:=p.status in('rascunho','digitacao','aguardando_aprovacao','aprovado','recusado','confirmado','separacao','separado','conferido');
 perform public.ajustar_titulos_pedido_285(_pedido,null,null,_motivo,excluir);
 insert into public.pedido_operacoes(pedido_id,tipo,created_by) values(_pedido,'cancelamento',auth.uid()) on conflict(pedido_id,tipo,ciclo_pedido_289) do nothing returning id into op;
 if op is null then raise exception 'Há cancelamento anterior inconsistente; confira o histórico';end if;
 for carga in select carga_id from public.carga_pedidos where pedido_id=_pedido order by carga_id loop
  perform public.remover_pedido_carga(carga.carga_id,_pedido);
 end loop;
 -- Reverte somente saídas efetivamente registradas. Aprovação/reserva não gera entrada fictícia.
 for item in select produto_id,sum(case when tipo='saida' and origem='pedido' then quantidade when tipo='entrada' and origem='pedido_cancelado' then -quantidade else 0 end) qtd
  from public.estoque_movimentos where documento_id=_pedido group by produto_id order by produto_id loop
  if item.qtd>0 then perform public.registrar_movimento_estoque_controlado(item.produto_id,p.centro_id,'entrada',item.qtd,null,'pedido_cancelado',_pedido,'Cancelamento administrativo: '||trim(_motivo));end if;
 end loop;
 update public.comissoes set status='cancelada' where pedido_id=_pedido and status<>'paga';
 -- contexto_expedicao_290: validações e bloqueios já concluídos.
 perform set_config('app.cancelamento_pedido_285',_pedido::text,true);
 update public.expedicoes set status='cancelada' where pedido_id=_pedido and status<>'cancelada';
 perform public.restaurar_creditos_cancelamento_pedido(_pedido);
 
 update public.pedidos set status='cancelado',cancelamento_motivo_285=trim(_motivo),cancelamento_por_285=auth.uid(),cancelamento_em_285=now() where id=_pedido;
 update public.boletos set ajuste_pedido_motivo_285=trim(_motivo),ajuste_pedido_tipo_285='cancelamento_pedido' where pedido_id=_pedido;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',_pedido,'cancelar_admin_285',auth.uid(),jsonb_build_object('motivo',trim(_motivo),'status_anterior',p.status,'exclusao_somente_titulos_sem_vinculos',excluir));
end $function$;
