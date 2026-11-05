# Aprovação de pedidos sem estoque — fase333

A confirmação direta tratava falta de estoque apenas como alerta e permitia saída negativa autorizada pelo produto. A fase333 impede que representante sem admin confirme venda de estoque quando o disponível da loja, descontadas reservas de outros pedidos, for insuficiente. O item permanece salvo e pode ser impresso e enviado para análise. A confirmação é verificada novamente no clique e no servidor antes de aprovação implícita, movimentos, parcelas ou comissões.

A guarda é instalada nas rotinas existentes `confirmar_pedido` e `avancar_pedido`, após o bloqueio do pedido. Acesso, carteira, loja, crédito e validações existentes continuam aplicados. Representante sem admin não aprova nem recusa; um trigger protege essa decisão também em atualizações internas. A escrita direta pelo navegador continua bloqueada pelas políticas existentes. A gestão preserva suas permissões e as regras de estoque do produto. Intermediação não depende do estoque da loja.

O painel oculta confirmação durante consulta/falha de estoque e quando houver insuficiência. Imprimir e Enviar para aprovação continuam disponíveis nas etapas apropriadas. Na análise, o representante aguarda a gestão.

## Pedido 94

Por solicitação expressa do proprietário, foi usado `reabrir_pedido_digitacao_289`, seguido de `avancar_pedido` para `aguardando_aprovacao`, em transação única com motivo auditado. A rotina validou ausência de impedimentos bancários, financeiros e logísticos; reverteu o estoque e preservou três parcelas anteriores como canceladas. Um item e total R$ 207,80 mantidos. Resultado sem dados pessoais em `auditorias/pedido-94-retorno-aprovacao-333.json`.

## Validação

`node scripts/check-aprovacao-estoque-333.cjs` testa bloqueio antes de qualquer efeito financeiro/estoque, envio para aprovação permitido, aprovação direta recusada, insuficiência mesmo após aprovação, estoque suficiente, administrador e instalação repetida. A fase332 permanece responsável pela disponibilidade agregada por produto e loja, reservas externas e escopo; seus testes são executados em conjunto.
