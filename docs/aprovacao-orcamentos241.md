# Aceite com aprovação automática — fase241

Execute **todo** `db/fase241_aprovacao_automatica_orcamentos.sql` no SQL Editor do projeto correto, depois da fase240 já aplicada. Publique a atualização da interface no Lovable. Não é necessário repetir fases anteriores.

## Fluxo

Ao confirmar **Cliente aceitou — converter em pedido**, o banco preserva o mesmo documento, número, itens e valores, registra o aceite e atualiza a data comercial da venda. Em seguida, chama a validação comercial instalada (`validar_pedido`):

- Sem bloqueios e com estoque disponível para reserva: o pedido fica **Aprovado**, com data da aprovação automática registrada.
- Com limite excedido, títulos vencidos, cliente bloqueado, margem/desconto fora das regras ou outro bloqueio comercial: fica **Aguardando aprovação**, com os motivos gravados e exibidos no documento.
- Se a reserva detectar estoque indisponível, a tentativa de aprovação é revertida e o pedido permanece aguardando a gestão, com motivo de disponibilidade. Não ficam reservas parciais.

As regras configuradas de crédito, vencimento útil/tolerância, margem e desconto continuam vigentes. A aprovação pode reservar mercadoria; **não baixa estoque nem gera parcelas**. A confirmação de venda existente continua responsável pelos efeitos financeiros e físicos. O representante não ganha permissão de aprovação manual: somente a operação específica de aceite válido pode produzir aprovação automática.

A comissão após a conversão é uma previsão e segue a regra de liberação já configurada. Aceite repetido retorna a primeira decisão, sem duplicar comissão ou reserva e sem reavaliar um pedido que já ficou pendente. A gestão pode tratar as restrições e usar a aprovação manual existente. Nenhum orçamento ou pedido anterior é convertido/aprovado retroativamente pela migração.

## Integridade

O fluxo de aceite/recusa anterior é conservado numa função interna, sem EXECUTE para usuários ou anônimos. A reserva usa um contexto privado limitado ao pedido, usuário e transação corrente; o cliente não pode produzi-lo com metadados, argumentos ou variáveis de sessão. O contexto é removido ao concluir, e falhas de reserva revertem a tentativa num subbloco transacional.

O motor de reserva instalado, inclusive o estoque compartilhado da fase226, permanece ativo. Somente a condição de autorização da reserva recebe essa exceção comprovada; a RPC de aprovação manual não é alterada. Carteira, representação, centro, ação de orçamento, validade, itens e aceite continuam sendo verificados pelo servidor. A decisão e os motivos ficam na auditoria. Erros inesperados abortam a conversão em vez de serem tratados como aprovação ou falta de estoque.

O pedido e o cliente ficam bloqueados durante a decisão para proteger alterações concorrentes e trocas de carteira. O limite continua calculado pelo validador comercial existente; a migração não redefine as regras de exposição financeira.

## Conferência

- `NODE_PATH=<instalação do PGlite>/node_modules node scripts/check-aprovacao-orcamentos-database.cjs`: validação real201, apurador real209, reserva compartilhada real226 e motores reais de orçamento236/240; representante sem bloqueio, limite exato/excedido, atraso, cadastro bloqueado, margem, falta de estoque, motivos, reserva sem baixa/títulos, comissão prevista, repetição, contexto privado, aprovação manual restrita, carteira e reaplicação.
- Navegador com backend simulado: proposta sem restrição termina Aprovado e habilita confirmação; proposta com títulos vencidos termina aguardando análise, exibe o motivo e mantém confirmação desabilitada.
- Testes do aplicativo, tipos, lint, compilação e verificações de segurança.

A validação local não executa a migração no banco de produção.
