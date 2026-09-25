# Aplicar no banco as alterações vindas do GitHub (ChatGPT)

## Situação verificada
- O código está sincronizado: as duas últimas alterações feitas pelo GitHub (Fase 77 e Fase 78) já aparecem no Lovable.
- O banco de dados, porém, ainda não recebeu nenhuma das duas:
  - Fase 77 (uma comissão por pedido): a proteção contra comissão duplicada não existe no banco.
  - Fase 78 (centro no crédito de devolução): a devolução ainda gera o crédito sem o centro de custo.

## O que será feito
1. Conferir se já existe pedido com comissão duplicada (se existir, a Fase 77 para e eu mostro quais pedidos antes de corrigir).
2. Aplicar a Fase 77 no banco.
3. Aplicar a Fase 78 no banco.
4. Testar em modo simulado (sem gravar): tentar criar comissão duplicada (deve bloquear) e confirmar uma devolução (o crédito deve sair com o centro).

## Detalhes técnicos
- Executar `db/fase77_integridade_comissoes.sql` e `db/fase78_centro_credito_devolucao.sql` via `EXT_SUPABASE_DB_URL`.
- Validar `comissoes_pedido_uq` em `pg_indexes` e o novo corpo de `confirmar_devolucao`.
