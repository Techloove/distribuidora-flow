# Confirmação de pedido: reservas e estoque negativo — fase225

A mensagem “Saída compromete mercadoria reservada (saldo 0, reservado 0)” vinha da fase212: a regra comparava o saldo após a saída com zero mesmo sem reservas de outros pedidos. Por executar antes da validação do produto, ela bloqueava também produtos autorizados a vender com estoque negativo. A fase213 também impedia saldo negativo nos depósitos, mesmo com essa autorização.

Aplicar `db/fase225_correcao_reserva_estoque_negativo.sql` no SQL Editor do Supabase. O script é transacional e reaplicável. Preserva saldos, pedidos, recebíveis, permissões e a opção cadastrada em cada produto. Execute a fase225 depois das anteriores; reaplicar a fase212 ou o lote212–220 depois dela restaura as regras antigas.

A validação passa a proteger reservas reais de outros pedidos. Sem essas reservas, o cadastro **Produtos > Permitir venda com estoque negativo** determina se a saída pode ultrapassar o saldo. Essa opção não é habilitada automaticamente. Com depósitos instalados, uma saída autorizada registra a falta no saldo contábil do depósito principal, com movimento rastreável. Entradas posteriores recompõem esse saldo, inclusive se a opção de venda negativa tiver sido desativada. A soma dos depósitos continua coerente com o saldo do centro; divergências anteriores são bloqueadas no lançamento de falta. Transferências e contagens de inventário mantêm as validações existentes; não é permitida contagem física negativa.

Se a opção estiver desmarcada e o centro do pedido não tiver saldo, o bloqueio continua correto: registre a entrada ou transferência real para esse centro. O saldo de outro centro não é usado automaticamente. A própria reserva do pedido pode ser consumida na confirmação; reservas de outros pedidos continuam protegidas, inclusive para produtos autorizados a vender no negativo. A aprovação que cria reserva continua exigindo disponibilidade para reservar.

Para consultar o pedido1 no banco real, use `db/diagnostico_pedido1_estoque.sql` (somente leitura): ele mostra produto, centro, saldo, quantidade pedida, reserva de outros pedidos e autorização para venda negativa. A captura de tela informa saldo0; sem acesso ao banco de produção, não foi confirmado o valor dessa autorização no cadastro dos produtos.

Validação em PostgreSQL isolado com PGlite: erro original da fase212 reproduzido na confirmação de pedido de teste; bloqueio posterior da fase213 também reproduzido; após a fase225 a confirmação autorizada gera uma saída e um recebível, e repetir a confirmação não duplica nenhum deles. Casos com produto não autorizado, reserva de outro pedido, consumo da própria reserva, saldo exato, ajuste, origem nula, centros distintos, depósito sem saldo anterior, regularização por entrada e divergência entre centro/depósitos também foram verificados. A migração foi reaplicada sem alterar dados previamente.

```sh
NODE_PATH=/caminho/das/dependencias node scripts/check-reserva-negativo-database.cjs
bun run check:sql
bun run check:migrations
```
