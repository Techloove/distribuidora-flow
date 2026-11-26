# Revisão de consultas e estabilidade — 26/11/2026

As correções reduzem leituras que não eram necessárias para a tela aberta e protegem a apresentação de dados incompletos. A revisão usou código, bancos PGlite descartáveis e navegador com respostas fictícias. Não houve deduplicação ou alteração de dados em produção, nem chamadas bancárias reais. Não é necessário SQL para esta entrega.

## Problemas confirmados e correções

| Problema                                                                                                                                                 | Correção e efeito                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Listas de pedidos/compras liam todo o histórico permitido antes de aplicar loja e datas no navegador.                                                    | Loja e intervalo são enviados ao servidor antes da paginação. O filtro Todo o período continua disponível, e o detalhe de um documento fora dos filtros mantém sua consulta própria. Requisições substituídas recebem cancelamento. |
| O catálogo era carregado na lista de documentos, e a importação XML buscava produtos/fornecedores mesmo fechada.                                         | Catálogo somente ao abrir um documento; opções de XML somente ao abrir a seção. A tabela aguarda os produtos necessários para identificar os itens.                                                                                 |
| Vários observadores das mesmas permissões possuíam temporizadores independentes.                                                                         | Um temporizador no AppLayout atualiza apenas as consultas de acesso já ativas. Mantém 30 segundos e a política existente de erro/negação. A revogação e a recuperação de módulos continuam funcionando sem recarregar a página.     |
| Itens e quantidades de compras pendentes eram lidos sem paginação.                                                                                       | Leitura ordenada em páginas, evitando uma conferência parcial ao ultrapassar o limite de resposta.                                                                                                                                  |
| A indicação de quantidade comprada misturava origens de lojas e podia sobrescrever o valor de um produto por outro centro.                               | Consulta e cache vinculados à loja do documento, com a projeção e o acesso já existentes.                                                                                                                                           |
| Buscas por cliente e produto percorriam novamente as listas em cada linha e filtragem.                                                                   | Índices locais ao resultado da consulta. Preservam a primeira ocorrência e não modificam os cadastros.                                                                                                                              |
| Tarifas Sicredi eram consultadas mesmo quando o escopo só continha Sicoob; a consulta inicial de CNAB também podia ocorrer antes de identificar o banco. | Origens de tarifa e histórico condicionados ao banco/dados do escopo. As rotinas automáticas no servidor e os cálculos de tarifas permanecem intactos.                                                                              |
| Uma resposta de datas incompleta podia chegar ao cálculo de parcelas e causar `Invalid time value` na tela inteira.                                      | Validação da resposta antes da prévia. Mostra erro de consulta sem fabricar uma data substituta ou calcular vencimentos incorretos.                                                                                                 |
| A pendência de preço planejado era comunicada ao documento por um efeito posterior à edição, deixando uma janela com Receber compra habilitado.          | A edição e o início do salvamento comunicam a pendência no próprio evento; mantém o bloqueio enquanto houver valor não salvo ou gravação em andamento.                                                                              |
| O teste de filtros de pedidos dependia de uma data fixa antiga.                                                                                          | Fixture acompanha o dia comercial, preservando o teste do filtro inicial Hoje.                                                                                                                                                      |

## Validação

- Navegador local: zero leituras de catálogo/compras pendentes antes de abrir o pedido; catálogo disponível depois.
- Requisições de documentos incluem o intervalo selecionado no servidor.
- Uma atualização de menus e uma de ações por ciclo, com múltiplos consumidores da permissão na tela. Revogação e restauração do acesso verificadas.
- Documento com 1.001 itens carregado completo nos intervalos 0, 500 e 1.000.
- XML fechado não busca catálogo; abrir a seção carrega as opções.
- Loja somente Sicoob não consulta tarifas nem CNAB do Sicredi.
- Resposta incompleta de datas exibe a falha de consulta sem exceção de página.
- Regressões de filtros/status/totais e precificação executadas no navegador local.
- 447 testes unitários aprovados em 89 arquivos; 97/97 suítes de negócio aprovadas em bancos locais descartáveis. A rodada integral foi executada com permissão para subprocessos, pois o sandbox bloqueava parte da execução.
- TypeScript e build aprovados; lint sem erros, com os dez avisos de Fast Refresh já existentes.
- Segurança de cliente (346 arquivos, 139 RPCs e 36 tabelas protegidas), onze módulos sensíveis do servidor e 331 arquivos SQL verificados.

A medição demonstrou redução das consultas nesses cenários. Não foi estimado um percentual de ganho de velocidade em produção. Casos legítimos de Todo o período continuam sujeitos ao volume permitido pelos filtros e pela RLS; nenhuma otimização foi feita cortando registros necessários a totais ou conferências.
