-- Regularização explícita dos seis pedidos conferidos com o administrador.
-- Não reprecifica vendas, não cria pagamentos e não altera comissões quitadas.
begin;
do $$declare p public.pedidos;c public.comissoes;r public.representantes;b numeric;v numeric;antes jsonb;administrador uuid;begin
 select * into r from public.representantes where id='92585c89-d6d4-4847-be4f-6760686b8fdc' for update;
 if r.id is not null and r.comissao_percentual=0 then
  select pr.id into administrador from public.profiles pr join public.user_roles ur on ur.user_id=pr.id and ur.role='admin' where lower(pr.email)='techloove1@gmail.com' and pr.ativo limit 1;
  if administrador is null then raise exception 'Administrador responsável não encontrado';end if;
  update public.representantes set comissao_percentual=5,comissao_definida_em=clock_timestamp(),comissao_definida_por=administrador where id=r.id;
  if r.pessoa_id is not null then update public.pessoas set comissao_percentual=5 where id=r.pessoa_id;end if;
  insert into public.auditoria(tabela,registro_id,acao,detalhe) values('representantes',r.id,'correcao_comissao_303',jsonb_build_object('antes',r.comissao_percentual,'depois',5,'motivo','Administrador confirmou 5% para todos os produtos, inclusive KENEDE'));
 end if;
 for p in select * from public.pedidos where tipo_documento='pedido' and ((numero=13 and representante_id='92585c89-d6d4-4847-be4f-6760686b8fdc') or (numero in(23,25,28,33,34) and representante_id='206d5874-25fb-447f-ba94-e7d7f8f95d2e')) order by id for update loop
  -- A auditoria torna a migração idempotente sem recalcular pedidos já corrigidos.
  if exists(select 1 from public.auditoria where tabela='pedidos' and registro_id=p.id and acao='correcao_comissao_303') then continue;end if;
  select * into c from public.comissoes where pedido_id=p.id for update;
  if c.id is null or c.status<>'prevista' or not public.status_comissao_valido_302(p.tipo_documento,p.status) then raise exception 'Pedido % fora do estado previsto para corrigir comissão',p.numero;end if;
  if exists(select 1 from public.comissao_pagamento_itens where comissao_id=c.id) or exists(select 1 from public.comissao_parcelas where comissao_id=c.id) or exists(select 1 from public.devolucoes where pedido_id=p.id and status='confirmada') then raise exception 'Pedido % tem pagamento/agendamento/devolução: exige conferência específica',p.numero;end if;
  if not exists(select 1 from public.pedido_itens where pedido_id=p.id) or exists(select 1 from public.pedido_itens i join public.produtos pr on pr.id=i.produto_id where i.pedido_id=p.id and (pr.comissao_percentual is distinct from 5 or pr.comissao_fixa_unidade is not null)) then raise exception 'Pedido % possui regra de produto diferente de 5%%; preserve a prioridade do produto',p.numero;end if;
  b:=greatest(p.total_itens-coalesce(p.desconto_valor,0),0);v:=round(b*0.05,2);
  antes:=jsonb_build_object('pedido_percentual',p.comissao_percentual,'pedido_valor',p.comissao_valor,'comissao',to_jsonb(c));
  update public.pedidos set comissao_percentual=5,comissao_valor=v where id=p.id;
  update public.comissoes set base_calculo=b,base_original=b,percentual=5,valor=v,valor_original=v where id=c.id;
  insert into public.auditoria(tabela,registro_id,acao,detalhe) values('pedidos',p.id,'correcao_comissao_303',jsonb_build_object('antes',antes,'base',b,'percentual',5,'valor',v,'motivo','Correção dos valores legados após confirmação explícita de comissão de 5% pelo administrador'));
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
