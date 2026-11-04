# Custo histórico no fechamento e no CPV — fase327

A vistoria de 04/11/2026 encontrou 23 vendas de estoque em que o custo preservado no item difere do cadastro atual. Os totais de venda e a cobertura financeira conferem no escopo auditado. O defeito é a consulta do custo para apurar a rentabilidade histórica.

A versão 1.35.2 prioriza `pedido_itens.custo_unitario_base` no fechamento. Zero explícito continua zero. Em estoque, somente a ausência de histórico permite usar custo médio positivo, custo de compra positivo ou último custo positivo do cadastro, nessa ordem. O fechamento identifica essa estimativa e evita mostrar lucro calculado com custo desconhecido. Intermediação conserva o seu custo próprio de fábrica + frete.

`db/fase327_cpv_custo_historico.sql` faz a mesma correção em `vw_cpv` e `vw_cpv_mod_300`, mantendo colunas, filtros, modalidade, opções e privilégios existentes. A checagem `pode_ver_custos_produto_324()` protege também o custo histórico; representante sem administrador não ganha acesso ao snapshot por essa consulta. Não muda datas, elegibilidade das vendas ou regras de comissão.

A migração é transacional, repetível e rejeita definições inesperadas. Não atualiza tabelas de pedidos, itens, títulos, comissões, boletos ou estoque. Ela precisa ser aplicada no banco com uma credencial que possua `database_write`; o token de leitura usado na vistoria não permite executar DDL.

Verificação local: `node scripts/check-custo-historico-database.cjs` e `tests/custo-pedido.test.ts`. A regressão compara o custo antes/depois de alterar somente o produto, testa snapshot zero, ausência de histórico, custo médio zero com custo alternativo positivo, Intermediação, filtro de modalidade, proteção por perfil, idempotência, opções/privilégios das views e preservação de dados.

Antes de aplicar em produção, consultar e guardar a definição das duas views e as contagens/hashes das tabelas de negócio. Depois, comparar o CPV à soma dos custos históricos, rever pedidos da lista auditada e conferir a ausência de regravação. Atividade simultânea de usuários pode mudar hashes legitimamente; nesse caso examinar os registros e auditoria, sem presumir que a migração foi a causa.

Aplicação em produção concluída em 04/11/2026: duas views corrigidas, dados das seis tabelas conferidos sem alteração, CPV do administrador equivalente ao custo preservado em 13 grupos de data/loja e proteção de custos do representante mantida. Evidências em `docs/auditorias/custos-327-aplicacao.json`.
