# Planejamento de compras — fase294 / versão1.20.0

A aba Compras → Planejamento e reposição passa a ter um painel único de simulação, prioridades, comparação de modelos, memória de cálculo, seleção e exportação CSV/impressão. Não cria compras, reservas ou títulos financeiros ao calcular, selecionar ou exportar.

## Critério solicitado

Somente pedidos aprovados. Vendas históricas incluem Aprovado e os estados seguintes do fluxo (confirmado, separação/conferência, faturamento, carga e entrega); não incluem rascunho/digitação, aguardando aprovação, recusado ou cancelado. Não há opção para incluir esses estados excluídos. A coluna Pendência usa apenas Aprovado, anterior à confirmação que baixa estoque; etapas que já tiveram baixa não são somadas novamente como pendência.

Histórico por produto/loja: quantidade aprovada menos devoluções confirmadas da venda de origem, limitada a zero por pedido/produto. Soma primeiro linhas repetidas do produto, para não descontar uma devolução mais de uma vez. Devolução em rascunho não afeta a demanda. Pedidos com data futura não entram nas vendas históricas. Janelas acumuladas de30/60/90/120 dias incluem hoje e29/59/89/119 dias anteriores, pela data de São Paulo. Não se somam as quatro colunas como se fossem períodos independentes.

O estoque continua próprio da loja, conforme fase271: saldo produto/centro e vínculo categoria/loja. Trânsito inclui apenas compras com status Comprado; recebidas ou canceladas não reduzem novamente a necessidade. Último fornecedor identifica uma compra anterior Comprado/Recebida visível ao usuário; não é seleção automática do fornecedor ideal.

## Modelos

- **Cobertura por consumo** (padrão): alvo = mínimo + consumo diário ajustado × (cobertura + prazo + segurança adicional).
- **Repor até o mínimo**: alvo = mínimo; não acrescenta previsão futura.
- **Mínimo e máximo**: ponto de reposição = maior entre mínimo e consumo diário × (prazo + segurança). Se a posição for menor ou igual ao ponto, repõe até o máximo. Sem máximo positivo e maior ou igual ao mínimo, exige revisão e não sugere compra.
- **Atender pendências**: alvo zero; cobre falta na posição atual, sem acrescentar mínimo ou previsão futura.

Em todos: disponível = estoque físico − pendência aprovada; posição = disponível + trânsito considerado. Necessidade = máximo(alvo − posição,0). Somente quando há necessidade, aplica lote mínimo e eleva ao próximo múltiplo. Não converte necessidade nula em compra por causa do lote mínimo. Estoque negativo continua como déficit e não é truncado a zero.

Base diária: vendas30/30,60/60,90/90 ou120/120. Ponderada usa faixas não sobrepostas: `[4×v30 +3×(v60−v30) +2×(v90−v60) +(v120−v90)] /300`. Ajuste percentual de demanda aplica-se ao consumo, com intervalo -90% a300%. Média mês equivale a30 dias do consumo ajustado escolhido. Histórico recente é avisado; não extrapola automaticamente poucas vendas para um mês inteiro.

Prazo pode vir do produto, com padrão da simulação quando ausente/zero, ou do padrão para todos. Cobertura/prazo/segurança aceitam0–365 dias inteiros. Múltiplo e lote mínimo aceitam até três casas,0–1.000.000. Múltiplo zero usa1 em unidades inteiras e0,001 em KG/G/L/LT/ML/M/MT/M2/M²/M3/M³/TON/T. Os parâmetros da simulação valem para todos os produtos exibidos; embalagem, prazo real e MOQ do fornecedor exigem revisão. Produtos agora permitem editar máximo e prazo no cadastro, com as permissões existentes.

Ruptura indica disponível negativo, mesmo quando o trânsito cobre a posição futura: não promete chegada imediata. Investimento é sugestão × último custo positivo do produto, usando custo médio positivo como alternativa. Sem referência não inventa custo; os itens ficam fora do total e o painel informa a quantidade de itens sem custo. Não inclui frete, tributos adicionais, variação de preço ou conversão de embalagem. Não soma unidades diferentes em um indicador total de quantidade.

## Apresentação e rastreabilidade

Colunas: Produto, Estoque, Pendência, Comprado (em trânsito), Mínimo, Média mês,30d,60d,90d,120d; depois Sugestão, Cobertura, Investimento, Situação e Cálculo. Quantidades usam separadores brasileiros e até três decimais; moeda usa BRL com duas casas. Produto, sugestão e ação ficam fixos no computador para facilitar a comparação horizontal; telefone usa cartões. Mantém o seletor de colunas por usuário.

Cálculo abre todos os componentes da sugestão e compara os quatro modelos. Filtros por loja, grupo, marca, fornecedor anterior, prioridade e sugestão; ordenação por prioridade, produto ou investimento. CSV exporta os selecionados visíveis, ou todos os resultados filtrados quando não há seleção. Inclui fornecedor anterior, parâmetros e alertas; neutraliza fórmulas de planilha pelo exportador existente. Impressão em A4 paisagem usa todos os resultados filtrados, com resumo do modelo. O painel de parâmetros é recolhível para dar espaço à lista. Os parâmetros são de simulação e não são gravados como regra permanente do produto.

## Segurança e implantação

Aplicar a migração294 após293. A nova view é somente leitura, `security_invoker` e `security_barrier`, depende de `compras_planejar`, usuário/centro e RLS das tabelas de origem. Anon sem SELECT. Não concede escrita nem acesso a novas lojas; helpers chamados já são públicos à sessão nos escopos existentes. Consultas antigas permanecem para compatibilidade; o painel não mostra duas recomendações diferentes lado a lado.

Testes: PGlite com janelas/limites temporais, devolução parcial/integral e linhas repetidas, status aprovados/excluídos, recebido versus trânsito, dados por loja, permissão/usuário inativo e reaplicação. Modelos testados por exemplos numéricos independentes, ponderação, múltiplo/MOQ, estoque negativo, ausência de custo, parâmetros inválidos e pouco histórico. Interface validada localmente em computador/tablet/telefone, incluindo seleção, exportação simulada e memória. Sem criação de compras reais ou alteração de estoque/financeiro na homologação.
