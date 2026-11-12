# Apresentação compartilhada de boletos

A versão1.52.0 aplica a apresentação comum a Sicredi e Sicoob, usando as informações bancárias persistidas e as permissões/RLS existentes. Não altera contratos, certificados, endpoints ou lançamentos financeiros.

`src/lib/boleto-apresentacao.ts` é o contrato de leitura: os adaptadores interpretam condições e operações de cada banco; a página e `HistoricoBoleto` aplicam as mesmas regras de apresentação. Novos indicadores devem ser implementados nessa camada e testados para os dois bancos, conforme AGENTS.md.

| Regra | Comportamento compartilhado |
|---|---|
| Vencimento alterado | Destaque azul só após confirmação; mostra data anterior/nova em Opções. |
| Abatimento | Destaque com valor atual confirmado, motivo e horário quando disponíveis. Preserva nominal e contabiliza recebimento pela rotina bancária existente. |
| Cancelar abatimento | Remove o destaque quando o retorno confirma zero; preserva a solicitação no histórico. |
| Desconto | Mostra condições e prazo informados, distinguindo valor, percentual e outras modalidades. Não presume valor pagável fora das condições. |
| Solicitação pendente | Aviso próprio, sem tratar pedido enviado/incerto como confirmação. |
| Baixa/cancelamento | Conserva estado bancário, destaque e regras de filtros/cartões; Sicoob também mostra cancelamento solicitado enquanto pendente. |
| Histórico | Lista eventos disponíveis com situação, motivo, horários e mudanças; até30 operações/condições recentes por título, além do histórico de vencimento já consultado. Respeita acesso por loja. |
| Emissão e impressão | Após confirmação, mantém a janela montada durante mudanças de status/carregamento e carrega a prévia dos PDFs das parcelas recém-confirmadas, sem outra seleção. Não chama emitir/alterar para imprimir. |
| Confirmação tardia | Na janela que enviou a emissão, acompanha a confirmação e abre a prévia quando todo o lote estiver imprimível. Fechar a janela preserva a coleta do servidor. |
| Reimpressão manual | Mantém seleção por parcela/pedido/cliente, ciclos vigentes e escopo existente. Não abre nem consulta PDFs sem escolha. |

O PDF é a via original fornecida pelo banco. A prévia abre dentro da janela existente, sem depender de popup; o comando de impressão permanece sob controle do usuário. Falha ao obter PDF permite tentar a impressão outra vez, sem reenviar a cobrança.

Um banco novo precisa de adaptador e capacidades/transportes próprios. Não herda condições de outro banco por suposição. As regras comuns de histórico, destaques, impressão, valor nominal, situação confirmada e permissão devem continuar compartilhadas nas próximas entregas.

## Verificação

Testes de paridade Sicredi/Sicoob para vencimento, abatimento e cancelamento de abatimento, pendência, histórico e desconhecimento de outro banco. Seleção automática exclui ciclos superados, títulos pendentes e parcelas não confirmadas. Chromium com o componente real de impressão e APIs simuladas confere prévia automática, ausência de consulta duplicada e preservação da reimpressão manual. O fluxo completo usa o componente real de emissão com status passando a Registrado e carregamento ativo, para verificar que a janela e a abertura do PDF persistem. Não é executada emissão real durante esses testes.

A entrega usa campos e relacionamentos já instalados; não requer SQL novo.
