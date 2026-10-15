# Relatórios de Vendas unificados — fase230

Execute integralmente `db/fase230_relatorios_vendas_unificados.sql` no SQL Editor do Supabase, após a fase229, e atualize o aplicativo com Ctrl+F5. Não altera pedidos, estoque, títulos nem a configuração Sicredi.

O menu **Gestão → Relatórios de Vendas** reúne os antigos Relatórios e Relatório de vendas. `/relatorios` redireciona para `/relatorio-vendas`. Os acessos dos dois menus são reunidos; o editor de Usuários e papéis normaliza o endereço antigo.

## Uso

- Abre no mês atual até hoje, pelo calendário de São Paulo. Escolher um mês no campo **Selecionar mês completo** troca as datas pelo primeiro e último dia desse mês. Também aceita período personalizado de até 367 dias.
- Uma única faixa de filtros de período, representante, rota, cidade/UF, cliente/código, centro de custo e situação vale para indicadores, evolução mensal, rankings, pedidos, produtos, comissões e comparativo de centros. O centro global selecionado tem prioridade e esconde o seletor local.
- Visão geral apresenta vendido, vendas após devoluções, pedidos, ticket, peso, comissões, composição de custos e evolução mensal (gráfico quando há mais de um mês).
- Rentabilidade alterna **com / sem comissão**, incluindo indicadores, rankings, detalhes, evolução mensal e comparativo. Na composição, ambos os resultados líquidos também aparecem lado a lado.
- Rankings agrupa por rota, cidade, representante, cliente, centro ou mês. Ordena por vendas, pedidos, comissão, peso, lucro bruto, lucro líquido estimado ou margem, em ordem crescente ou decrescente. Grupos sem dimensão não são descartados. Margem é a divisão dos totais, nunca a média das margens dos pedidos.
- Pedidos e rankings têm páginas de 50; os totais e comparações são apurados no banco sobre todo o filtro, sem limites de 1000/5000 documentos no navegador. A exportação CSV das listas corresponde à página exibida e é identificada como **Exportar página**. Impressão usa a área/aba atual. CSV neutraliza fórmulas de planilha.
- Produtos e comissões preservam os rankings antigos: 20 maiores no período filtrado, com código do produto e valores de comissão paga / prevista ou liberada. Todas as representações podem ser consultadas no ranking paginado.
- Comparativo de centros mantém o controle `indicadores_comparar`, restrito à gestão. Usa os mesmos filtros e critérios do restante da tela. O período anterior tem a mesma duração e termina na véspera do início escolhido.

## Critérios financeiros

Vendas efetivadas: confirmado, separacao, separado, conferido, faturado, nf_emitida (compatibilidade histórica), em_carga, em_rota, entregue, parcial, nao_entregue, devolvido. Não emite nota fiscal. Rascunhos, digitação, apenas aprovados, aguardando aprovação, recusados e cancelados não entram.

**Total vendido** = soma dos totais líquidos originais dos pedidos (já inclui descontos, acréscimos e frete cobrado). **Vendas líquidas após devoluções** = total vendido − devoluções confirmadas desses pedidos nos centros permitidos. As devoluções podem ter sido confirmadas depois do período: é uma análise da carteira de pedidos pela data de venda, não um fechamento contábil imutável por data da devolução.

**CMV** usa quantidade × custo histórico `custo_unitario_base`. Na ausência, usa custo médio, preço de custo ou último custo atual, na mesma ordem da rotina209. A tela informa o número de itens que usam custo atual. Itens com custo zero ou ausente geram aviso, incluindo pedidos sem itens. Devoluções em condição de revenda revertem CMV pela média ponderada do custo do produto naquele pedido. Avarias mantêm o custo.

**Lucro bruto sem comissão** = vendas líquidas − CMV. A variante com comissão também deduz a comissão. **Lucro líquido estimado** deduz adicionalmente custo do frete, tributos estimados e despesas variáveis informados no pedido; a comissão entra uma única vez. A margem acompanha a variante escolhida. Receita zero gera margem nula, exibida como traço.

Não deduz nem rateia despesas fixas ou lançamentos independentes de custos de rota. Valores ainda não informados permanecem conforme cadastrados. Portanto o indicador é expressamente **estimado**, sem substituir a DRE geral da empresa. Tributos e despesas do pedido não são recalculados automaticamente após devoluções.

Comissão soma os lançamentos não cancelados (sem multiplicar pedidos por linhas de comissão). Na ausência de qualquer lançamento, usa a comissão prevista no pedido. Se todos os lançamentos foram cancelados, a comissão é zero. Lançamentos pagos permanecem como custo pelo valor registrado; ajustes de devolução de comissões já pagas precisam do tratamento da rotina de comissões, sem supor recuperação automática de dinheiro. Totais pagos e a pagar são dos lançamentos, não de estimativas sem lançamento.

Peso e ranking de produtos usam os itens originais, antes das devoluções. O valor de produto é o total do item antes dos descontos gerais, acréscimos e frete; não se inventa lucro por produto por rateio de despesas.

## Segurança e permissões

`vendas_relatorio_ver` controla a consulta; `vendas_rentabilidade_ver` controla custos e lucros separadamente. Ambos aparecem em Usuários e papéis, no módulo Relatórios de Vendas. Na primeira aplicação, os papéis com um dos menus antigos recebem acesso à consulta. Apenas papéis que também já tinham `margem_pedido_ver` recebem rentabilidade; administradores e gestores seguem o acesso total existente. Reaplicar não restaura ações revogadas.

As RPCs SECURITY DEFINER conferem usuário ativo, ação/menu, centros e carteira explicitamente antes de ler pedidos. Representantes exigem cliente atualmente na sua carteira **e** pedido da sua representação; representante com outro papel continua restrito, exceto admin. Sem vínculo resulta em lista vazia. Os filtros de rotas, cidades e representantes também vêm apenas de pedidos acessíveis. Nenhum custo, lucro ou indicador de custo ausente é retornado sem a ação de rentabilidade (campos nulos); também é bloqueada a ordenação financeira sem essa ação. Anônimos não têm execução. Não amplia SELECT ou DML de tabelas.

## Validação local

`NODE_PATH=/workspace/.onboarding-tools/node_modules node scripts/check-relatorios-vendas-database.cjs` executa SQL PostgreSQL em PGlite com os auxiliares reais206/211. Verifica fórmulas com/sem comissão, devoluções de revenda e avaria, custos históricos/atuais e lucro negativo, valores nulos/receita zero, múltiplas linhas de comissão sem duplicação, filtros, rankings/pedidos paginados, mais de1100 pedidos sem truncar, carteiras A/B, centros, perfis combinados, admin, inatividade, transferência de carteira, revogação/reaplicação e anônimo. Não conecta ao banco de produção.
