# Estoque mínimo pela média de vendas — fase379

Aplique `db/fase379_estoque_minimo_por_media.sql` inteiro. A migração é transacional e reaplicável. Ela inicia os parâmetros de cada loja em **90 dias de histórico** e **30 dias de cobertura**, preservando configurações já gravadas em reaplicações. As próximas lojas recebem os mesmos parâmetros pelo mecanismo existente de criação de loja.

O cálculo é `vendas líquidas do período × dias de cobertura ÷ dias do período`. Exemplo: 900 unidades em 90 dias, com cobertura de 30 dias, resultam em mínimo de 300 unidades. As quantidades usam a unidade do produto, com arredondamento para cima na terceira casa decimal.

Configure em **Lojas → Regras comerciais, financeiras e de estoque**:

- Estoque mínimo: período da média de vendas (dias).
- Estoque mínimo: dias de cobertura.

Ambos aceitam dias inteiros de 1 a 3650. Só usuários autorizados a configurar aquela loja podem gravar. Salvar invalida as consultas de estoque, planejamento e dashboard. A consulta dos mínimos faz uma leitura agrupada por loja; não baixa o histórico de pedidos para o navegador.

A janela inclui hoje (calendário de Brasília) e os dias anteriores até completar o período. A média usa o número integral de dias, inclusive aqueles sem venda. Considera pedidos do tipo pedido, modalidade estoque, em situação efetivada (confirmado e etapas posteriores); não usa orçamento, rascunho, aprovação pendente, apenas aprovado, cancelado ou intermediação. Devoluções confirmadas são descontadas da quantidade total do produto no pedido original, com piso zero, sem repetir o abatimento quando há linhas duplicadas.

Produtos sem venda nessa janela recebem mínimo zero. Um produto novo não tem sua média artificialmente aumentada reduzindo o divisor aos dias desde a primeira venda. Antes de comprar, confira sazonalidade e falta de histórico.

Os valores efetivos atuais já são recalculados ao aplicar o SQL: não há lista de produtos a atualizar manualmente nem tarefa diária que possa deixar um mínimo gravado desatualizado. Estoque → Consultar saldos mostra a regra e o mínimo por produto; a leitura atualiza a cada minuto enquanto a consulta está aberta. Planejamento, reposição e alertas dos dashboards usam o mesmo cálculo. O valor manual antigo na coluna global do produto é preservado como dado legado, mas deixa de ser a fonte dessas rotinas e sai do formulário de edição. Não se mistura mínimo de lojas diferentes numa coluna global.

O alerta por queda de saldo usa o mínimo da loja e respeita sua opção de notificação. Alterações de parâmetros não geram notificações em massa: a consulta de saldos e o dashboard mostram os mínimos recalculados; notificações de estoque ocorrem quando há cruzamento do mínimo numa redução do saldo físico.

A mudança não movimenta saldos, reservas ou financeiro, não altera preços e não cria compras automaticamente. Os métodos de planejamento mantêm seus cálculos existentes: a cobertura por consumo ainda acrescenta projeção futura ao mínimo, enquanto Repor até o mínimo usa diretamente o mínimo calculado.

Validação local: `node scripts/check-estoque-minimo-media-database.cjs`, com PostgreSQL PGlite, testa janelas 90/120, cobertura alterável, devoluções, datas-limite, estoque por loja, leitura anônima negada, permissões de gravação, planejamento atual/legado e quatro variantes de dashboard. A aplicação em produção depende da execução do SQL no projeto.
