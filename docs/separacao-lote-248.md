# Separação e conferência em lote — fase248

Execute todo `db/fase248_separacao_lote_relatorios.sql` no Supabase e publique a atualização no Lovable. A fase233 precisa estar aplicada. Não há alteração de estoque, financeiro ou emissão bancária ao aplicar esta migração.

## Operação

1. Abra **Separação** e filtre por status, rota, cliente, loja, número do pedido, produto, estoque, cidade, representante ou período de data do pedido.
2. Marque os pedidos individualmente ou use **Selecionar todos do filtro**. Trocar filtros limpa a seleção efetiva para não processar pedidos ocultos.
3. Escolha o relatório desejado:
   - **Imprimir itens consolidados:** reúne as quantidades por produto e unidade de todos os pedidos selecionados. Facilita coletar a mercadoria de todos os clientes de uma vez.
   - **Imprimir separação por cliente:** cada cliente recebe seu bloco/página, com produtos, quantidades e pedidos correspondentes. Clientes homônimos continuam separados por seu cadastro.
   - **Imprimir cópias dos selecionados:** usa o modelo comercial existente, com identificação da loja e código dos produtos, um documento por pedido.
4. Os relatórios de separação mostram código, descrição, unidade, quantidade, quantidade já separada e espaço para conferência. Há prévia antes de escolher a impressora.
5. Depois da conferência física, clique em **Concluir separação dos selecionados** e confirme que conferiu todos os itens e quantidades. O lote admite até 100 pedidos em separação, separados ou já conferidos. Pedidos apenas aprovados/confirmados precisam iniciar a separação pelo fluxo existente antes da conclusão.
6. Ao concluir, uma janela pergunta sobre as próximas ações: imprimir as cópias dos pedidos ou escolher os boletos para emitir/reimprimir. As parcelas são selecionadas por pedido usando a emissão existente. Essas opções também aparecem após a conclusão individual.

**Ao filtrar por produto ou por falta, o filtro localiza os pedidos. Os novos relatórios incluem todos os itens dos pedidos selecionados.** Isso evita imprimir uma lista parcial e concluir um pedido inteiro sem a conferência dos demais itens. Os botões antigos de impressão da lista e de todos os pedidos do filtro permanecem identificados separadamente dos botões de seleção.

## Integridade e permissões

A conclusão em lote usa os motores existentes de separação e conferência da fase233/42. Uma divergência de quantidade, falta de permissão, pedido de outra carteira/loja ou situação incompatível desfaz o lote inteiro. Quantidades divergentes registradas não são sobrescritas pela confirmação de separação completa.

Mantém-se a permissão **Concluir separação** e a capacidade operacional de estoque. A operação é repetível para pedidos já conferidos e não refaz confirmação de venda, estoque, contas a receber ou comissões.

Concluir a separação não emite boletos automaticamente. A emissão/reimpressão depende de acesso financeiro, configuração da loja e parcelas aptas. Nenhum pagamento é executado por essa tela.

A impressão de cópias continua usando o componente e modelo compartilhados entre Pedidos, Separação e demais rotinas. A leitura foi paginada e dividida em grupos de IDs para não omitir itens de impressões grandes.

## Verificação

- 121 testes automatizados, TypeScript, lint sem erros (nove avisos anteriores), compilação e verificações SQL/cliente/servidor/ordem das migrações.
- PostgreSQL local/PGlite com os motores233/42 reais: conclusão múltipla, reaplicação, confirmação obrigatória, preservação de divergências, idempotência e rollback de todo o lote quando um pedido não pertence à carteira.
- Relatórios: agrupamento por SKU/unidade, homônimos, escape de HTML, deduplicação de linhas repetidas por joins e seleção dos itens completos.
- Navegador com banco simulado: seleção múltipla, filtro por produto mantendo os outros itens no relatório, prévias consolidada/cliente, confirmação em lote e opções de cópias/boletos após a conclusão.

O SQL não foi executado no Supabase de produção nesta entrega.
