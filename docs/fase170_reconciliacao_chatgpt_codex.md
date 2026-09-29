# Fase 170 — Gate de reconciliação ChatGPT + Codex

Data: 2026-09-28

Este documento registra o ponto de reconciliação entre as duas revisões paralelas do ERP.

## Estado confirmado do GitHub

- Branch auditada: `fix/auditoria-seguranca-r1`.
- A branch contém as alterações recentes vindas do fluxo Lovable/Codex e não está atrás de `main`.
- O CI atual executa:
  - segurança/sintaxe SQL;
  - ordem/presença de migrations;
  - superfície de segurança do cliente;
  - superfície de segurança server-side;
  - testes;
  - typecheck;
  - lint;
  - build.
- Os gates Codex já estão presentes na mesma branch, incluindo Fases 136, 139, 140, 144, 147, 148 e 153.

## Regra de continuidade

A partir deste ponto, novas correções devem partir do estado atual desta branch. Não recriar em paralelo funções, RLS, grants, triggers ou migrations que já tenham sido cobertos pela revisão Codex.

Antes de qualquer nova alteração estrutural:

1. verificar se já existe migration posterior cobrindo o mesmo ponto;
2. preservar as assinaturas endurecidas das RPCs;
3. preservar os advisory locks e contextos de idempotência;
4. manter o default-deny das tabelas transacionais;
5. manter Sicredi e credenciais em perímetro server-only;
6. manter CI verde.

## Bloqueador remanescente

A branch continua mais avançada que o schema implantado no Supabase. Portanto, a validação final depende de aplicar as migrations em homologação, em ordem determinística, e executar os gates/preflights no PostgreSQL real.
