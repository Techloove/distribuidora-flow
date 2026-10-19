# Orçamentos dentro de Pedidos — fase236

Execute integralmente `db/fase236_orcamentos.sql` no SQL Editor do Supabase, após a fase235. Atualize o sistema com Ctrl+F5. A migração não transforma os pedidos existentes em orçamentos nem altera seus valores/status. O acompanhamento anterior continua funcionando enquanto a nova RPC ainda não estiver disponível no cache do banco.

**Correção posterior necessária:** a fase240 faz o documento nascer como orçamento antes dos gatilhos de comissão. Para instalações que já a aplicaram, não repita a fase236 isoladamente. Consulte `docs/correcao-orcamentos240.md`. A revisão visual do acompanhamento não muda a natureza nem os comandos de conversão.

## Uso diário

1. Em **Pedidos**, clique **Novo orçamento**, escolha cliente, centro, rota e condição de pagamento, informe a validade e crie a proposta.
2. Inclua produtos, quantidades, preços/descontos autorizados e observações. O status exibido é **Orçamento em negociação**. A comissão do cabeçalho é apenas estimada; não há comissão a pagar.
3. Use **Imprimir orçamento** para visualizar/imprimir/salvar PDF. O mesmo modelo de impressão dos pedidos identifica cada proposta como **ORÇAMENTO**, com data, validade, condições, observações e aviso de que não confirma a venda nem reserva mercadoria.
4. Se o cliente não fechar, use **Cliente não aprovou**, informando o motivo. A proposta fica encerrada e seus itens não podem mais ser alterados. A data vencida também faz a interface mostrar **Orçamento expirado**, sem tarefa agendada e sem avançar o fluxo da venda.
5. Para retomar uma proposta encerrada/vencida, clique **Revisar validade e proposta**. Informe validade atual/futura, revise as observações e reabra a negociação. A auditoria preserva a situação, validade e motivo anteriores.
6. Com o aceite do cliente e os valores salvos, clique **Cliente aceitou — converter em pedido** e confirme. O mesmo documento, número e itens são reaproveitados, sem gerar um segundo pedido. Com a fase241 aplicada, passa a **Aprovado** se as regras comerciais permitirem e houver estoque para reserva; com restrições, fica **Aguardando aprovação**, exibindo os motivos. Repetir o aceite retorna a decisão anterior sem duplicar a conversão.
7. Quando há restrição, a gestão decide a aprovação pelas regras existentes. A aprovação automática também respeita as validações de crédito, desconto, margem e disponibilidade. A confirmação da venda continua responsável pela baixa de estoque e pelas parcelas; a aprovação reserva os itens.

A data comercial do pedido passa a ser o dia do aceite/conversão, no fuso de São Paulo. A data original da proposta permanece em `orcamento_data`; isso evita gerar parcelas usando a data de uma proposta antiga. A previsão de parcelas enquanto é orçamento é uma simulação para aceite hoje, não títulos emitidos. A validade é inclusiva: uma proposta válida até20/10 ainda pode ser aceita em20/10, e expira em21/10.

A listagem inclui **Tipo de documento → Pedidos/Orçamentos** e situações próprias de negociação, expiração e não aprovação pelo cliente. Orçamentos usam a numeração compartilhada dos documentos comerciais; a conversão mantém o número. Um pedido normal em rascunho continua sendo um pedido normal. Esta implantação não converte pedidos antigos em propostas automaticamente.

## Integridade e acesso

Enquanto `tipo_documento='orcamento'`, o status operacional permanece `rascunho`. A situação comercial é separada em `orcamento_situacao`, com validade e decisão próprias. Isso conserva os motores de edição e evita que relatórios/automações existentes tratem a proposta como venda. O indicador logístico não simula aprovações, carga ou entrega para uma proposta.

Os comandos legados de confirmar, avançar e cancelar pedidos recebem uma guarda anterior a seus efeitos; orçamentos devem usar suas ações próprias. Triggers também impedem criar reservas, movimentos de venda, títulos, comissões, aplicações de crédito, expedições e vínculos de carga enquanto o documento for orçamento. A apuração de comissão não cria lançamentos para propostas. Os campos de comissão do cabeçalho continuam disponíveis para estimativa.

Criação, revisão, decisões e edição de propostas exigem usuário ativo, capacidade comercial existente, centro permitido, carteira atual e representação do pedido. Representantes com outros papéis seguem restritos; admin mantém a exceção existente. Os clientes são protegidos contra troca concorrente de carteira durante as alterações. As tabelas continuam sem escrita direta pelo navegador.

A ação **Criar, revisar e registrar decisão de orçamentos** (`pedidos_orcamentos`) fica em **Usuários e papéis → Pedidos**. Na primeira aplicação é atribuída aos perfis que já possuíam o menu Pedidos; reaplicar não restaura revogações. A consulta de acompanhamento permanece sob `pedidos_acompanhar`, independente da autorização de criar/decidir propostas.

## Verificação local

- `NODE_PATH=/caminho/das/dependencias node scripts/check-orcamentos-database.cjs`, com PGlite: motores reais de criação/edição81, parcelas12, aprovação42, reserva212, apuração real209 e confirmação80/209/227. Testa ausência de efeitos antes do aceite, inclusive tentativas de inserir lançamentos vinculados; recusa/revisão/expiração; conversão atômica/idempotente no mesmo documento; data comercial e prazos; bloqueio por estoque insuficiente na aprovação; preservação dos itens e valores no aceite; comissão apenas prevista após conversão e sem duplicação; vencimentos20/40 contados da data de conversão e reconfirmação sem duplicar títulos; carteira, papéis mistos e revogação/anon. O recálculo e a escrita de movimento de estoque são fixtures controladas; notificações são sem efeito.
- Testes de situações comerciais, validade inclusiva e impressão com o modelo compartilhado.
- Chromium com representante e dados de teste: criar proposta, incluir item, imprimir, recusar, revisar/reabrir e converter para aprovação, inclusive em tela de celular. Não chama confirmação de venda durante a conversão.

A revisão do fluxo após a fase240 passou também no navegador com backend simulado: criação da proposta, inclusão de item, recusa, revisão/reabertura, aceite, aprovação e confirmação; preservação do mesmo documento e da data original da proposta, e liberação do envio à separação. Os testes independentes de estoque compartilhado226 e prazos227 passaram.

Nenhuma migração ou operação foi executada no banco de produção durante estes testes. Não é necessária nova migração para esta revisão.

A fase241 acrescenta a decisão automática no aceite. Consulte `docs/aprovacao-orcamentos241.md` para implantação, restrições e revisão administrativa. As verificações anteriores desta página descrevem a etapa histórica após a fase240.
