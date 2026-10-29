# Colunas pessoais e impressão de boletos

A fase288 cria `preferencias_colunas`, com chave `(usuario_id,tela)` e RLS para o próprio usuário ativo. Não usa service_role no navegador. Não altera usuários, estoque, valores ou boletos. O backup externo descobre tabelas dinamicamente e inclui esta tabela automaticamente.

O componente compartilhado de tabela apresenta Colunas, identifica cabeçalhos e aplica a preferência às células correspondentes, inclusive nos cartões móveis. Nos cadastros, usa nomes estáveis dos campos e mantém as colunas opcionais do seletor anterior. Nas demais tabelas, a chave inclui a rota e o conjunto de cabeçalhos, diferenciando listas da mesma tela; filtros e paginação não alteram a preferência. Uma mudança futura na estrutura dos cabeçalhos inicia uma configuração nova. Colunas sem nome, seleção e Ações permanecem visíveis. Linhas de detalhe com colspan não são fragmentadas. Tabelas com cabeçalhos agrupados não recebem seleção por posição para evitar ocultar dados incorretos. Impressos próprios de pedido e relatórios continuam com o modelo completo.

Todas as tabelas de exibição usam o componente compartilhado, com espaço para nomes e marcas completos, quebra entre palavras e códigos/valores/status sem partir. A largura excedente fica no contêiner com rolagem horizontal. Produtos, Separação, Pedidos, cargas, cadastros, financeiro e demais listagens recebem o padrão; cartões móveis preservam os nomes completos. A lista de pedidos usa a mesma tabela no computador e nos cartões, para respeitar as mesmas colunas.

Contas a receber oferece Emitir boleto, Reimprimir boleto ou Consultar boleto conforme o ciclo atual. Falha/carregamento na consulta não oferece emissão como se não houvesse boleto. A consulta por conta é paginada.

A reimpressão compartilhada atende a tela Boletos, financeiro, pedidos e separação. Seleciona parcela/pedido/cliente usando sessão e RLS, respeita o filtro global de loja e não mistura clientes. Imprime somente o ciclo vigente API Sicredi registrado/liquidado com linha válida. PDFs originais são unidos com pdf-lib; não há nova emissão. A emissão segue limitada ao documento original, autorização/liberação e 10 por operação.

A impressão consulta no máximo 20 PDFs antes de aguardar 61 segundos; uma recusa explícita de limite pode ser repetida uma vez após a espera. Outras falhas interrompem a montagem sem apresentar PDF parcial. Interromper é cooperativo entre consultas, sem desfazer nada no banco. Nenhuma chamada bancária real foi feita nos testes.

Validação: migração real em PGlite, isolamento entre usuários/usuário inativo/anônimo e restrições; testes de ciclo, seleção de cliente e fusão dos PDFs; navegador com dados/API/PDF simulados, outro contexto de navegador e outro usuário.
