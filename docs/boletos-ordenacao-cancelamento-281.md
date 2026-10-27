# Boletos: ordenação e cancelamento — versão 1.6.0

Execute inteiro `db/fase281_cancelamento_boleto_sicredi.sql` no Supabase e publique a versão 1.6.0 no Lovable. O SQL registra o pedido aceito sem alterar o status e impede que uma consulta atrasada reabra um boleto com baixa confirmada. A instalação não cancela boletos nem altera títulos.

Em **Ordenar por**, escolha emissão ou vencimento, com as datas mais antigas ou mais recentes primeiro. A ordenação é aplicada aos resultados filtrados; datas ausentes ficam no final. Limpar os filtros volta ao padrão de vencimento mais recente.

O botão **Cancelar boleto** aparece diretamente na linha dos boletos API Sicredi registrados, para os perfis financeiros já autorizados. O envio exige nosso número e confirmação com cliente, número e valor. Não permite cancelar boleto liquidado, baixado ou com pedido de cancelamento em andamento.

O manual da API 3.9.1, seção 7.4, páginas 56–60, documenta `PATCH /cobranca/boleto/v1/boletos/{nossoNumero}/baixa` como **pedido de baixa**, com retorno HTTP202 e `MOVIMENTO_ENVIADO`. A resposta de envio não confirma a baixa final.

A rotina mantém o boleto registrado e grava o indicador de cancelamento solicitado no retorno existente. A consulta individual preserva esse indicador enquanto o banco ainda informar registrado. Somente uma consulta que confirme a baixa muda a situação para baixado. A automação existente da fase247 continua consultando esses boletos. Se o banco ainda não confirmar a baixa, confira a situação com o Sicredi antes de qualquer nova cobrança.

O cancelamento não quita a conta a receber e não cancela o pedido de venda. Permanecem as verificações existentes de usuário ativo, perfil financeiro, acesso ao boleto e correspondência de ambiente/convênio. Nenhuma chamada real de cancelamento foi executada nos testes.

A validação cobre os quatro sentidos de ordenação, combinação com filtros, datas ausentes e coleção original preservada. O teste da API simula pedido aceito, recusa bancária, consulta ainda registrada e confirmação posterior de baixa. Também verifica bloqueio de estados inelegíveis e ausência de lançamentos financeiros no cancelamento.
