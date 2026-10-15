# Prazos da forma de pagamento — fase227

A confirmação instalada pela fase80 calculava vencimentos como `data_pedido + (parcela - 1) * 30`, ignorando primeira parcela e intervalo cadastrados. A prévia da tela usava corretamente os campos da forma, portanto podia mostrar datas diferentes dos títulos gerados.

Execute `db/fase227_prazos_forma_pagamento_pedido.sql` no SQL Editor do Supabase. O script substitui exclusivamente a expressão de vencimento na função instalada, preservando as verificações posteriores de carteira, aprovação, crédito, estoque compartilhado e idempotência. Se a expressão esperada não existir, aborta a transação. Pode ser reaplicado. Não reaplique fases antigas de confirmação após ele.

No cadastro **Formas de pagamento**, “Boleto20/40/60” precisa ter três parcelas, primeira em20 dias e intervalo20 dias. O nome não configura os prazos automaticamente. Os dias são corridos a partir da data do pedido, conforme a prévia existente. Por exemplo, pedido em15/10/2026 vence em04/11,24/11 e14/12/2026. Outras condições continuam usando seus próprios campos.

A rotina bloqueia a confirmação se o número de parcelas salvo no pedido divergir do padrão da forma; nesse caso, revise e salve novamente o pagamento antes de confirmar. Pedidos sem forma preservam o cálculo legado (inicial zero, intervalo30). A migração não muda os cadastros de condições nem datas/valores de títulos já gerados, pagos ou vinculados a boletos.

Para conferir o pedido nº1 já confirmado, execute `db/diagnostico_pedido1_parcelas.sql` (somente leitura). Ele mostra a data do pedido, os campos da forma, datas atuais e esperadas, pagamentos e existência de registro de boleto. Confira o resultado antes de qualquer correção retrospectiva. Um boleto registrado exige alteração de vencimento pelo fluxo bancário; alterar somente o título interno não atualiza o banco. Não cancele/reconfirme o pedido para tentar corrigir prazos, pois isso afeta estoque e financeiro.

Validação PostgreSQL isolada:

```sh
NODE_PATH=/caminho/das/dependencias node scripts/check-prazos-pagamento-database.cjs
bun run check:sql
bun run check:migrations
```

O teste reproduz a confirmação real anterior com0/30/60, aplica a correção sobre as guardas da fase209 e confere20/40/60, soma exata de2.779 em três parcelas, virada do ano, datas anteriores preservadas, rollback de confirmação inconsistente e confirmação repetida sem duplicação. A conferência do pedido real depende da consulta no Supabase; não há acesso direto ao banco de produção neste ambiente.

## Correção autorizada do pedido nº1

Após a fase227, execute integralmente `db/correcao_pedido1_vencimentos_20_40_60.sql` no SQL Editor como proprietário. Ele corrige somente os vencimentos do pedido1 para a data do pedido mais20,40 e60 dias, e retorna as datas finais. Exige condição cadastrada de boleto3× com primeira20 e intervalo20, exatamente três títulos abertos e sem pagamentos, registros de boletos ou movimentos financeiros. Qualquer divergência aborta tudo. Uma nova execução não duplica a auditoria. Não altera valores nem refaz estoque. Se houver registro bancário, use o fluxo de alteração de vencimento do boleto.

Teste isolado: `NODE_PATH=/caminho/das/dependencias node scripts/check-correcao-pedido1-database.cjs`.
