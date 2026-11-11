# Tarifas Sicoob de novas emissões do ERP — fase 355

## Escopo e configuração

Versão 1.46.0. Em Lojas → Sicoob → Produção → Conta Corrente, escolha a categoria de despesa financeira, a data inicial e ative a contabilização. A conta financeira é a já vinculada ao Sicoob na cobrança da loja, sem escolha automática de outra conta. A conta do extrato deve coincidir com a da cobrança. A instalação não ativa configurações nem lança despesas.

O usuário determinou que tarifas de boletos antigos emitidos diretamente no banco não sejam importadas, mesmo que cobradas após a data de ativação. O filtro de data não atende sozinho a essa regra. Por isso, cada tarifa deve ter identificador bancário e referência explícita ao nosso número de um boleto real de produção com operação de emissão persistida pelo ERP, da mesma loja e conta. Sandbox, registros sem operação de emissão, boletos de outro banco/conta e emissões anteriores à data inicial ficam fora.

## Prova de vínculo e limitações

O importador aceita o campo bancário explícito nossoNumero, se vier no extrato, ou a referência rotulada NOSSO NÚMERO na descrição/complemento. Não supõe que numeroDocumento seja o nosso número. Os exemplos reais recebidos até esta entrega não comprovam esse significado de numeroDocumento; portanto, linhas com apenas documento e descrição genérica TARIFA COBRANÇA não são lançadas, mesmo que a data seja recente. A primeira tarifa de boleto emitido pelo ERP ainda precisa ser conferida com um retorno real. Esta entrega não afirma que o banco fornecerá a referência explícita em todos os lançamentos.

A indicação de possível tarifa na tabela do extrato continua sendo apenas um filtro visual. A contabilização valida débito, valor positivo, data, identificação de tarifa, origem e vínculo com a emissão real. Nenhum valor é estimado a partir de tabelas de tarifas ou de outras cobranças.

## Funcionamento

Um job próprio chama /api/sicoob/tarifas a cada quinze minutos usando segredo privado. A reserva serializa consultas, preserva o intervalo global do extrato e cria lease de dois minutos com versões das configurações. Processa um mês por execução, alternando mês atual e meses anteriores desde a data inicial, dentro do limite de três meses anteriores do extrato. Sem nenhuma emissão real do ERP no período, dispensa a consulta bancária. A sincronização manual usa as mesmas reservas e validações.

O cliente bancário solicita somente cco_consulta openid e faz GET de extrato sem agrupamento CNAB. Valores vêm exclusivamente da resposta obtida pelo servidor. Antes de lançar, a finalização confere a lease, as versões, o responsável ativo e autorizado, a conta da loja e a categoria de despesas financeiras.

Cada evento é identificado por conta bancária e transactionId. Uma despesa lançada não é recriada em reconsultas. Identificadores conflitantes no mesmo lote recusam a transação. Mudança posterior do evento ou do movimento e estorno ficam sinalizados para conferência, sem relançamento. Uma saída manual preexistente com mesma conta, data e valor impede a criação automática até revisão. Essa proteção pode reter uma tarifa legítima e exige conferência; não associa uma despesa antiga apenas por igualdade de valor.

A saída usa o lançador financeiro existente, com origem despesa e categoria no grupo despesa_financeira, refletindo caixa/banco e DRE. Não cria conta a pagar adicional, não reduz crédito de boleto, não altera pedidos, títulos, estoque ou comissão. Não implementa liquidação automática dos recebimentos nem estorno financeiro automático de tarifas.

## Sandbox e listagem

Testes de homologação foram retirados do menu Boletos e movidos para a aba Sandbox · testes da configuração Sicoob em Lojas. O menu Boletos mantém as emissões reais dos dois bancos, com filtro por loja e controles de acesso existentes. Boletos antigos feitos diretamente no Sicoob não são importados por esta entrega.

## Verificação e instalação

25 testes unitários/regressões (176 expectativas), fixture PostgreSQL descartável com o lançador financeiro real e Chromium em desktop/celular. Casos: legado sem emissão ERP, referência ausente, crédito, repetição, cobranças distintas de igual valor, retorno divergente, estorno, despesa manual preexistente, pausa, permissões e preservação de boletos/títulos. Build, typecheck, lint e verificações de SQL, versões, manual e datas executados.

Aplicar db/fase355_sicoob_tarifas_financeiro.sql antes de publicar. O acesso de gerenciamento Supabase da sessão estava indisponível (HTTP 401); a migração não foi aplicada automaticamente. O usuário confirmou sua aplicação manual com sucesso em 11/11/2026; não houve verificação independente pelo acesso de gerenciamento indisponível. Após instalação e publicação, configure a categoria e a ativação na loja. Nenhuma tarifa real foi contabilizada durante o desenvolvimento.
