# Despesas de boletos Sicredi — fase347 / versão1.43.3

A contabilização da fase282 já recebia o cache bancário, mas Ferragens não tinha configuração ativa de conta/categoria. Seis tarifas confirmadas, de 20/10 a 05/11/2026, somavam R$ 9,17 e estavam em `sem_configuracao`.

Foi usada a RPC existente `configurar_tarifas_sicredi_282`, com administrador ativo autorizado, conta do próprio cadastro de cobrança Sicredi da loja e categoria Tarifas bancárias em Despesas Financeiras. A data inicial corresponde ao primeiro débito confirmado. A ativação reprocessou os seis registros e criou seis saídas, somando R$ 9,17. Conta: **Boletos Sicred**. Categoria: **Tarifas bancárias**. A auditoria confirma preservação dos boletos, títulos, pedidos, itens, comissões e entradas de recebimento.

O classificador da fase347 reconhece TARIFA/TARIFAS, TAXA/TAXAS, DESPESA/DESPESAS, CUSTA/CUSTAS e EMOLUMENTO/EMOLUMENTOS em débitos vinculados ao boleto. Estorno, devolução, desconto e abatimento não são despesas novas. O cache e o processador financeiro usam o mesmo classificador; a interface usa regra equivalente. Débitos não identificados permanecem para conferência.

Cada cobrança gera saída na conta configurada, com categoria de Despesas Financeiras na DRE. A despesa é separada do recebimento do cliente e pode surgir antes da liquidação quando o banco já informou o débito. Não gera outra conta a pagar por uma despesa já debitada. Permanece a identificação boleto/data, vínculo de movimento, validação de loja/conta/ambiente, conciliação de lançamento manual, proteção contra duplicidade, estorno e retorno divergente. A rotina agendada existente continua coletando os retornos; não se presume tarifa fixa nem valor pela diferença do crédito.

O Sicoob permanece isolado e sem coleta automática de despesas nesta versão. A configuração atual já separa banco e conta financeira por loja, mas sua contabilização dependerá da integração real de despesas Sicoob em produção. Sandbox não gera essas saídas. Não foi ativado nenhum serviço financeiro Sicoob.

Validação: 330 testes unitários, 2.060 verificações, TypeScript, lint, build e controles de SQL/manual/datas/versão. Testes descartáveis exercitam o cache real e o processador financeiro real separadamente, incluindo taxa/custas, DRE, preservação de recebimentos, reconsultas, estorno sem nova saída, permissões, loja, sandbox e retornos divergentes. A migração instala somente as regras de leitura/classificação; a ativação da operação atual é registrada em `auditorias/despesas-boletos-sicredi-347.json`.
