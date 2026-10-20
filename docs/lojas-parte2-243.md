# Lojas — parte 2: regras comerciais e cobrança

Execute **todo** `db/fase243_parametros_por_loja.sql` no SQL Editor do projeto CaparaoSystem, depois da fase242. A migração usa uma transação: uma rotina comercial desconhecida aborta a aplicação com indicação do nome, sem deixar alterações parciais. Nesse caso, envie o erro para ajustar o mapeamento.

Depois de aplicar o SQL e publicar a versão no Lovable:

1. Abra **Lojas** e selecione a loja em **Configurações da loja**.
2. Confira regras de aprovação por crédito e atraso, tolerância, desconto máximo, margens e liberação de comissão. Salve as regras da loja.
3. Selecione a outra loja e configure separadamente. Inicialmente, ambas recebem os parâmetros atuais do sistema. Reaplicar a migração preserva as alterações individuais.
4. A cobrança usa a mesma loja selecionada. As permissões próprias da configuração bancária continuam exigidas; credenciais não foram copiadas nem alteradas.

As leituras dos motores existentes de validação, comissão, restrições de boleto e montagem/despacho de carga passam a consultar a loja do documento/carga. Autorizações e assinaturas das funções são mantidas. O aceite de orçamento continua usando o validador comercial existente. Comissões pagas não são recalculadas; mudar a regra de liberação não desfaz comissões já liberadas pelo motor atual.

**Manutenção do sistema** conserva limpeza administrativa e diagnóstico. Dados cadastrais e parâmetros comerciais deixam de ter editores globais duplicados. O catálogo global continua como referência inicial para novas lojas; alterações por API autenticada nesse catálogo são recusadas.

O estoque físico continua compartilhado. Não há mudança de vencimentos ou de dados financeiros existentes. Prazos de parcelas continuam definidos pela forma de pagamento. Parâmetros legados de prazo padrão e alerta de estoque sem consumidor operacional não são apresentados como novas regras ativas. Esta etapa não ativa emissão fiscal.

**Próxima parte:** produtos disponíveis, preços, promoções e faixas de desconto por loja. Esses recursos ainda conservam o comportamento anterior nesta versão.

## Verificação

- `bun test`, `bun run typecheck`, `bun run lint`, `bun run build`.
- Verificações de segurança SQL, cliente, servidor e ordem de migrações.
- `scripts/check-parametros-loja-database.cjs`: isolamento, RLS, permissões, valores inválidos, migração reaplicável, funções privadas, ACLs, nova loja e preservação na limpeza administrativa.
- `scripts/check-parametros-loja-motores-database.cjs`: validador201 e apurador209 reais, descontos e crédito diferentes por loja, liberação por venda/recebimento e comissão paga preservada.
- Navegador com banco simulado: salvar desconto na loja A, conferir que a loja B mantém seu valor, voltar à A, cobrança na mesma seleção e ausência do editor global.

Os testes SQL usam PostgreSQL local via PGlite; não executam no Supabase de produção.
