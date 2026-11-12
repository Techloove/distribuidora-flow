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

## Pesquisa pública liberada em 12/11/2026

O usuário autorizou pesquisa externa e a permissão de rede foi concedida para esta etapa. GitHub público funcionou; os domínios do portal Sicoob e documenter.getpostman.com permaneceram bloqueados pelo proxy (Tunnel connection failed: 403 Forbidden). Esse bloqueio de navegação não é o HTTP 403 da API bancária do usuário.

Novas fontes comunitárias, lidas como referência e sem executar seus códigos:

- https://github.com/SharpSistemas/SicoobAPI/blob/ea3858cb6daf6676c2bfdcc80e2f4432bd76c1b8/Sicoob.Cobranca/Models/Shared/Movimentacoes.cs
- https://github.com/laddertech/sicoob-sdk/blob/6872d02e4821f1b0e3e92cde606508e951475ed8/tests/test_boleto_movimentacoes.py
- https://github.com/open-fidias/sicoob-cobranca-bancaria-api/blob/master/docs/MovimentaoApi.md

O modelo C# e a fixture Python identificada pelo autor como registro real LIQUI concordam em numeroCliente, numeroContrato, modalidade, numeroTitulo, seuNumero, codigoBarras, numeroContaCorrente, valorTitulo, valorTarifaMovimento, valorAbatimento, dataMovimentoLiquidacao, dataLiquidacao, dataPrevisaoCredito, valorDesconto, valorMora e valorLiquido. A fixture também inclui numeroContratoCobranca, mostrando que numeroContrato não deve ser presumido igual ao contrato de cobrança opcional configurado na API.

A fixture tem valorTitulo 180, valorMora 22,96, valorLiquido 202,96 e tarifa separada 1,94. É evidência de que o nome valorLiquido não pode ser automaticamente interpretado como crédito após tarifa. Os exemplos comunitários ajudam a construir o leitor e os testes, mas não são documentação contratual oficial nem comprovam os campos do retorno do convênio desta loja. A obtenção do próprio LIQUI do 3849 permitirá validar os identificadores e os valores/datas sem usar valor nominal ou data da consulta como pagamento.

A pesquisa não publicou código nem fez chamadas autenticadas ao Sicoob. A correção dos cartões 1.48.1 foi publicada após autorização explícita do usuário (commit 78b2180). A implementação LIQUI utiliza essas referências com validações de identidade, equação financeira e arquivo completo; diferenças no retorno real não são interpretadas por suposição.
