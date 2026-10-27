-- Vistoria do banco real: executar no SQL Editor administrativo do Supabase.
-- UMA consulta SELECT, somente leitura. Não altera dados nem faz chamadas externas.
-- Pendências=0: nenhuma ocorrência encontrada nesta verificação; não é certificação geral.
-- Itens Operação são informativos. Atenção/Revisar exigem conferência, sem correção automática.
-- No SQL Editor sem JWT, consulta todas as lojas; autenticado, respeita os acessos.
with diagnostico as (
with lojas as (
   select c.id from public.centros c
   where auth.uid() is null or public.usuario_pode_acessar_centro(c.id)
 ), produtos_escopo as (
   select p.* from public.produtos p
   where auth.uid() is null or public.loja_produto_estoque_271(p.id) in(select id from lojas)
   or exists(select 1 from public.estoque_saldos s where s.produto_id=p.id and s.quantidade<>0 and s.centro_id in(select id from lojas))
 ), pedidos_escopo as (
   select p.* from public.pedidos p where p.centro_id in(select id from lojas)
   and (auth.uid() is null or not public.escopo_representante() or public.documento_na_minha_carteira('pedidos',p.id))
 ), compras_escopo as (
   select c.* from public.compras c where c.centro_id in(select id from lojas)
 ), reservas as (
   select r.produto_id,r.centro_id,sum(r.quantidade) quantidade
   from public.estoque_reservas r where r.centro_id in(select id from lojas)
   group by r.produto_id,r.centro_id
 ), depositos_soma as (
   select s.produto_id,d.centro_id,sum(s.quantidade) quantidade
   from public.deposito_saldos s join public.depositos d on d.id=s.deposito_id
   where d.centro_id in(select id from lojas) group by s.produto_id,d.centro_id
 ), posicoes as (
   select s.produto_id,s.centro_id,s.quantidade,coalesce(d.quantidade,0) deposito
   from public.estoque_saldos s left join depositos_soma d using(produto_id,centro_id)
   where s.centro_id in(select id from lojas)
   union all
   select d.produto_id,d.centro_id,0,d.quantidade from depositos_soma d
   where not exists(select 1 from public.estoque_saldos s where s.produto_id=d.produto_id and s.centro_id=d.centro_id)
 )
 select 'Atenção: estoque negativo sem permissão do produto'::text as verificacao,count(*) as pendencias
 from public.estoque_saldos s join public.produtos p on p.id=s.produto_id
 where s.centro_id in(select id from lojas) and s.quantidade<0 and not coalesce(p.permite_estoque_negativo,false)
 union all
 select 'Operação: estoque negativo permitido pelo cadastro',count(*)
 from public.estoque_saldos s join public.produtos p on p.id=s.produto_id
 where s.centro_id in(select id from lojas) and s.quantidade<0 and coalesce(p.permite_estoque_negativo,false)
 union all
 select 'Atenção: reservas acima do saldo da própria loja',count(*)
 from reservas r left join public.estoque_saldos s using(produto_id,centro_id)
 where r.quantidade>0 and r.quantidade>greatest(coalesce(s.quantidade,0),0)
 union all
 select 'Atenção: saldo da loja diferente dos depósitos',count(*) from posicoes where quantidade<>deposito
 union all
 select 'Atenção: saldo total do produto diferente da soma das lojas',count(*) from produtos_escopo p
 where coalesce(p.estoque_atual,0)<>coalesce((select sum(s.quantidade) from public.estoque_saldos s where s.produto_id=p.id),0)
 union all
 select 'Atenção: saldo em loja incompatível com a categoria',count(*) from public.estoque_saldos s
 where s.centro_id in(select id from lojas) and s.quantidade<>0
 and s.centro_id is distinct from public.loja_produto_estoque_271(s.produto_id)
 union all
 select 'Atenção: reservas sem vínculo válido com pedido e loja',count(*)
 from public.estoque_reservas r left join public.pedidos p on p.id=r.pedido_id
 where r.centro_id in(select id from lojas) and (
   p.id is null or p.status is distinct from 'aprovado' or p.centro_id is distinct from r.centro_id
   or r.centro_id is distinct from public.loja_produto_estoque_271(r.produto_id)
   or r.quantidade is distinct from (select sum(i.quantidade) from public.pedido_itens i where i.pedido_id=r.pedido_id and i.produto_id=r.produto_id))
 union all
 select 'Atenção: preço normal do catálogo diferente de Produtos',count(*)
 from public.loja_produtos l join public.produtos p on p.id=l.produto_id
 where l.centro_id in(select id from lojas) and l.centro_id=public.loja_produto_estoque_271(p.id)
 and l.preco_venda is distinct from p.preco_venda
 union all
 select 'Atenção: títulos a receber em loja diferente do pedido',count(*)
 from public.contas_receber t join pedidos_escopo p on p.id=t.pedido_id
 where t.centro_id is distinct from p.centro_id
 union all
 select 'Atenção: títulos a pagar em loja diferente da compra',count(*)
 from public.contas_pagar t join compras_escopo c on c.id=t.compra_id
 where t.centro_id is distinct from c.centro_id
 union all
 select 'Atenção: parcelas ativas duplicadas por pedido',count(*) from (
   select t.pedido_id,t.parcela from public.contas_receber t join pedidos_escopo p on p.id=t.pedido_id
   where t.status<>'cancelado' group by t.pedido_id,t.parcela having count(*)>1
 ) x
 union all
 select 'Atenção: parcelas ativas duplicadas por compra',count(*) from (
   select t.compra_id,t.parcela from public.contas_pagar t join compras_escopo c on c.id=t.compra_id
   where t.status<>'cancelado' group by t.compra_id,t.parcela having count(*)>1
 ) x
 union all
 select 'Revisar: pedidos confirmados sem baixa de estoque registrada',count(*) from pedidos_escopo p
 where p.status in('confirmado','separacao','separado','conferido','faturado','nf_emitida','em_carga','em_rota','entregue','parcial','nao_entregue')
 and p.tipo_documento='pedido' and p.status_regularizado_em is null
 and exists(select 1 from public.auditoria a where a.tabela='pedidos' and a.registro_id=p.id and a.acao='confirmar')
 and not exists(select 1 from public.estoque_movimentos m where m.origem='pedido' and m.documento_id=p.id and m.tipo='saida')
 union all
 select 'Revisar: pedidos confirmados sem recebíveis ou cobertura por crédito',count(*) from pedidos_escopo p
 where p.status in('confirmado','separacao','separado','conferido','faturado','nf_emitida','em_carga','em_rota','entregue','parcial','nao_entregue')
 and p.tipo_documento='pedido' and p.status_regularizado_em is null
 and exists(select 1 from public.auditoria a where a.tabela='pedidos' and a.registro_id=p.id and a.acao='confirmar')
 and p.total_liquido>coalesce((select sum(c.valor) from public.creditos_clientes_aplicacoes c where c.pedido_id=p.id and c.status='aplicado'),0)+0.01
 and not exists(select 1 from public.contas_receber t where t.pedido_id=p.id and t.status<>'cancelado')
 and not exists(select 1 from public.devolucoes d where d.pedido_id=p.id)
 union all
 select 'Operação: inventários em contagem',count(*) from public.inventarios i join public.depositos d on d.id=i.deposito_id
 where i.status='contagem' and d.centro_id in(select id from lojas)
 union all
 select 'Operação: recusas aguardando retorno conferido',count(distinct d.id)
 from public.devolucoes d join public.entrega_itens t on t.devolucao_id=d.id
 where d.status is distinct from 'confirmada' and d.centro_id in(select id from lojas)
 and (auth.uid() is null or not public.escopo_representante() or public.documento_na_minha_carteira('devolucoes',d.id))
)
select verificacao,pendencias from diagnostico
union all
select 'Cadastros: função Cliente sem vínculo especializado',count(*)
from public.pessoas p where p.is_cliente and not exists(select 1 from public.clientes c where c.pessoa_id=p.id)
union all
select 'Cadastros: função Fornecedor sem vínculo especializado',count(*)
from public.pessoas p where p.is_fornecedor and not exists(select 1 from public.fornecedores c where c.pessoa_id=p.id)
union all
select 'Cadastros: função Representante sem vínculo especializado',count(*)
from public.pessoas p where p.is_representante and not exists(select 1 from public.representantes c where c.pessoa_id=p.id)
union all
select 'Cadastros: função Transportadora sem vínculo especializado',count(*)
from public.pessoas p where p.is_transportadora and not exists(select 1 from public.transportadoras c where c.pessoa_id=p.id)
union all
select 'Configuração: loja ativa sem categoria de produtos',count(*) from public.centros c
where c.ativo and c.categoria_produtos_id is null
union all
select 'Configuração: loja ativa sem exatamente um depósito principal ativo',count(*) from public.centros c
where c.ativo and (select count(*) from public.depositos d where d.centro_id=c.id and d.padrao and d.ativo)<>1
union all
select 'Limites: desconto ou margem líquida fora de zero a cem',count(*) from public.loja_parametros l
where l.chave in('desconto_maximo','margem_liquida_minima')
and not (case when l.valor ~ '^[0-9]+(\.[0-9]+)?$' then l.valor::numeric between 0 and 100 else false end)
union all
select 'Limites: limite de crédito negativo ou não finito',count(*) from public.clientes c
where c.limite_credito<0 or c.limite_credito::text in('NaN','Infinity','-Infinity')
union all
select 'Cadastros: documentos repetidos no cadastro unificado',count(*) from (
 select upper(regexp_replace(p.cnpj_cpf,'[^A-Za-z0-9]','','g')) documento
 from public.pessoas p where nullif(regexp_replace(coalesce(p.cnpj_cpf,''),'[^A-Za-z0-9]','','g'),'') is not null
 group by 1 having count(*)>1
) x
union all
select 'Cadastros: login vinculado a vários representantes',count(*) from (
 select profile_id from public.representantes where profile_id is not null group by profile_id having count(*)>1
) x
union all
select 'Cobrança: boletos ativos repetidos por título',count(*) from (
 select conta_receber_id from public.boletos where conta_receber_id is not null
 and status in('pendente','em_processamento','registrado','liquidado') group by conta_receber_id having count(*)>1
) x
union all
select 'Cobrança: nosso número Sicredi repetido',count(*) from (
 select nosso_numero from public.boletos where banco='sicredi' and nullif(nosso_numero,'') is not null
 and status in('pendente','em_processamento','registrado','liquidado') group by nosso_numero having count(*)>1
) x
union all
select 'Atualização necessária: diagnóstico da tela anterior à fase276',
 case when exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.diagnostico_integridade_220()')
 and p.prosrc like '%INICIO CONSULTA276%') then 0::bigint else 1::bigint end
union all
select 'Pré-requisito ausente: '||assinatura,
 case when to_regprocedure(assinatura) is null then 1::bigint else 0::bigint end
from (values
 ('public.confirmar_pedido(uuid)'),('public.receber_compra(uuid)'),
 ('public.validar_pedido(uuid)'),('public.vencimento_pedido_227(uuid,integer)'),
 ('public.saldos_estoque_loja_271(uuid)'),('public.salvar_observacoes_pedido_274(uuid,text,text)'),
 ('public.sincronizar_preco_produto_275()'),('public.diagnostico_integridade_220()')
) f(assinatura)
union all
select 'Gatilho ausente/desabilitado: '||alvo.tabela||'.'||alvo.rotina,
 case when exists(
 select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
 where t.tgrelid=to_regclass('public.'||alvo.tabela) and p.proname=alvo.rotina
 and not t.tgisinternal and t.tgenabled in('O','A')
 ) then 0::bigint else 1::bigint end
from (values
 ('estoque_movimentos','aplicar_movimento_estoque'),
 ('estoque_movimentos','validar_estoque_negativo'),
 ('estoque_movimentos','validar_disponivel_212'),
 ('estoque_movimentos','depositar_movimento_213'),
 ('pedidos','reservar_pedido_212'),('produtos','sincronizar_preco_produto_275'),
 ('produtos','auditar_campos_209')
) alvo(tabela,rotina)
order by 1;
