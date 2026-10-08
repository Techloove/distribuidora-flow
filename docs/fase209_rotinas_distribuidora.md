# Fase 209 — rotinas da distribuidora

Aplicar **todo** o arquivo `db/fase209_rotinas_distribuidora.sql` no SQL Editor do projeto Supabase usado pelo ERP, depois da fase208. O script é transacional e pode ser reaplicado. Ele recarrega o cache do PostgREST ao concluir. Esta entrega não altera o layout ou as sequências do Sicredi, nem acrescenta controle de lotes/validade.

## Onde usar

| Rotina                    | Local                                       | Comportamento                                                                                                                                     |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Margem por pedido/produto | Pedidos → abrir pedido                      | Contribuição sobre a receita líquida após custo dos produtos, comissão calculada no pedido e custo do transporte. Detalhamento bruto por produto. |
| Reposição inteligente     | Planejamento de compras                     | Prioridades por consumo, prazo do fornecedor, mínimo, demanda pendente e trânsito; sinaliza estoque sem venda em 90 dias.                         |
| Entregas                  | Cargas e Expedição                          | Capacidade por carga, bloqueio de excesso de peso, ocorrência e entrega com recebedor/comprovante.                                                |
| Rotina comercial          | Agenda comercial; complementar ao Lead Rota | Clientes que nunca compraram, inativos e compras em queda; registro de visita/contato, agenda e conclusão.                                        |
| Devoluções/trocas         | Devoluções                                  | Condição revenda/avaria por item, crédito financeiro, ajuste de comissão e vínculo com pedido de troca.                                           |
| Conferência de comissões  | Comissões                                   | Base na venda ou liberação após recebimento integral; ajustes de valores já pagos para conferência.                                               |
| Cobrança                  | Agenda de cobrança                          | Saldos por cliente/centro, parcelas, contatos, responsável, promessa de pagamento e próxima ação.                                                 |
| Conciliação               | Conciliação / movimentações                 | Importação de extrato CSV, candidatos por conta/valor, vínculo/desvínculo auditado.                                                               |
| Histórico de alterações   | Auditoria                                   | Responsável, horário de São Paulo e comparação dos valores anteriores/novos.                                                                      |

As novas ações vencidas, ajustes de comissões e linhas bancárias sem conciliação também aparecem na Central de pendências. A agenda comercial herda a permissão de Lead Rota; a cobrança herda Contas a receber. Os dados continuam sujeitos a centro/carteira. Representantes com outros papéis continuam restritos à sua carteira; administrador é a exceção. Extratos completos não são disponibilizados a representantes, mesmo com outro papel, pois podem reunir várias carteiras.

## Configurações

Em **Configurações**, revisar:

- `margem_liquida_minima`: percentual de contribuição sobre a receita, entre 0 e 100. Inicialmente **0**, exigindo aprovação quando há prejuízo ou produto sem custo. Mantém também as regras anteriores de crédito, desconto e markup. A contribuição é anterior a tributos e despesas fixas; não equivale ao lucro líquido contábil.
- `comissao_fato_gerador`: inicialmente **venda**. A opção **recebimento** exige quitação integral por pagamentos e créditos efetivamente aplicados ao pedido. Recebimento parcial não libera proporcionalmente.
- **Custo do transporte no pedido**: informação gerencial da gestão, inicialmente zero, salva antes da confirmação. É distinto do frete cobrado do cliente e não gera automaticamente despesa financeira.
- **Capacidade do veículo na carga**: informar antes do fechamento. Se estiver preenchida, o servidor impede fechamento/saída acima da capacidade.

A confirmação de pedidos foi ajustada para aceitar o status aprovado, preservando geração de estoque, recebíveis, créditos e idempotência. O servidor valida bloqueios antes de confirmar pedidos sem aprovação; não depende apenas da conferência do navegador.

Custos unitários são capturados nas **novas confirmações**, depois da atualização do pedido para não interferir no recálculo automático dos itens. Até confirmar, usam custo atual. Pedidos antigos sem captura também usam custo atual; a migração não inventa custos históricos. A captura não altera quantidades nem preços.

## Operação

### Compras e comercial

A nova recomendação cobre prazo do fornecedor + 30 dias de consumo, com estoque mínimo como piso. Exibe a demanda pendente da view já existente, que inclui rascunhos: é previsão comercial, não reserva física definitiva. Não cria compra automaticamente. Conferir fornecedor e embalagem/unidade antes de lançar em Compras.

Os indicadores da agenda comercial somam vendas dos centros permitidos por cliente. O filtro de centro restringe o cadastro; clientes compartilhados permanecem visíveis. Lead Rota mantém as oportunidades por produto e geração de pedidos.

### Entregas

Em Expedição, usar **Entrega / ocorrência**. Para confirmar, o romaneio deve estar em rota e conter nome do recebedor e referência ou endereço do comprovante. Essa entrega fica registrada uma única vez, inclusive em retries. A referência pode identificar o canhoto arquivado; esta fase não faz upload de fotografias/arquivos.

O servidor exige esse registro antes de marcar uma expedição como entregue. Confirmar as entregas individuais antes de concluir a carga, que anteriormente marcava seus romaneios automaticamente. Romaneios já entregues permanecem preservados.

### Devoluções e comissões

Selecionar a condição **antes de adicionar cada item**. Revenda retorna ao estoque disponível; avaria gera crédito, mas não aumenta o saldo disponível. A reversão respeita a mesma condição. Itens confirmados/cancelados são imutáveis. Regras existentes de quantidade vendida, centro, crédito usado e repetição continuam válidas.

Na troca, confirmar a devolução, criar um novo pedido do mesmo cliente/centro e vinculá-lo. Aplicar o crédito pela rotina existente do pedido: o vínculo sozinho não consome crédito, evitando duplicidade. A diferença financeira segue o novo pedido.

Devoluções novas corrigem proporcionalmente comissões previstas/liberadas. Para comissão paga, geram um **ajuste de conferência**, que pode ser positivo (valor a recuperar) ou negativo (valor a complementar). O financeiro registra o acerto e seu documento antes de marcar a conferência; essa marcação não movimenta dinheiro nem desconta automaticamente outro pagamento. Cancelar a devolução recalcula o ajuste. Não recalcula devoluções históricas apenas por aplicar a migração.

### Cobrança e extrato

Uma única cobrança pode permanecer aberta por cliente, inclusive quando tem títulos em dois centros. O responsável ou gestão conclui a ação; depois é possível registrar a próxima ação com novo contato/promessa. As promessas não alteram vencimentos, não baixam parcelas e não enviam mensagens externas.

Usar **Baixar modelo CSV**. Colunas: `referencia;data;valor;descricao`. Datas `AAAA-MM-DD`; valores com vírgula ou ponto decimal, sem separador de milhar; entrada positiva, saída negativa. Aceita aspas de planilhas. Limites: 2 MB e 1000 linhas por importação. A referência deve ser a identificação estável do lançamento no banco, não o número da linha do arquivo.

Reimportar a mesma referência/data/valor não duplica linhas. Referência repetida com valor/data diferentes aborta a importação. Nenhuma baixa/movimentação é gerada automaticamente. Registrar/baixar o recebimento pela rotina financeira existente e vincular o movimento correspondente. O servidor confere conta, sinal, valor, situação e acesso; cada movimento só pode ser vinculado uma vez. Desfazer exige motivo. Desfazer o vínculo antes de estornar um movimento conciliado.

Candidatos consideram movimentos até sete dias antes/depois do período exibido, limitados a 1000 com aviso. Datas distintas podem ser conciliadas manualmente após revisão; não existe conciliação automática por aproximação.

## Auditoria e limites de leitura

Auditoria usa lista explícita de campos gerenciais: preços/custos, descontos, vencimentos, contas, papéis/permissões e operações novas. Parâmetros auditáveis também têm lista explícita; senhas, tokens e credenciais Sicredi não são copiados. Salvamentos da configuração CNAB também registram os campos bancários não secretos, com o responsável validado pelo servidor. Reservas automáticas de sequência não geram esses eventos. Mudanças passam a ser registradas após aplicar a fase209. Exibe os 200 eventos recentes com filtros nessa amostra e detalhes expansíveis; responsável usa nome do perfil ou identificador quando indisponível.

Agendas de clientes e extrato têm paginação de 50 registros. Histórico de ações/parcelas e ajustes têm limite de 100 com aviso; selecionar um cliente restringe a agenda. Reposição exibe os primeiros 100 produtos/centros da prioridade, com total. Central mantém limite de 40 registros por categoria e contagem completa.

## Verificações

- `npm run typecheck`, `npm run build`, `bun test`.
- Guards SQL, ordem de migrações e superfície de servidor existentes.
- `NODE_PATH=/workspace/.onboarding-tools/node_modules node scripts/check-rotinas-database.cjs`: PGlite, funções reais de validação/confirmar pedido/devolução, recálculo dos itens, reaplicação, carteiras, recebimento com crédito, cancelamento, avaria, conciliação, entrega, capacidade e auditoria.
- Testes de navegador com dados sintéticos: agendas, promessas, importação/vínculo/desvínculo, comprovante, custos/capacidade, comissões, condição de devolução, auditoria e telas móveis.

A validação local não aplica SQL no projeto Supabase nem verifica implantação do Lovable. Após executar a migração, atualizar o ERP e conferir com usuários reais de administração, financeiro e representação.
