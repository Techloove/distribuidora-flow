# Revisão da coleção oficial Postman Sicoob v3

Fonte: API-Cobranca-Bancaria-Sicoob-V3-3.postman_collection enviada pelo usuário em 11/11/2026. SHA-256: 43c512d104c1e7110c3a7fec27e6da38769f95e0a69271d0f7fa2263da9c9f11.

A coleção foi analisada como documentação; scripts, credenciais e requisições anexos não foram executados. Nenhum boleto foi emitido, alterado ou baixado. O arquivo integral não foi copiado para o repositório para evitar conservar credenciais eventualmente presentes nas variáveis e requisições.

## Evidências encontradas

- A solicitação de movimentação possui exemplo HTTP 201, enquanto a página anteriormente enviada listava 200. O futuro coletor deverá validar o código da solicitação retornado nas respostas de sucesso documentadas, sem exigir exclusivamente HTTP 200.
- A consulta da solicitação retorna uma lista idArquivos. Todos os arquivos precisam ser concluídos antes de considerar a solicitação inteiramente importada.
- O download do exemplo retorna arquivo Base64 e nomeArquivo. O ZIP original falha ao abrir. Os bytes foram aparentemente convertidos de Latin-1 para UTF-8 antes da codificação Base64. A conversão inversa, apenas para análise offline, recuperou um ZIP cuja verificação CRC passou. Isso não justifica normalizar ou aceitar automaticamente respostas reais malformadas.
- Dentro do ZIP há um JSON com 10 registros, todos da movimentação ENTR. Não há exemplo interno LIQUI ou BAIX.
- O JSON ENTR contém valorTarifaMovimento. Identificadores: numCliente, numContrato, idModalidadeProduto, numTitulo e descSeuNumero. Datas/valores: dataMovEntrada, dataVencimentoTitulo, dataEmissaoDocumento, dataLimitePagamento, valorTitulo. Há também numContaCorrente e codigoBarras.
- GET /boletos documenta listaHistorico com dataHistorico, tipoHistorico e descricaoHistorico. Tipo 4 é tarifas; tipo 6 é liquidação OU baixa. O tipo 6, isoladamente, não comprova pagamento.
- O próprio exemplo usa tipoHistorico 1 em uma descrição de tarifa, contrariando o quadro de tipos. Logo não é adequado automatizar lançamentos apenas pelo código do histórico ou por extração livre de valores da descrição.
- As rotas de emissão, consulta, segunda via, alteração e baixa da implementação correspondem às da coleção. A emissão já não informa nossoNumero; o seuNumero é persistido antes da requisição.

## Dependências para conciliação financeira automática

Ainda são necessários os layouts ou arquivos de exemplo LIQUI e BAIX: identificador do evento, identificação do convênio/boleto, data efetiva do crédito, valor pago bruto, descontos/abatimentos, juros/multa, tarifas e respectivas datas, valor líquido, motivos e estornos. O campo valorTarifaMovimento observado em ENTR comprova que esse retorno pode transportar tarifa de entrada, mas não comprova os campos de todas as outras tarifas ou de pagamentos.

Solicitação objetiva ao suporte: “Precisamos do layout JSON interno dos arquivos LIQUI e BAIX da API Cobrança Bancária v3, com os campos de valor recebido, data de liquidação/crédito, tarifas por movimentação e estornos; a coleção Postman disponibilizada contém apenas um arquivo ENTR.”

A automação de recebimentos e tarifas Sicoob não foi ativada por esta revisão. A versão 1.44.0 continua com operações manuais de consulta/alteração e configuração das condições de novas emissões.
