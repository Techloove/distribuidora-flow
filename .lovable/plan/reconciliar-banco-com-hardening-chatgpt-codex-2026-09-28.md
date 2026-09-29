# Reconciliar banco Supabase com hardening ChatGPT + Codex — 2026-09-28

## Situação verificada

Projeto Supabase correspondente ao ERP: **CaparaoSystem**.

A revisão foi feita em modo somente leitura. Não foi executada nenhuma migration diretamente no banco principal.

### Achados no banco atual

- As views públicas já estão com `security_invoker`.
- As funções `SECURITY DEFINER` não-trigger críticas verificadas não estão expostas a `anon` e possuem `search_path` controlado.
- Ainda existem privilégios diretos de `INSERT/UPDATE/DELETE` para `authenticated` nas tabelas transacionais críticas verificadas.
- Objetos fundacionais esperados pela branch ainda estão ausentes:
  - `estoque_saldos`
  - `transferencias_estoque`
  - `transferencias_estoque_itens`
  - `pedido_operacoes`
  - `devolucao_operacoes`
  - `estornos_financeiros`
  - `creditos_clientes`
  - `creditos_clientes_aplicacoes`
- O advisor do Supabase apontou helpers `SECURITY INVOKER` com `search_path` mutável; a Fase 159 corrige isso.
- Funções de trigger `SECURITY DEFINER` ainda possuem EXECUTE para `authenticated` no banco atual; a Fase 160 fecha esse perímetro.

## Consequência

O código do GitHub está mais avançado que o schema efetivamente implantado. Não executar apenas as migrations finais/gates, pois elas dependem das estruturas fundacionais anteriores.

## Ordem de implantação em homologação

1. Fazer backup/snapshot da base de homologação.
2. Aplicar as migrations estruturais pendentes em ordem numérica, começando pelas fases fundacionais que criam:
   - isolamento por centro;
   - estoque por centro;
   - operações/idempotência de pedido/devolução;
   - estornos;
   - créditos de clientes.
3. Aplicar o hardening de perímetro (Fases 99+).
4. Aplicar as correções reconciliadas da revisão Codex.
5. Aplicar Fases 158–161.
6. Executar os preflights/gates finais, especialmente:
   - Fase 139
   - Fase 140
   - Fase 144
   - Fase 147
   - Fase 148
   - Fase 153
   - Fase 161
7. Rodar novamente os advisors de segurança e desempenho do Supabase.
8. Executar os testes do `docs/fase96_checklist_homologacao.md`.

## Bloqueadores para produção

Não liberar produção enquanto qualquer um destes itens permanecer:

- tabelas fundacionais ausentes;
- escrita direta em tabelas protegidas;
- gate de segurança falhando;
- migration SQL sem execução real em PostgreSQL;
- teste de concorrência/idempotência sem evidência;
- advisor de segurança com achado novo não classificado.

## Observação

A revisão paralela do Codex foi incorporada ao fluxo de auditoria. As alterações novas devem ser avaliadas junto com as migrations já produzidas, evitando duplicar funções, grants, triggers ou regras de RLS.
