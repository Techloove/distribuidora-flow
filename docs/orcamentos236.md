# Orçamentos dentro de Pedidos — fase236

Execute integralmente `db/fase236_orcamentos.sql` no SQL Editor do Supabase, após a fase235. Atualize o sistema com Ctrl+F5. A migração não transforma os pedidos existentes em orçamentos nem altera seus valores/status. O acompanhamento anterior continua funcionando enquanto a nova RPC ainda não estiver disponível no cache do banco.

## Uso diário

1. Em **Pedidos**, clique **Novo orçamento**, escolha cliente, centro, rota e condição de pagamento, informe a validade e crie a proposta.
2. Inclua produtos, quantidades, preços/descontos autorizados e observações. O status exibido é **Orçamento em negociação**. A comissão do cabeçalho é apenas estimada; não há comissão a pagar.
3. Use **Imprimir orçamento** para visualizar/imprimir/salvar PDF. O mesmo modelo de impressão dos pedidos identifica cada proposta como **ORÇAMENTO**, com data, validade, condições, observações e aviso de que não confirma a venda nem reserva mercadoria.
4. Se o cliente não fechar, use **Cliente não aprovou**, informando o motivo. A proposta fica encerrada e seus itens não podem mais ser alterados. A data vencida também faz a interface mostrar **Orçamento expirado**, sem tarefa agendada e sem avançar o fluxo da venda.
5. Para retomar uma proposta encerrada/vencida, clique **Revisar validade e proposta**. Informe validade atual/futura, revise as observações e reabra a negociação. A auditoria preserva a situação, validade e motivo anteriores.
6. Com o aceite do cliente e os valores salvos, clique **Cliente aceitou — converter em pedido** e confirme. O mesmo documento, número e itens são reaproveitados, sem gerar um segundo pedido. Ele passa a **Aguardando aprovação**, para o fluxo interno normal. Repetir o aceite não duplica a conversão.
7. A gestão aprova conforme as regras existentes; a confirmação da venda continua responsável pelos efeitos de estoque/financeiro. O aceite do cliente não aprova crédito, desconto ou disponibilidade de estoque.

A data comercial do pedido passa a ser o dia do aceite/conversão, no fuso de São Paulo. A data original da proposta permanece em `orcamento_data`; isso evita gerar parcelas usando a data de uma proposta antiga. A previsão de parcelas enquanto é orçamento é uma simulação para aceite hoje, não títulos emitidos. A validade é inclusiva: uma proposta válida até20/10 ainda pode ser aceita em20/10, e expira em21/10.

A listagem inclui **Tipo de documento → Pedidos/Orçamentos** e situações próprias de negociação, expiração e não aprovação pelo cliente. Orçamentos usam a numeração compartilhada dos documentos comerciais; a conversão mantém o número. Um pedido normal em rascunho continua sendo um pedido normal. Esta implantação não converte pedidos antigos em propostas automaticamente.

## Integridade e acesso

Enquanto `tipo_documento='orcamento'`, o status operacional permanece `rascunho`. A situação comercial é separada em `orcamento_situacao`, com validade e decisão próprias. Isso conserva os motores de edição e evita que relatórios/automações existentes tratem a proposta como venda. O indicador logístico não simula aprovações, carga ou entrega para uma proposta.

Os comandos legados de confirmar, avançar e cancelar pedidos recebem uma guarda anterior a seus efeitos; orçamentos devem usar suas ações próprias. Triggers também impedem criar reservas, movimentos de venda, títulos, comissões, aplicações de crédito, expedições e vínculos de carga enquanto o documento for orçamento. A apuração de comissão não cria lançamentos para propostas. Os campos de comissão do cabeçalho continuam disponíveis para estimativa.

Criação, revisão, decisões e edição de propostas exigem usuário ativo, capacidade comercial existente, centro permitido, carteira atual e representação do pedido. Representantes com outros papéis seguem restritos; admin mantém a exceção existente. Os clientes são protegidos contra troca concorrente de carteira durante as alterações. As tabelas continuam sem escrita direta pelo navegador.

A ação **Criar, revisar e registrar decisão de orçamentos** (`pedidos_orcamentos`) fica em **Usuários e papéis → Pedidos**. Na primeira aplicação é atribuída aos perfis que já possuíam o menu Pedidos; reaplicar não restaura revogações. A consulta de acompanhamento permanece sob `pedidos_acompanhar`, independente da autorização de criar/decidir propostas.

## Verificação local

- `NODE_PATH=/caminho/das/dependencias node scripts/check-orcamentos-database.cjs`, com PGlite: motores reais de criação/edição81, parcelas12, aprovação42, reserva212 e confirmação80/209/227. Testa ausência de efeitos antes do aceite, inclusive tentativas de inserir lançamentos vinculados; recusa/revisão/expiração; conversão atômica/idempotente no mesmo documento; data comercial e prazos; bloqueio por estoque insuficiente na aprovação; carteira, papéis mistos e revogação/anon. O recálculo e a escrita de movimento de estoque são fixtures controladas; notificações são sem efeito.
- Testes de situações comerciais, validade inclusiva e impressão com o modelo compartilhado.
- Chromium com representante e dados de teste: criar proposta, incluir item, imprimir, recusar, revisar/reabrir e converter para aprovação, inclusive em tela de celular. Não chama confirmação de venda durante a conversão.

Nenhuma migração ou operação foi executada no banco de produção durante estes testes.
