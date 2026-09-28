# Fase 175 — Execução segura no plano Free após reconciliação Codex

Data: 2026-09-28

## Estado verificado

- Organização Supabase: plano Free.
- Projeto ERP correto: `CaparaoSystem` (`zviwittrjdwyczhutvjf`).
- Não foi criada branch paga de banco.
- Banco real ainda registra somente as migrations legadas Codex 79/80/81.
- Branch de desenvolvimento: `fix/auditoria-seguranca-r1`.
- A branch está à frente de `main` e contém a reconciliação ChatGPT + Codex.
- CI do head `b0c3551308681e33166ca31eac30c5b2259073b6`: sucesso (run 635).

## Diagnóstico read-only do Supabase

O Advisor de segurança ainda acusa problemas no banco implantado que já possuem correções versionadas no GitHub:

- 8 funções com `search_path` mutável — tratadas pela Fase 159;
- muitas funções `SECURITY DEFINER` executáveis por `authenticated` — perímetro tratado pelas Fases 99, 112, 114, 115, 116, 118, 137 e 160;
- múltiplas policies permissivas — endurecimento nas Fases 163 e 166;
- demais gates de segurança permanecem nas Fases 144, 147, 148, 153, 161 e 168.

## Sequência oficial no plano Free

1. Manter desenvolvimento somente em `fix/auditoria-seguranca-r1`.
2. Não mesclar a branch legada `codex/erp-seguranca-layout`.
3. Obter backup lógico recuperável antes de qualquer DDL no banco principal.
4. Rodar diagnósticos read-only e registrar o baseline.
5. Aplicar Lote A: Fases 48, 51 e 54–58.
6. Validar ERP + Advisors + gates.
7. Aplicar Lote B: Fases 59–76.
8. Validar estoque, financeiro, logística e concorrência.
9. Aplicar Lote C: Fases 80–89.
10. Validar créditos, pedidos, devoluções e expedição.
11. Executar Fase 182 (preflight do Lote D).
12. Aplicar Lote D: Fases 99–118.
13. Executar Fase 183 (gate do Lote D) e validar mínimo privilégio, RPCs e operações administrativas.
14. Executar Fase 184 (preflight do Lote E).
15. Aplicar Lote E: Fases 119–135.
16. Executar Fase 185 (gate do Lote E) e validar Sicredi server-only, retries e idempotência.
17. Aplicar Lote F: Fases 136–169.
18. Executar gates finais, Advisors e testes de concorrência.
19. Só então retirar o PR de draft e planejar merge para `main`.

## Regra de execução

Sem homologação paga, cada lote no banco principal deve ter janela de manutenção, backup recuperável e parada imediata ao primeiro erro. Não pular migrations dependentes e não aplicar fases finais isoladas.

## Próximo passo operacional

Preparar o Lote A para execução, mas não aplicar no banco principal enquanto o backup recuperável não estiver confirmado.