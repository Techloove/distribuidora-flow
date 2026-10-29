# Cancelamento e devolução administrativa — fase285

## Antes da saída

O perfil master corresponde a `admin`. O pedido oferece **Cancelar pedido · administrador**, com motivo obrigatório de 10 a 2.000 caracteres. O banco revalida usuário ativo, loja e estágio; estar vendo o botão não autoriza a operação. Montagem significa carga aberta ou em preparação. Carga fechada deve ser reaberta pelo fluxo operacional antes do cancelamento; cargas em rota e expedições com saída registrada exigem devolução.

O cancelamento libera reservas pelos gatilhos existentes e reverte somente saídas efetivamente registradas com origem `pedido`. Não repõe itens de uma venda apenas aprovada/reservada, nem duplica entradas em nova tentativa. Retira o pedido das cargas antes da saída pelos controladores existentes, recalcula a carga, cancela expedição e comissão não paga, e restaura créditos usados pelo motor existente.

Nas etapas iniciais até conferência, títulos abertos, não recebidos e sem vínculos podem ser excluídos. O valor anterior é registrado em auditoria. Títulos com boletos ou movimentos e títulos da montagem/faturamento ficam **cancelados**, preservando referências. Não são apagados pagamentos. A assinatura antiga `cancelar_pedido(uuid)` é mantida, mas passa a exigir o uso da ação com motivo; PATCH não oferece um desvio para cancelar sem a rotina administrativa.

NF-e autorizada/emitida, recebimentos, boleto liquidado, comissão paga ou renegociação exigem os respectivos tratamentos fiscal/financeiro antes de cancelar. Esta rotina não transmite cancelamento à SEFAZ.

## Após a saída: devolução integral ou parcial

**Devolver itens e ajustar financeiro** recebe produtos e quantidades, condição de revenda/avaria, motivo e confirmação do recebimento físico. Usa a confirmação de devolução existente para estoque, quantidades máximas e comissões. Avaria não volta ao saldo vendável. O movimento usa o custo registrado na saída original (ou custo médio quando não disponível), sem valorizar estoque pelo preço de venda rateado.

O valor é proporcional ao valor líquido do pedido, distribuindo descontos e frete pela base dos itens. Na última devolução integral, o servidor confere o saldo monetário remanescente para evitar centavos residuais. Produto repetido, quantidade inválida ou maior que o saldo, outra loja e chave de repetição divergente são recusados. Nova tentativa com a mesma chave e conteúdo não repete estoque ou financeiro.

O título atingido permanece cancelado; eventual saldo ganha um novo título ligado ao anterior, com mesmo vencimento/parcela. Não se cancela a cobrança dos itens mantidos pelo cliente. O crédito criado pelo motor da devolução é cancelado quando inteiramente compensado pela redução da dívida, ou reduzido ao saldo residual, evitando crédito em duplicidade. A compensação não é registrada como recebimento de caixa ou aplicação de crédito geradora de comissão. Motivo, títulos anteriores, saldo e compensação são auditados.

Uma devolução integral encerra o pedido como **Devolvido** e pode concluir a carga quando os outros pedidos tiverem entrega comprovada ou devolução integral confirmada. Não cria comprovante fictício de entrega. Pedidos cancelados/devolvidos não são reabertos por alteração de status. Devoluções com acerto financeiro não podem ser desfeitas isoladamente: precisam de estorno específico.

Pedidos com recebimentos, encargos/descontos no título, renegociações ou devoluções antigas ainda tratadas por crédito separado exigem o fluxo existente de devolução com crédito e conciliação específica. A operação automática falha integralmente nesses casos; nenhum estoque ou título parcial é confirmado. O botão **Abrir Devoluções** preserva a referência ao pedido para esse tratamento. A devolução operacional não substitui os documentos fiscais de devolução.

## Boletos

Boletos de pedidos cancelados ou títulos ajustados recebem aviso e motivo, sem mudar o estado bancário para baixado. **Cancelar boleto** fica restrito a administrador e exige motivo. A autorização e o motivo são gravados no banco antes da chamada ao Sicredi; somente a aceitação do comando registra solicitação pendente, e somente a consulta confirma a baixa. Não há envio ao banco na instalação desta migração.

Uma nova cobrança do saldo fica bloqueada enquanto qualquer boleto dos títulos ancestrais estiver ativo, inclusive em várias devoluções parciais sucessivas. Boletos CNAB precisam da rotina de baixa do banco/remessa. A ação API depende da configuração Sicredi e dos segredos de servidor existentes em cada hospedagem.

Se houver pagamento entre o ajuste local e a baixa bancária, a liquidação valida os dados bancários pelas regras existentes e conserva status, data, valor e prova do pagamento no boleto, com aviso para conciliação. Não reabre o título cancelado nem lança caixa automaticamente. Repetição idêntica permanece idempotente.

## Validação

- `node scripts/check-cancelamento-pedido-admin-database.cjs`: banco PGlite descartável, motores reais de devolução/crédito80, condição de estoque209, cargas233 e liquidação224; testa autoridade, motivos, exclusão/preservação, saídas/reservas, bloqueios após saída, repetição, devolução parcial/integral, avaria, saldos, ancestrais dos boletos, prova de entrega, conclusão da carga e pagamento posterior ao ajuste.
- `tests/sicredi-api391.test.ts`: banco HTTP simulado; exige administrador, motivo e autorização antes da chamada, preserva registrado até confirmação e não marca sucesso quando o banco recusa.
- Migração pré-validada no Supabase com ROLLBACK. Nenhum pedido real foi cancelado, devolvido ou enviado para baixa bancária como teste.

Aplicar `db/fase285_cancelamento_devolucao_pedidos.sql` antes da interface. A migração é transacional e reaplicável. A liberação visual no aparelho e os procedimentos fiscais/financeiros especiais precisam ser homologados na operação real.

## Representante: próprio pedido aprovado (1.14.1 / fase286)

O representante ativo pode cancelar apenas pedido de sua autoria (`created_by`), ainda `aprovado`, vinculado ao seu representante, carteira e centro permitido. A RPC bloqueia a linha antes de conferir o estágio, evitando uma corrida com a separação. A partir de separação, somente o administrador usa o cancelamento existente.

A ação exige motivo e confirmação. Reutiliza as mesmas regras de preservação de títulos com boletos, impedimentos de recebimento/fiscal e reversão exclusiva de movimentos existentes. Não concede baixa bancária, devolução ou acesso administrativo ao representante. O contexto interno é limitado ao pedido e limpo ao concluir; alterações diretas de status continuam bloqueadas.

Verificado com PGlite: autoria, carteira, estágio, bloqueio de alteração direta, cancelamento com boleto preservado e proibição da baixa pelo representante. A migração foi validada por rollback no Supabase antes da instalação. Nenhum pedido real foi cancelado como teste.
