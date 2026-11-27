# Negociação de preço por item — fase381

Aplique `db/fase381_negociacao_preco_item.sql` inteiro. A instalação é transacional e reaplicável; não modifica pedidos existentes.

Em Pedidos, abra um pedido de estoque com perfil administrador e use **Negociar preço** na linha do item. A janela mostra preço anterior, novo preço e o total do item antes/depois. O motivo é opcional. **Aplicar novo preço** grava o preço daquele item, mantendo quantidade e desconto percentual; não modifica o cadastro nem o catálogo do produto. A linha mostra o último antes/depois e o diálogo permite consultar o histórico. Administradores continuam podendo consultar o histórico quando o pedido estiver encerrado.

São atendidos pedidos em digitação, aguardando aprovação, aprovados, confirmados ou em separação/conferência antes da carga. Orçamentos devem estar em negociação válida. Intermediação mantém a sua composição de custo, frete e margem.

Para pedidos aprovados/confirmados, o servidor confere novamente a ausência de qualquer boleto vinculado e de vínculo de carga. A validação administrativa existente também impede recebimentos, devolução confirmada, movimentações e renegociação financeira ou documento fiscal. Créditos aplicados, juros/multa/desconto/acréscimo manual nas parcelas e comissão paga ou agendada exigem acerto específico e bloqueiam a ação. Essas barreiras também valem para chamadas diretas à API.

As parcelas abertas devem somar exatamente o total anterior. O novo total é distribuído proporcionalmente aos valores anteriores, com duas casas decimais e diferença de centavos na última parcela. IDs, números, documentos e vencimentos permanecem iguais. Uma parcela que ficaria sem valor positivo bloqueia a transação. Pedido confirmado sem parcelas abertas exige revisão financeira; aprovado que ainda não gerou títulos segue o fluxo normal de confirmação.

O total e a comissão são calculados pelo motor comercial vigente do sistema. Comissões previstas/liberadas sem compromisso de pagamento recebem a nova base e valor; parcelas de comissão agendadas não são reescritas. O status do pedido não é alterado, não se cria novo ciclo financeiro, não há cancelamento/reconfirmação e não há nova baixa de estoque.

São registrados antes/depois dos preços, motivo, usuário e data. Para confirmados, a auditoria também registra totais, parcelas e comissão antes/depois. Uma falha reverte preço, total, financeiro, comissão e histórico na mesma transação. A conferência usa bloqueios e compara preço, quantidade e desconto esperados, recusando uma prévia desatualizada. As edições comuns de quantidade agora enviam apenas o campo alterado; o servidor preserva o preço negociado e demais campos.

Testes locais: `check-negociacao-preco-381.cjs` e `check-negociacao-confirmado-381.cjs` usam PostgreSQL PGlite descartável e a RPC legada de edição/validador administrativo reais. `check-negociacao-preco-381-ui.cjs` usa navegador com respostas fictícias para administrador e representante em computador, tablet e celular. Não alteram produção.
