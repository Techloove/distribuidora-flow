# Fase269 — regularização administrativa de pedidos antigos

No editor SQL do Supabase, execute somente o conteúdo de `db/fase269_regularizacao_status_pedidos.sql`. Este guia Markdown não é SQL. A migração é reaplicável e não altera o status de nenhum pedido durante a instalação. Requer o acompanhamento da fase236 e o fluxo operacional existente.

Em **Pedidos de Vendas**, abra um pedido a partir de **Em separação** e clique **Regularizar status**. A ferramenta aparece somente para administradores. Selecione uma etapa posterior, informe a data em que ocorreu e o motivo, confirme a conferência dos registros e salve. É possível avançar diretamente para **Entregue** sem executar etapas intermediárias fictícias.

Destinos: separado, conferido/pronto para carga, faturado, carga montada, em rota e entregue, sempre posteriores ao status atual. Nota fiscal emitida não é um destino manual. Pedidos com nota fiscal já registrada podem avançar nas etapas logísticas sem alterar seus documentos. Não há retorno de etapas nem regularização de orçamentos, pedidos antes da separação, cancelados, devolvidos, parciais ou não entregues. Havendo itens de entrega parcial/recusa, o ajuste também é bloqueado; trate a ocorrência em Entregas.

A autorização é conferida novamente no banco: administrador ativo, cadastro concluído, acesso à rotina, loja do pedido e carteira quando aplicável. Gestores, representantes e demais papéis não recebem essa exceção. O bloqueio de linha e o status esperado impedem sobrescrever uma mudança concorrente. A data deve estar entre a data do pedido e o dia atual de Brasília; o motivo deve conter 10 a 1000 caracteres.

A regularização altera o status do pedido e registra usuário, data de gravação, data da ocorrência e motivo. No destino entregue, preenche a data de entrega com a data informada. O histórico registra a transição real (ex.: separação → entregue), com motivo, e a auditoria identifica a ação `regularizacao_status_manual`. O acompanhamento sinaliza que a etapa foi informada administrativamente, sem afirmar que houve comprovação pelo fluxo de entregas.

**O ajuste não cria nem altera nota, boleto, contas a receber, baixa financeira, comissão, movimento de estoque, itens separados/conferidos, romaneio ou carga.** Não preenche faturamento com uma data atual fictícia. Pedidos ajustados para faturado não têm seu faturamento comercial reexecutado. Relatórios que filtram o status passam a refletir a nova situação do pedido; o responsável deve conciliar eventuais pendências comerciais/fiscais existentes.

Romaneios e cargas vinculados são preservados. Portanto, mudar o pedido para entregue não encerra automaticamente uma carga nem cria comprovante. Confira esses registros separadamente no fluxo operacional. A ferramenta resolve o status do pedido antigo e não substitui uma operação logística pendente.

O fluxo normal continua disponível e seus gatilhos permanecem ativos. Somente a RPC autorizada abre um contexto privado, restrito à transação e ao pedido, que impede sincronização da expedição, recálculo de comissão e preenchimento automático de faturamento durante o ajuste. Usuários não podem inserir ou ativar esse contexto. Se o pedido avançar depois pelo fluxo normal, o marcador atual de regularização é removido, mantendo o histórico e a auditoria anteriores.

Validação local: testes das opções de avanço; regressão PGlite com migração reaplicada, autorização, isolamento por loja/carteira, datas, status concorrente, bloqueios fiscal/parcial, histórico, comparação dos registros operacionais e controle de que gatilhos normais continuam funcionando. Nenhum pedido real ou serviço fiscal/bancário foi alterado nos testes.

Para reproduzir a regressão SQL, disponibilize `@electric-sql/pglite` no ambiente de validação e execute `node scripts/check-regularizacao-status-database.cjs`. Execute também os testes, tipagem, build e verificações de segurança do projeto.
