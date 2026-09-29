# Fase 196 — Reconciliação seletiva das alterações Codex/Lovable restantes

Data: 2026-09-29

## Estado verificado

- O PR #2 do Codex foi mesclado na `main`.
- A branch `codex/erp-seguranca-layout` não possui commits exclusivos em relação à `main`; está integralmente contida nela.
- A branch auditada `fix/auditoria-seguranca-r1` continua divergente da `main`, portanto não deve receber merge cego.
- O PR #5 permanece apenas como referência de reconciliação `main -> branch auditada`.

## Alterações portadas nesta fase

- `CrudPage`:
  - seletor persistente de colunas visíveis;
  - suporte a sugestões por cadastro padrão via `datalist`;
  - preservado o bloqueio de escrita direta nas tabelas transacionais protegidas.
- Produtos:
  - categorias e marcas usam os cadastros padrão como sugestão;
  - atalho para estoque e movimentações.
- Centros, clientes, fornecedores, pessoas e transportadoras:
  - cidade usa o cadastro padrão como sugestão.
- `/cadastros-padrao`:
  - tela reconciliada com categorias, marcas e cidades;
  - backend permanece protegido pela Fase 188 (RLS + `can_manage`).
- Menu lateral:
  - melhoria de acessibilidade no texto de fechamento.

## Alterações que NÃO foram portadas cegamente

- migrations antigas `fase79` a `fase83` da `main`;
- `auth.server.ts` e `auth-middleware.ts` paralelos;
- substituição da tela endurecida de boletos por simples redirect;
- qualquer fluxo que reduza o perímetro RPC/RLS já implementado.

## Regra

Segurança posterior da branch auditada prevalece sobre implementações antigas da `main`. Melhorias de UX podem ser portadas seletivamente por cima da arquitetura endurecida.
