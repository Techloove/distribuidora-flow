# Fase 197 — Estado final de reconciliação + Supabase Free

Data: 2026-09-29

## GitHub verificado

- `main`: `cbc0a5868c506ce3e430138ee94f628ddce0f19d`.
- branch auditada: `fix/auditoria-seguranca-r1`.
- PR #1: draft, mergeável.
- comparação atual `main...fix/auditoria-seguranca-r1`: branch 392 commits à frente e 0 atrás.
- portanto, as alterações Codex/Lovable já incorporadas à `main` foram reconciliadas na branch auditada; não há mais divergência pendente da `main` para portar antes da implantação.
- CI do head `ef261b57c1b920d18234798ba250e0954af79008`: sucesso (run 711).

## Supabase verificado

- organização: plano Free (`tier_free`).
- projeto ERP correto: `CaparaoSystem` (`zviwittrjdwyczhutvjf`).
- banco ativo e saudável.
- migrations registradas atualmente: somente `erp_seguranca_acesso_fase79`, `erp_dashboard_resumo_fase80`, `erp_liquidacao_boleto_fase81`.

## Preflight real do Lote A

O preflight read-only equivalente à Fase 176 foi executado diretamente no banco real e passou nas dependências estruturais.

Estado encontrado antes do Lote A:

- `estoque_saldos`: ausente;
- `api_rate_limits`: ausente;
- `usuario_pode_acessar_centro(uuid)`: existente;
- `consumir_rate_limit(text,integer,integer)`: ausente;
- `vw_sugestao_compras_centro`: ausente.

Isso confirma que o banco ainda está no perímetro legado e que o Lote A ainda precisa ser implantado.

## Advisors atuais

O Advisor de segurança ainda aponta achados compatíveis com o estado legado do banco, incluindo:

- funções com `search_path` mutável;
- funções `SECURITY DEFINER` expostas além do perímetro final;
- policies permissivas sobrepostas;
- grants de escrita que serão reduzidos pelas fases posteriores.

Esses achados não devem ser corrigidos manualmente fora da sequência versionada.

## Estratégia final no plano Free

Como não há branch paga de banco, a implantação deve continuar em lotes pequenos no projeto principal, com janela de manutenção e possibilidade de restauração externa antes do primeiro DDL.

Ordem:

1. Lote A: Fases 48, 51, 54–58; depois Gate 177.
2. Lote B: Fases 59–76; depois Gate 179.
3. Lote C: Fases 80–89; depois Gate 181.
4. Lote D: Fases 99–118; Preflight 182 e Gate 183.
5. Lote E: Fases 119–135; Preflight 184 e Gate 185.
6. Lote F: Fases 136–169; depois gates finais e Advisors.

## Critério de finalização

O código está reconciliado com Codex/Lovable e CI verde. O bloqueador restante para produção é somente a implantação ordenada das migrations no Supabase real e a validação dos gates pós-lote.