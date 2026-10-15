# Fluxo prático: Pedidos → Separação → Cargas → Entregas

Execute integralmente `db/fase233_fluxo_logistico_pratico.sql` no SQL Editor do Supabase, após a fase232. Atualize o sistema com Ctrl+F5. A implantação não muda o status de pedidos/cargas existentes; as alterações operacionais acontecem quando o usuário executa cada ação.

## Rotina diária

1. **Pedidos:** confirme normalmente os pedidos, com as validações comerciais/financeiras e o estoque já existentes. Aplique os filtros desejados e clique **Enviar pedidos para separação**. Marque um ou mais pedidos na janela de seleção e clique **Enviar selecionados para separação**. A janela apresenta somente os confirmados da lista filtrada e permite até100 pedidos por operação. Também funciona para um pedido aberto individualmente.
2. **Separação:** confira fisicamente produtos e quantidades. Clique **Concluir separação** e confirme que todos os itens foram separados e conferidos. Quantidades ainda não preenchidas são completadas conforme o pedido; divergências já registradas impedem a conclusão. Separação e conferência são concluídas numa única operação; o status interno final é `conferido`, exibido como liberado para montar carga. Pedidos antigos no estágio `separado` também podem finalizar pela mesma ação.
3. **Cargas de entrega:** gere uma carga, informando a rota e os dados de transporte, abra a carga e clique **Selecionar pedidos para a carga**. Selecione os pedidos com separação concluída e inclua-os de uma vez. A inclusão individual continua disponível. Somente pedidos da rota, dos centros/carteiras permitidos e fora de outras cargas ativas podem entrar. A inclusão registra o marco de faturamento **comercial** internamente, sem emitir nota, recriar contas a receber ou dar nova baixa de estoque.
4. **Entregas, antes da saída:** os pedidos incluídos já aparecem como **Aguardando saída**, com o número da carga. A entrega ainda não pode ser confirmada.
5. **Saída da carga:** em Cargas, clique **Despachar carga**, confira os dados e confirme a data de saída. O sistema fecha a carga e coloca todos os pedidos/romaneios dela em rota numa única transação. Não precisa despachar cada romaneio na Expedição. Capacidade, separação e liberação dos pedidos são verificadas; se houver problema, o despacho inteiro é desfeito.
6. **Entregas, após a saída:** o entregador confirma cada recebimento com data, recebedor e referência do comprovante, como na fase232. O pedido e o romaneio são atualizados. Quando a última entrega for formalizada, a carga é concluída automaticamente. Casos de devolução total já resolvidos na rotina existente também contam como encerrados logisticamente.

A Expedição continua disponível para consulta, ocorrências, recusas e entregas parciais. Ela não é uma etapa manual obrigatória neste fluxo completo. O menu Faturamento continua disponível para suas rotinas próprias, porém não é necessário faturar manualmente antes de incluir os pedidos conferidos na carga. A configuração existente de exigir nota fiscal para carga é respeitada; não é ativada nem desativada pela migração, e nenhuma emissão fiscal é feita.

## Controles preservados

- Só pedidos confirmados podem entrar no novo fluxo. A saída de estoque da confirmação é usada como evidência operacional; apenas mudar um status sem confirmar a venda não libera o pedido. Pedidos sem essa evidência precisam ter sua origem verificada, sem criar movimentos/títulos de forma automática.
- Lotes de envio/inclusão aceitam1–100 UUIDs distintos e são atômicos: se um pedido falhar, nenhum do lote é parcialmente processado. Repetir o envio de pedidos já em separação ou a inclusão na mesma carga aberta não duplica os vínculos.
- A conclusão integrada usa os motores de separação/conferência existentes, depois de exigir itens e quantidades corretas. Não aceita a alteração/exclusão automática de itens divergentes de uma venda já confirmada. Ajustes comerciais e eventuais retornos devem seguir as rotinas próprias.
- As rotinas legadas de criar/retirar carga, iniciar/concluir/conferir separação também recebem os controles de ação, centro e carteira. Não se remove proteção de estoque ou de títulos.
- Carga não pode sair vazia, com pedido de outra rota, sem conferência, com romaneio ausente ou com peso acima da capacidade. A exigência fiscal configurada é conferida novamente no fechamento/despacho.
- Finalizar uma carga não marca pedidos como entregues automaticamente. A operação de conclusão valida as formalizações individuais; o caminho normal conclui a carga após a última confirmação real. Datas de entrega anteriores não são sobrescritas pela data de encerramento da carga.
- Cancelar uma carga antes da saída libera os pedidos para nova montagem, preservando o histórico da carga cancelada. Retirar pedidos de uma carga já despachada, cancelada ou concluída é bloqueado. Retirar um vínculo inexistente não altera o pedido de outra carga.
- Representantes, inclusive combinados com outro papel, continuam limitados à carteira atual e à representação do pedido. Admin tem a exceção já existente. As operações verificam centros e carteiras no banco; os clientes são protegidos durante as ações contra uma troca concorrente de carteira. Locks de carga/pedido e os controles de vínculo evitam inclusão simultânea em cargas distintas.
- As listas de candidatos à carga usam páginas ordenadas para não truncar em1000 registros. Cargas, seus pedidos, candidatos e Entregas atualizam periodicamente, além da invalidação após cada operação.

## Usuários e papéis

As três ações novas aparecem em seus módulos atuais:

- `pedidos_enviar_separacao` — Pedidos.
- `separacao_concluir` — Separação (início, conclusão e conferência integrada).
- `cargas_operar` — Cargas de entrega (criar, incluir/retirar, fechar e despachar).

Na primeira aplicação, os papéis que já tinham cada menu recebem a ação correspondente. As capacidades operacionais existentes continuam necessárias: operação comercial para o envio; estoque/expedição para separação; logística para cargas. Reaplicar não restaura ações revogadas. A confirmação de recebimento permanece sob `entregas_operar`, da fase232. Não é necessário liberar o menu Expedição para o entregador usar apenas a tela Entregas.

## Validação local

`NODE_PATH=/workspace/.onboarding-tools/node_modules node scripts/check-logistica-pratica-database.cjs` executa as fases232/233 em PostgreSQL/PGlite, usando os motores reais de status, separação, conferência, carga, capacidade e entrega das fases42/59/209/214/215, e os auxiliares206/211. O recálculo comercial e a notificação são substituídos por operações sem efeito na fixture; o teste não reexecuta a confirmação financeira nem o motor de estoque. Confere lote atômico/idempotente, falta de confirmação, divergências, notas exigidas, rota/carteira/centro, múltiplas cargas, capacidade e rollback, despacho, pendência antes da saída, recebimentos reais232 e conclusão automática. As quantidades de movimentos de estoque, títulos e notas permanecem inalteradas durante o percurso.

A interface foi verificada em Chromium com dados de teste, percorrendo dois pedidos por todas as telas sem abrir Expedição/Faturamento: seleção/envio em lote, conclusão integrada, montagem em lote, espera antes da saída, despacho único, duas confirmações no celular e carga concluída. Nenhuma operação foi executada no Supabase de produção.
