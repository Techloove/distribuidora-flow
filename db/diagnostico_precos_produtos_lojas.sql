-- DIAGNÓSTICO SOMENTE LEITURA: não altera preços nem pedidos.
-- Período: 26/10/2026, horário de Brasília. Ajuste as duas datas se necessário.
begin transaction read only;

-- 1. Alterações de preço/markup realmente registradas no cadastro geral.
select
  a.created_at at time zone 'America/Sao_Paulo' as horario_brasilia,
  p.codigo, p.descricao, a.registro_id as produto_id, a.user_id as usuario_id,
  a.acao,
  a.detalhe->'antes'->>'preco_venda' as referencia_antes,
  a.detalhe->'depois'->>'preco_venda' as referencia_gravada,
  a.detalhe->'antes'->>'markup_percentual' as markup_antes,
  a.detalhe->'depois'->>'markup_percentual' as markup_gravado
from public.auditoria a
left join public.produtos p on p.id=a.registro_id
where a.tabela='produtos'
  and a.created_at >= timestamp '2026-10-26 00:00:00' at time zone 'America/Sao_Paulo'
  and a.created_at < timestamp '2026-10-27 00:00:00' at time zone 'America/Sao_Paulo'
  and ((a.detalhe->'depois') ? 'preco_venda' or (a.detalhe->'depois') ? 'markup_percentual')
order by a.created_at, a.id;

-- 2. Preços atuais dos produtos acima: referência geral versus preço de cada loja.
-- A diferença não significa perda: os dois preços são independentes.
with alterados as (
  select distinct a.registro_id
  from public.auditoria a
  where a.tabela='produtos'
    and a.created_at >= timestamp '2026-10-26 00:00:00' at time zone 'America/Sao_Paulo'
    and a.created_at < timestamp '2026-10-27 00:00:00' at time zone 'America/Sao_Paulo'
    and ((a.detalhe->'depois') ? 'preco_venda' or (a.detalhe->'depois') ? 'markup_percentual')
)
select p.codigo, p.descricao, p.categoria, p.preco_venda as referencia_atual,
  c.nome as loja, l.preco_venda as preco_base_atual_da_loja, l.disponivel,
  l.updated_at at time zone 'America/Sao_Paulo' as ultima_configuracao_da_loja,
  l.updated_by as usuario_ultima_configuracao
from alterados a
join public.produtos p on p.id=a.registro_id
left join public.loja_produtos l on l.produto_id=p.id
left join public.centros c on c.id=l.centro_id
order by p.descricao,c.nome;

-- 3. Alterações gravadas diretamente no catálogo das lojas no mesmo período.
select a.created_at at time zone 'America/Sao_Paulo' as horario_brasilia,
  c.nome as loja, p.codigo, p.descricao, a.user_id as usuario_id,
  a.detalhe->'antes'->>'preco_venda' as preco_loja_antes,
  a.detalhe->>'preco' as preco_loja_gravado
from public.auditoria a
left join public.centros c on c.id=a.registro_id
left join public.produtos p on p.id::text=a.detalhe->>'produto_id'
where a.acao='configurar_produto_loja_244'
  and a.created_at >= timestamp '2026-10-26 00:00:00' at time zone 'America/Sao_Paulo'
  and a.created_at < timestamp '2026-10-27 00:00:00' at time zone 'America/Sao_Paulo'
order by a.created_at,a.id;

-- 4. Confirma se o gatilho atual de auditoria do cadastro geral está ativo.
-- Isso não comprova que ele estava ativo no período consultado.
select tgname as gatilho, tgenabled as habilitado
from pg_trigger
where tgrelid='public.produtos'::regclass and not tgisinternal
  and tgname='auditar_campos_209';
commit;
