-- Diagnóstico do banco real: executar com usuário administrativo no SQL Editor.
-- NÃO corrige nem apaga dados. Resultado é sinal para investigação, não prova de erro.
-- Não consulta senhas, tokens ou credenciais bancárias. Amostras limitadas a 100 grupos.
begin transaction read only;

-- 1. Documentos repetidos no cadastro único (considera CNPJ alfanumérico).
select upper(regexp_replace(cnpj_cpf, '[^A-Za-z0-9]', '', 'g')) as documento,
       count(*) as quantidade, array_agg(id) as cadastros
from public.pessoas
where nullif(regexp_replace(coalesce(cnpj_cpf,''), '[^A-Za-z0-9]', '', 'g'),'') is not null
group by 1 having count(*) > 1 limit 100;

-- 2. Um login ligado a mais de um representante.
select profile_id, count(*) as quantidade, array_agg(id) as representantes
from public.representantes where profile_id is not null
group by profile_id having count(*) > 1 limit 100;

-- 3. Boletos ativos repetidos para a mesma parcela.
select conta_receber_id, count(*) as quantidade, array_agg(id) as boletos
from public.boletos
where status in ('pendente','em_processamento','registrado','liquidado')
group by conta_receber_id having count(*) > 1 limit 100;

-- 4. Nosso número Sicredi repetido, independente do centro de custo.
-- Erros/cancelamentos podem exigir interpretação do histórico pelo financeiro.
select banco, nosso_numero, count(*) as quantidade, array_agg(id) as boletos
from public.boletos
where banco='sicredi' and nullif(nosso_numero,'') is not null
  and status in ('pendente','em_processamento','registrado','liquidado')
group by banco, nosso_numero having count(*) > 1 limit 100;

-- 5. Parcelas ativas duplicadas originadas de pedido/compra.
select pedido_id, parcela, count(*) as quantidade, array_agg(id) as titulos
from public.contas_receber where pedido_id is not null and status <> 'cancelado'
group by pedido_id, parcela having count(*) > 1 limit 100;
select compra_id, parcela, count(*) as quantidade, array_agg(id) as titulos
from public.contas_pagar where compra_id is not null and status <> 'cancelado'
group by compra_id, parcela having count(*) > 1 limit 100;

-- 6. Centro do título diferente do documento que o gerou.
select t.id as titulo, t.pedido_id, t.centro_id as centro_titulo, p.centro_id as centro_pedido
from public.contas_receber t join public.pedidos p on p.id=t.pedido_id
where t.centro_id is distinct from p.centro_id limit 100;
select t.id as titulo, t.compra_id, t.centro_id as centro_titulo, c.centro_id as centro_compra
from public.contas_pagar t join public.compras c on c.id=t.compra_id
where t.centro_id is distinct from c.centro_id limit 100;

-- 7. Saldo negativo sem autorização do produto.
select s.produto_id, s.centro_id, s.quantidade
from public.estoque_saldos s join public.produtos p on p.id=s.produto_id
where s.quantidade < 0 and not coalesce(p.permite_estoque_negativo,false) limit 100;

-- 8. Diferença entre saldo global legado e soma por centro.
-- Pode ser saldo anterior à migração por centro: investigar antes de qualquer ajuste.
select p.id as produto_id, p.estoque_atual as saldo_legado,
       coalesce(sum(s.quantidade),0) as saldo_centros
from public.produtos p left join public.estoque_saldos s on s.produto_id=p.id
group by p.id, p.estoque_atual
having abs(coalesce(p.estoque_atual,0)-coalesce(sum(s.quantidade),0)) > 0.001 limit 100;

-- 9. Constraints ainda não validadas; FKs e CHECKs preservam rastreabilidade.
select conrelid::regclass as tabela, conname, contype
from pg_constraint where connamespace='public'::regnamespace and not convalidated;

-- 10. Tabelas públicas sem RLS (inclui tabelas técnicas; revisar a finalidade).
select c.relname as tabela
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;

-- 11. Views que não aplicam as permissões do chamador.
select c.relname as view
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='v'
  and not coalesce(c.reloptions @> array['security_invoker=true'],false);

-- 12. Funções SECURITY DEFINER públicas executáveis por visitante anônimo.
-- Não retorna corpos de função nem informações de configuração.
select p.oid::regprocedure as funcao
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef
  and has_function_privilege('anon',p.oid,'EXECUTE');

-- 13. Volume das listagens antigas: comparar com o limite de resposta do PostgREST.
select 'pedidos' as tabela, count(*) as registros from public.pedidos
union all select 'contas_receber', count(*) from public.contas_receber
union all select 'contas_pagar', count(*) from public.contas_pagar
union all select 'produtos', count(*) from public.produtos
union all select 'pessoas', count(*) from public.pessoas
union all select 'boletos', count(*) from public.boletos;

commit;
