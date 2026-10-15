# Estoque compartilhado entre lojas — fase226

Os centros de custo identificam pedidos, compras, financeiro e relatórios. A disponibilidade física é única: `produtos.estoque_atual` é o saldo canônico; a soma de `deposito_saldos` distribui esse mesmo saldo por local físico. Não se somam essas duas fontes. Reservas de pedidos de todos os centros consomem a mesma disponibilidade.

## Implantação

1. Após a fase225, execute integralmente `db/fase226_estoque_compartilhado.sql` no SQL Editor do Supabase, como proprietário do banco. Não desative RLS. Prefira um momento sem lançamentos em andamento, pois a migração bloqueia brevemente as tabelas de estoque.
2. O script preserva o estoque global e os depósitos existentes. Um produto com 1.000 no cadastro e sem distribuição física recebe exatamente 1.000 no depósito “Estoque compartilhado”, sem entrada adicional no total do produto. A distribuição inicial é auditada. O centro cadastral desse depósito é apenas um vínculo legado e não restringe sua utilização às vendas daquele centro.
3. Se já houver distribuição física ou histórico de depósitos incompatível com o cadastro, a transação inteira é desfeita e identifica o produto divergente. Confira esse saldo antes de continuar; não altere quantidades para apenas contornar a mensagem. Reservas preexistentes acima do saldo também bloqueiam a migração.
4. Atualize a aplicação após publicar o código. Confirme o pedido e confira a baixa: saldo inicial 1.000 menos saída60 = 940, acessível às vendas dos dois centros. Outras reservas/produtos do pedido continuam sendo validados.

A migração é reaplicável: não reinicializa nem repõe saldos já consumidos. Não reaplique as fases55,212,213,220,225 ou o lote212–220 depois dela, pois restaurariam regras anteriores. Não há execução automática no banco de produção pelo repositório.

## Operação

- Estoque e alertas do dashboard mostram o saldo global, independentemente do centro selecionado. O histórico de movimentações mantém o filtro de centro; novos lançamentos exigem um centro autorizado para atribuição comercial.
- Entradas normais vão ao depósito “Estoque compartilhado”. Saídas consomem os depósitos existentes de qualquer centro. O inventário ajusta apenas o depósito contado e atualiza o total global uma única vez.
- Para mudar a posição física, use transferência entre depósitos. A antiga transferência de estoque entre centros é bloqueada: mudar o centro comercial não representa saída/entrada física.
- Aprovação reserva o saldo global disponível. Confirmação consome a própria reserva e protege reservas de outros pedidos de qualquer loja. Cancelar ou devolver à digitação libera a reserva.
- Estoque negativo continua dependendo da autorização de cada produto; essa autorização não é habilitada pela migração. Reservas reais de outros pedidos permanecem protegidas.
- O saldo no cadastro do produto passa a ser consultivo. Produtos novos começam com zero; estoque inicial, alterações e reposições devem usar movimentos ou inventário, mantendo os depósitos sincronizados.
- O cadastro de produtos fica disponível independentemente do centro selecionado. O campo legado `produtos.centro_id` é preservado no banco, mas deixa de ser atribuição de estoque na interface.
- A reposição passa a retornar uma linha por produto para o estoque compartilhado, sem duplicar a sugestão para cada loja. Demanda comercial e compras continuam limitadas às linhas permitidas pelas políticas existentes do usuário.
- Permissões de movimentar, operar depósitos, contar e conferir inventário são mantidas. A consulta agregada de reservas não revela pedidos nem carteiras de outros representantes. Pedidos, financeiro e clientes mantêm as restrições por usuário e centro existentes.

`estoque_saldos` é mantida para histórico de atribuição por centro e compatibilidade, sem determinar disponibilidade física. Uma saída atribuída a um centro que não recebeu a compra pode produzir atribuição negativa nessa tabela, sem indicar falta física. O diagnóstico gerencial foi atualizado para comparar o saldo global, reservas globais e total dos depósitos.

## Validação

```sh
NODE_PATH=/caminho/das/dependencias node scripts/check-estoque-compartilhado-database.cjs
bun test
bun run typecheck
bun run build
bun run check:sql
bun run check:migrations
```

O teste de PostgreSQL isolado executa os motores reais de confirmação, movimentação, reserva e depósitos. Verifica saldo legado1.000 sem duplicação, falha transacional em divergência, reaplicação, consumo pelas duas lojas, bloqueio por reserva global, consumo da própria reserva, insuficiência real, negativo autorizado, entrada, transferência física, inventário idempotente e restrições de leitura/escrita. Não substitui a execução e conferência dos saldos do banco real.

Conferência de interface em Chromium com dados simulados: saldo1.000, reserva60 e disponível940; depósitos de duas lojas sem filtro por centro; produto com vínculo legado em outra loja continua visível; planejamento compartilhado. Compilação, TypeScript e86 testes gerais passaram. Lint sem erros, com nove avisos preexistentes de React Refresh.
