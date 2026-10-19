# Acompanhamento dos pedidos — fase235

Execute integralmente `db/fase235_acompanhamento_pedidos.sql` no SQL Editor do Supabase após a fase234. Depois atualize o sistema com Ctrl+F5. Não altera status, estoque, financeiro, comprovantes nem dados operacionais já existentes.

Em **Pedidos**, abra um pedido para consultar **Acompanhamento do pedido**. O indicador apresenta a posição atual no fluxo:

1. Digitação.
2. Aguardando aprovação.
3. Aprovado — reúne as situações internas `aprovado` e `confirmado` na mesma etapa comercial.
4. Separação — distingue **Em separação** de **Separado, aguardando conferência**.
5. Pronto para carga — conferência concluída ou marco de faturamento já registrado.
6. Carga montada — aguardando saída.
7. Em rota de entrega.
8. Entregue.

A revisão visual das três primeiras etapas exige somente publicar a atualização da interface; quem já implantou o acompanhamento não precisa executar SQL. Filtros e contagens de Pedidos também agrupam `aprovado` e `confirmado` em uma única opção **Aprovado**, e `rascunho`/`digitacao` em **Digitação**. As ações de processamento continuam usando os status internos originais.

O indicador mostra a posição atual, não um histórico datado de aprovações/separações. Não altera a sequência operacional nem obriga etapas adicionais. A lista, filtros e cabeçalho passam a usar os mesmos nomes legíveis; os códigos internos permanecem intactos. Cancelamento, não aprovação e devolução aparecem como encerramentos próprios, sem uma falsa conclusão de entrega. Entrega parcial ou tentativa não realizada permanecem na etapa de entrega, com a pendência indicada.

O resumo mostra data do pedido, carga quando disponível, saída, previsão e, depois do recebimento integral, **data da entrega** e **Recebido por**. Para registros parciais, identifica o recebedor e o horário da última visita, sem apresentá-los como recebimento completo. Se registros antigos não tiverem data/recebedor, informa a ausência; não inventa esses dados. Uma ocorrência sem quantidades entregues/recusadas não é tratada como visita parcial.

O acompanhamento e os pedidos atualizam a cada30 segundos enquanto a tela estiver ativa; também há **Atualizar andamento**. A lista usa leitura paginada ordenada para não perder pedidos além do limite de resposta do banco. Os filtros de período existentes continuam: para pedidos antigos, selecione **Todo o período** ou ajuste as datas.

## Acesso

A ação **Consultar andamento, data de entrega e recebedor** (`pedidos_acompanhar`) fica no módulo Pedidos em Usuários e papéis. Na primeira aplicação, é atribuída aos papéis que já possuem `/pedidos`. Reaplicar não restaura ações revogadas. Usuário ativo, ação e menu são exigidos. Não depende de perfil de expedição nem de liberação do menu Entregas.

A RPC somente de leitura confere centro permitido, carteira atual do cliente e representante do pedido. Representante com outro papel, inclusive gestor, permanece restrito; admin mantém a exceção existente. Não devolve arquivos, endereços de comprovantes, observações internas ou outros pedidos da carga. As permissões de operar logística e as políticas de acesso direto aos comprovantes permanecem intactas. O cache de acompanhamento/documentos identifica login e papéis; erro de acesso oculta dados anteriores do resumo.

## Verificação

- `NODE_PATH=/caminho/das/dependencias node scripts/check-acompanhamento-pedidos.cjs`, com PGlite instalado: funções reais206/211, consulta por representante sem acesso logístico, centro/carteira/representação, papéis mistos, admin, usuário inativo/sem vínculo, revogação de ação/menu, reaplicação, dados parciais e romaneio cancelado. Confere resposta sem campos privados e ausência de escrita.
- Testes da nomenclatura e ordem das etapas, parcial/tentativa sem falsa conclusão e encerramentos excepcionais.
- Chromium com login de representante e dados de teste: fluxo de status, recebedor/data, dados antigos ausentes, visita parcial, atualização automática sem cliques, revogação e layout móvel.

Não houve consulta nem alteração no banco de produção nesta validação.
