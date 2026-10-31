-- Motores existentes, sem dados de produção.
CREATE OR REPLACE FUNCTION public.receber_titulo(_id uuid, _valor numeric, _data date DEFAULT CURRENT_DATE, _conta_id uuid DEFAULT NULL::uuid, _forma_id uuid DEFAULT NULL::uuid, _juros numeric DEFAULT 0, _multa numeric DEFAULT 0, _desconto numeric DEFAULT 0, _observacao text DEFAULT NULL::text)
 RETURNS contas_receber
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
<<recebimento_249>>
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

  select cf.centro_id into conta_centro from public.contas_financeiras cf where cf.id=recebimento_249.conta and cf.ativo;
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
$function$;

CREATE OR REPLACE FUNCTION public.pagar_titulo(_id uuid, _valor numeric, _data date DEFAULT CURRENT_DATE, _conta_id uuid DEFAULT NULL::uuid, _forma_id uuid DEFAULT NULL::uuid, _juros numeric DEFAULT 0, _multa numeric DEFAULT 0, _desconto numeric DEFAULT 0, _observacao text DEFAULT NULL::text)
 RETURNS contas_pagar
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  titulo public.contas_pagar;
  pago numeric(14,2);
  devido numeric(14,2);
  conta uuid;
  conta_centro uuid;
begin
  if not public.can_finance(auth.uid()) then
    raise exception 'Somente financeiro/gestor pode pagar títulos';
  end if;
  if coalesce(_valor,0)<=0 then raise exception 'Informe um valor maior que zero'; end if;

  select * into titulo from public.contas_pagar where id=_id for update;
  if titulo.id is null then raise exception 'Título não encontrado'; end if;
  if titulo.centro_id is null then raise exception 'Título sem centro'; end if;
  if not public.usuario_pode_acessar_centro(titulo.centro_id) then
    raise exception 'Título pertence a outro centro';
  end if;
  if titulo.status='cancelado' or titulo.status='pago' then
    raise exception 'Título não pode ser baixado no status atual';
  end if;

  conta:=coalesce(_conta_id,titulo.conta_financeira_id,
    (select id from public.contas_financeiras where ativo and (centro_id is null or centro_id=titulo.centro_id) order by created_at limit 1));
  if conta is null then raise exception 'Cadastre uma conta de banco/caixa para o centro antes de pagar'; end if;
  select centro_id into conta_centro from public.contas_financeiras where id=conta and ativo;
  if not found then raise exception 'Conta financeira nao encontrada ou inativa'; end if;
  if conta_centro is not null and conta_centro<>titulo.centro_id then raise exception 'Conta pertence a outro centro'; end if;

  if _juros<0 or _multa<0 or _desconto<0 then
    raise exception 'Juros, multa e desconto não podem ser negativos';
  end if;

  update public.contas_pagar
     set juros=juros+coalesce(_juros,0),
         multa=multa+coalesce(_multa,0),
         desconto=desconto+coalesce(_desconto,0)
   where id=_id
   returning * into titulo;

  devido:=titulo.valor+titulo.juros+titulo.multa+titulo.acrescimo-titulo.desconto;
  if _valor > greatest(devido-coalesce(titulo.valor_pago,0),0) then
    raise exception 'Valor da baixa excede o saldo do título';
  end if;

  pago:=coalesce(titulo.valor_pago,0)+_valor;

  update public.contas_pagar
     set valor_pago=pago,
         conta_financeira_id=conta,
         forma_pagamento_id=coalesce(_forma_id,forma_pagamento_id),
         data_pagamento=case when pago>=devido then coalesce(_data,current_date) else data_pagamento end,
         status=case when pago>=devido then 'pago' when pago>0 then 'parcial' else 'aberto' end,
         observacao=coalesce(nullif(_observacao,''),observacao)
   where id=_id
   returning * into titulo;

  insert into public.movimentos_financeiros
    (conta_id,data,tipo,origem,valor,centro_id,forma_pagamento_id,
     conta_pagar_id,categoria_id,descricao,documento,created_by)
  values
    (conta,coalesce(_data,current_date),'saida','pagamento',_valor,
     titulo.centro_id,coalesce(_forma_id,titulo.forma_pagamento_id),titulo.id,
     titulo.categoria_id,
     'Pagamento '||coalesce(titulo.documento,'titulo')||
       ' parcela '||coalesce(titulo.parcela,1)::text,titulo.documento,auth.uid());

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values('contas_pagar',_id,'baixa',
         jsonb_build_object('valor',_valor,'pago_depois',pago),auth.uid());

  return titulo;
end;
$function$;
