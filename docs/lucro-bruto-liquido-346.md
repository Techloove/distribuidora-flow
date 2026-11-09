# Lucro bruto e líquido — fase346 / versão1.43.2

A seleção Com/Sem comissão do relatório usava `lucro_bruto_com` para exibir um valor que já descontava a comissão. Quando as outras despesas eram zero, ele ficava igual ao líquido, confundindo os conceitos.

Regra de apresentação e ordenação:

- Lucro bruto = vendas líquidas − CMV.
- Lucro líquido estimado do pedido = lucro bruto − comissão − custo de frete − tributos estimados − despesas variáveis registradas no pedido.
- A margem líquida estimada continua sendo o líquido dividido pelas vendas líquidas.

A seleção com/sem comissão foi removida. Totais, período anterior, tabelas, rankings, gráficos e exportações usam as mesmas chaves: `lucro_bruto_sem` e `lucro_liquido_com`. A fase346 corrige o alias legado `lucro_bruto_com` na RPC instalada, inclusive para clientes antigos e ordenação, preservando assinatura, permissões, filtros por carteira/loja/modalidade, paginação, devoluções e custos históricos. Os campos líquidos legados permanecem por compatibilidade, mas a interface não apresenta um resultado sem comissão como líquido.

Na prévia de fechamento do pedido, o líquido também desconta frete, tributos e despesas das vendas de estoque, além das de intermediação que já faziam esse desconto. Não altera a gravação nem a aprovação comercial. A classificação nos painéis financeiro, relatórios financeiros e views de rentabilidade foi revista: o bruto já é receita menos custo; contribuição e resultado após comissão têm nomenclatura própria. Despesas gerais sem vínculo com pedido permanecem na DRE, sem rateio inventado no relatório de vendas.

Validação: 329 testes unitários, 2.048 verificações, TypeScript, build e verificações SQL/manual/datas/versão. O teste descartável de relatórios aplica a fase346 duas vezes e cobre bruto540/líquido435, comissão45 e despesas60, totais, pedido, ranking, ordenação bruta canônica/legada, devoluções, prejuízo, custos históricos, paginação de 1.101 pedidos e restrições de acesso. Navegador validou tabela, CSV, remoção do seletor e ocultação de custos/lucro para perfil sem permissão.

A auditoria `auditorias/lucro-bruto-liquido-346.json` confirma preservação de pedidos, itens, comissões, contas a receber e movimentos na aplicação da migração, e valida as identidades do bruto/líquido no relatório real.
