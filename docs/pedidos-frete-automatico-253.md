# Pedidos — frete automático e organização (fase253)

Execute inteiro `db/fase253_frete_automatico_pedido.sql` após a fase250 e publique no Lovable. Não reaplique as fases antigas. A migração não reprecifica documentos. Os documentos anteriores são avaliados ao abrir/editar com usuário autorizado, preservando vendas aprovadas e a última dispensa manual registrada.

## Frete

Novos documentos usam a opção interna **automático**. Ao incluir um produto com pelo menos uma tarifa ativa de frete por volume na loja, a cobrança fica marcada. O cálculo usa a tarifa da cidade/UF do cliente. Se faltar essa tarifa, o aviso existente informa que não há valor para a cidade; a Central de pendências continua indicando as configurações faltantes. Uma tarifa de zero é válida.

Os encargos são recalculados ao salvar os itens e conferidos ao abrir um documento editável em modo automático. O pedido/orçamento aguarda essa conferência antes das ações de aprovação/aceite. Produtos sem tarifa, ou a retirada de todos os itens que usam essa cobrança, deixam o frete automático desmarcado.

Para não cobrar, desmarque **Aplicar frete por volume** e clique em **Atualizar encargos**. A dispensa fica salva e não é desfeita ao mudar quantidades ou reabrir o documento. Para voltar a cobrar, marque novamente e salve. Salvar outras despesas com a mesma marcação atual conserva a opção automática; não transforma a ausência de itens em uma dispensa permanente.

A migração diferencia a marcação antiga desligada por padrão da última dispensa manual registrada em auditoria. Uma dispensa anterior explicitamente salva é respeitada. Orçamentos vencidos/encerrados e vendas fora da digitação não são reprecificados.

## Organização

A tela passa a seguir: acompanhamento/resumo e identificação → crédito/limites e crédito de devoluções → inclusão/lista dos itens → desconto por peso → frete por volume/outras despesas → condições de pagamento → custos/margem/lucro e ações finais. Impressão, confirmação, aprovação e aceite de orçamento ficam no final. Compras conservam suas ações anteriores.

**Salvar pagamento** aparece somente quando há alterações pendentes em relação aos valores salvos no documento. Isso elimina o botão redundante quando a condição do cliente já foi aplicada. O botão continua disponível para voltar à condição original, ou para salvar alterações de frete manual, desconto e comissão, mesmo sem trocar a forma de pagamento. Não altera o cadastro do cliente.

Verificação: testes de banco para detecção automática, ausência de itens, tarifa zero, dispensa persistente, migração reaplicável e proteção do histórico/carteira; teste de tela para marcação ao abrir, dispensa após reabertura, botão de pagamento e ordem dos painéis; suíte geral e compilação.
