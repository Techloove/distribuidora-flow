# Fase 164 — Reconciliação independente Codex × Supabase

Data: 2026-09-28

Esta verificação foi feita diretamente contra o projeto Supabase `CaparaoSystem` em modo somente leitura e comparada com a branch `fix/auditoria-seguranca-r1`.

## Estado confirmado do banco atual

- O histórico de migrations do banco contém apenas 3 registros recentes (`erp_seguranca_acesso_fase79`, `erp_dashboard_resumo_fase80`, `erp_liquidacao_boleto_fase81`).
- As estruturas fundacionais esperadas pela branch ainda não existem no banco atual: `estoque_saldos`, `transferencias_estoque`, `transferencias_estoque_itens`, `pedido_operacoes`, `devolucao_operacoes`, `estornos_financeiros`, `creditos_clientes`, `creditos_clientes_aplicacoes`.
- `authenticated` ainda possui INSERT/UPDATE/DELETE direto nas tabelas transacionais críticas verificadas, incluindo pedidos, itens, compras, estoque, financeiro, boletos, logística, `user_roles` e `sicredi_config`.
- Existem 121 funções `SECURITY DEFINER` executáveis por `authenticated`; 32 delas são funções de trigger.
- O advisor de segurança aponta 8 funções com `search_path` mutável.

## Estado confirmado da branch

- A branch contém as migrations fundacionais e o hardening posterior.
- Fase 159 corrige os 8 helpers apontados pelo advisor.
- Fase 160 remove EXECUTE direto das funções de trigger `SECURITY DEFINER`.
- Fases 99+ reduzem o perímetro de execução de RPCs críticas.
- Fase 163 aplica default-deny para DML direto nas tabelas protegidas.
- Fases 136/139/140/144/147/148/153/161 funcionam como preflights/gates de segurança.
- O CI da branch executa guardas SQL, superfície cliente, superfície server-side, testes, typecheck, lint e build.

## Conclusão operacional

O diagnóstico paralelo do Codex está consistente com a leitura independente do banco: o código da branch está muito à frente do schema efetivamente implantado.

Não aplicar apenas as fases finais. A implantação segura precisa começar pelas estruturas fundacionais e seguir a ordem numérica, em homologação, antes de qualquer promoção para produção.

## Gate antes de produção

1. backup/snapshot;
2. migrations fundacionais em ordem numérica;
3. hardening de perímetro;
4. fases 159–163;
5. gates finais;
6. advisors Supabase novamente;
7. testes de concorrência/idempotência;
8. checklist `docs/fase96_checklist_homologacao.md`;
9. somente então avaliar merge/promoção para produção.