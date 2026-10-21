# Separação — compatibilidade da expedição (fase254)

Execute inteiro `db/fase254_transicoes_expedicao_separacao.sql` e publique a atualização no Lovable. A correção não altera registros existentes, não conclui pedidos automaticamente e não repete estoque, financeiro ou emissão de boletos.

## Causa

A conclusão prática da fase233 usa a separação e conferência da fase42. Ao concluir, o pedido vai de `separacao` a `separado` e depois a `conferido`; a sincronização coloca a expedição em `separado`. A validação antiga da fase86 não reconhecia essa transição e interrompia a transação com `Transicao de expedicao invalida: separacao -> separado`.

A fase254 compatibiliza a validação com os estados intermediários existentes: expedição pendente → separação → separado → aguardando entrega → em rota → entregue. Mantém o caminho legado separação → em rota e permite cancelamento nas etapas anteriores à saída, preservando as verificações de vínculo/loja, início em pendente e entrega concluída. As demais guardas de carteira, divergência, carga e comprovante continuam ativas.

Como o erro aborta a transação, a ação pode ser tentada novamente depois de aplicar o SQL. Não use atualizações manuais de status para forçar a conclusão. Se o pedido #34 estiver fisicamente completo, reabra a tela e repita **Concluir separação**; se houver falta, registre a quantidade real antes de confirmar.

## Fluxo para o operador

1. **Pedidos:** finalizar a aprovação/confirmação da venda e enviar um ou vários pedidos para separação.
2. **Separação:** filtrar/selecionar os pedidos e imprimir a lista consolidada ou por cliente.
3. Separar e conferir fisicamente. Havendo diferenças, abrir os itens e informar as quantidades reais. Divergências existentes precisam ser resolvidas; a conclusão prática não as substitui automaticamente.
4. **Concluir separação:** confirmar somente quando tudo estiver completo. A confirmação preenche quantidades ainda vazias com as quantidades pedidas e faz a conferência integrada. O pedido passa a **Pronto para carga**.
5. Escolher, se necessário, cópias dos pedidos e emissão/reimpressão de boletos. Essas opções são independentes da montagem da carga.
6. **Cargas de entrega:** montar a carga com pedidos separados da mesma rota; conferir motorista/veículo e despachar quando sair.
7. **Entregas:** registrar data, recebedor e comprovante. Esse registro formaliza a entrega; concluir a separação não registra recebimento pelo cliente.

## Validação

O teste integrado passou a carregar a guarda real da fase86, antes ausente da fixture. Reproduz a falha, verifica rollback das quantidades/status, aplica a fase254 duas vezes e testa separação/conferência, montagem, despacho e recebimento com as rotinas reais. Também verifica regressões de vínculo/loja, retorno indevido de status e expedição entregue. O teste de conclusão em lote agora usa a mesma guarda corrigida.
