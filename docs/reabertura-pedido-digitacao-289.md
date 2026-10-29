# Reabertura administrativa do pedido — fase289

O administrador ativo pode usar Voltar para digitação nos pedidos aprovados/em operação antes da saída e nos cancelados, com motivo de 10 a 2000 caracteres e confirmação. A validação ocorre na prévia e novamente na transação efetiva, sob bloqueio das linhas. Gestor/representante/financeiro não recebem a ação e não executam as RPCs de reabertura.

Boletos do pedido ou de seus títulos precisam estar em baixado/cancelado. Não se presume baixa por solicitação pendente, nem por ausência de resposta bancária. Boleto liquidado e título com valor pago bloqueiam. Movimentações não estornadas, renegociação, devolução confirmada, documento fiscal/snapshot, saída de entrega e comissão paga/agendada exigem acerto separado.

A operação conserva os títulos como cancelados, inclusive sem boleto, e usa o motor administrativo de cancelamento para retirar a carga, liberar reservas, compensar saídas efetivamente registradas e cancelar a expedição anterior. Exige saldo líquido de movimentos por produto/loja igual a zero antes de reabrir. Registra o estado anterior do pedido, conferência e itens em `pedido_reaberturas_289`, com RLS de leitura exclusiva do administrador com acesso à loja. Escritas são privadas das RPCs.

O status interno rascunho é mostrado como Digitação. A forma anterior é preservada até o administrador escolher e salvar outra. O retorno não gera parcelas. A confirmação normal gera as novas parcelas conforme quantidade/prazos/encargos da condição. As conferências são limpas e a nova confirmação reinicia a separação; novos boletos obedecem à liberação normal após conferência.

`pedidos.ciclo_reabertura_289` avança por operação. Os títulos e os marcadores de cancelamento recebem o ciclo em trigger privado; os ciclos existentes começam em zero. A unicidade por pedido/ciclo/parcela conserva títulos antigos sem permitir duplicação no ciclo atual. A unicidade por pedido/ciclo/tipo permite novo cancelamento sem apagar os anteriores. RPC idempotente por UUID e status esperado; repetição não gera segundo ciclo. Alterar diretamente o marcador ou reabrir pedido encerrado por alteração comum continua bloqueado. A troca de forma de pagamento após a reabertura exige administrador também no banco.

A instalação não reabre nenhum pedido, cancela boleto, gera título ou movimenta estoque. O backup externo inclui automaticamente os novos campos/tabela do schema. Não foram feitos comandos bancários reais nos testes.

Validação em PGlite: migração repetível, administrador/inativo/outro papel/loja, boleto registrado/liquidado, recebimento, saída e fiscal, cancelado/Conferido, retorno repetido, tentativa direta de status, troca de condição 1x para 3x com prazos e arredondamento, confirmação repetida, novos boletos simulados e dois ciclos financeiros/logísticos. Frontend testado com sessão/RPCs fictícias.


## Correção de sincronização — fase290 / versão1.18.1

A expedição possui um gatilho real que sincroniza seu cancelamento com o pedido. O motor de cancelamento definia o contexto autorizado depois de atualizar a expedição; esse gatilho chegava ao bloqueio do pedido antes do contexto e gerava “Use o cancelamento administrativo com motivo”. A fase290 move o marcador para imediatamente antes da atualização da expedição, depois das validações e bloqueios existentes, nos motores administrativo e do representante. Não altera o gatilho de proteção nem concede novas permissões.

A regressão local passou a carregar os dois gatilhos reais de sincronização da fase42. Reproduz a falha sem a correção, comprova o rollback de pedido/título/estoque/histórico, aplica a fase290 duas vezes e conclui o retorno e a nova geração de parcelas/boletos simulados. Também verifica o cancelamento do representante aprovado e que alterações diretas de status continuam bloqueadas.
