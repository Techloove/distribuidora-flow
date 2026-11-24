begin;
-- Reapuração usa os valores aprovados do novo ciclo, nunca as taxas atuais do catálogo.
create or replace function public.comissao_comprometida_373(_comissao uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.comissoes where id=_comissao and status='paga')
 or exists(select 1 from public.comissao_pagamento_itens i join public.comissao_pagamentos pg on pg.id=i.pagamento_id
 left join public.contas_pagar t on t.id=pg.conta_pagar_id
 where i.comissao_id=_comissao and (pg.status<>'cancelado' or t.status='pago' or coalesce(t.valor_pago,0)>0))
 or exists(select 1 from public.comissao_parcelas cp join public.contas_pagar t on t.id=cp.conta_pagar_id
 where cp.comissao_id=_comissao and (t.status<>'cancelado' or coalesce(t.valor_pago,0)>0))
$$;
revoke all on function public.comissao_comprometida_373(uuid) from public,anon,authenticated,service_role;
do $patch$
declare d text; alvo text := 'if p.status in (''rascunho'',''digitacao'',''aguardando_aprovacao'',''aprovado'') then';
begin
 select pg_get_functiondef('public.apurar_comissao_pedido(uuid)'::regprocedure) into d;
 if position('elegibilidade_302' in d)=0 or position('recebe_comissao_304' in d)=0 then
  raise exception 'Aplique as fases302 e304 antes da fase373';
 end if;
 if position('novo_ciclo_373' in d)=0 then
  if position(alvo in d)=0 or position('base:=coalesce(c.base_original' in d)=0 then
   raise exception 'Motor de comissão incompatível: revise antes de aplicar a fase373';
  end if;
  d:=replace(d,alvo,$novo$
 -- novo_ciclo_373: a reabertura cancela a comissão do ciclo anterior.
 if c.status='cancelada' and coalesce(p.ciclo_reabertura_289,0)>0
    and public.status_comissao_valido_302(p.tipo_documento,p.status) then
  if public.comissao_comprometida_373(c.id) then
   raise exception 'Comissão paga ou agendada exige acerto específico antes da nova aprovação';
  end if;
  base:=greatest(coalesce(p.total_itens,0)-coalesce(p.desconto_valor,0),0);
  valor_base:=coalesce(p.comissao_valor,round(base*coalesce(p.comissao_percentual,0)/100,2));
  insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe)
  values('comissoes',c.id,'novo_ciclo_373',auth.uid(),jsonb_build_object(
   'pedido_id',p.id,'ciclo',p.ciclo_reabertura_289,'base_anterior',c.base_original,
   'valor_anterior',c.valor_original,'base_nova',base,'valor_novo',valor_base));
 elsif p.status in ('rascunho','digitacao','aguardando_aprovacao','aprovado') then
$novo$);
  execute d;
 end if;
end $patch$;
commit;
