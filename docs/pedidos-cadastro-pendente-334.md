# Pedidos com cadastro de cliente pendente — fase334

A fase284 já obriga clientes criados pelo representante a permanecerem com `pessoas.credito_pendente=true`, limite zero e status bloqueado até a liberação por administrador. A carteira, loja e rota são atribuídas pelas regras existentes. A fase334 reutiliza essa revisão, sem criar uma segunda autorização nem liberar clientes anteriores automaticamente.

O representante pode escolher o cliente pendente, preparar e imprimir o pedido em digitação, e usar **Enviar para aprovação de cadastro**. O status persistido ao enviar é `aguardando_aprovacao`; a pendência é identificada na linha e no detalhe. Enquanto prepara os itens e pagamento, o status de edição é preservado e a pendência cadastral já é exibida. Orçamentos mantêm seu fluxo de negociação e aceite.

A antiga trava não aceitava sequer enviar para análise. Agora `exigir_credito_liberado_284` permite digitação, aguardando aprovação e cancelamento, mas recusa aprovação e etapas posteriores enquanto o cliente está pendente. `confirmar_pedido` e `avancar_pedido` recebem guarda antecipada privada para impedir efeitos de estoque, parcelas e comissões antes da liberação, inclusive se o solicitante for administrador. `validar_pedido` explica o motivo cadastral no bloqueio existente. As guardas da fase333 e todas as demais validações são preservadas.

O administrador abre **Cadastro Unificado → Clientes aguardando aprovação de cadastro e limite**, revisa os dados e usa **Revisar cadastro e liberar limite**, informando o limite positivo exigido pela regra atual. A função administrativa existente preserva a auditoria. A liberação não muda o status do pedido, não confirma a venda e não substitui a análise comercial de crédito, preço, estoque ou outras pendências.

A tela consulta somente os identificadores pendentes em `pessoas`, por páginas e sob as políticas existentes de usuário, carteira, loja e licença; não expõe cadastros de outras carteiras ou novas informações sensíveis. Falhas na consulta suspendem os comandos de confirmação/aprovação na tela. As verificações do servidor continuam obrigatórias.

## Verificações

`node scripts/check-clientes-representante-database.cjs` usa a sincronização real de pessoa/cliente, proteção de crédito e RLS de carteira/loja. Testa cadastro pelo representante, preparação e envio do pedido, bloqueio de liberação pelo representante, isolamento de outra carteira, aprovação e confirmação administrativas recusadas antes da liberação, ausência de efeitos, liberação explícita e pedido ainda em análise, conclusão posterior e instalação repetida. Mantém as verificações anteriores de revogação, loja, limites e legado.

A migração altera somente funções. Não cria clientes de teste em produção, não concede créditos, não muda status de pedidos existentes e não gera parcelas ou comissões.
