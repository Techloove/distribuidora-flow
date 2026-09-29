# Fase 189 — Reconciliação atual Main + Codex + auditoria

Data: 2026-09-29

## Estado verificado

- `main` atual: `cbc0a5868c506ce3e430138ee94f628ddce0f19d`.
- branch auditada: `fix/auditoria-seguranca-r1`.
- branch Codex `codex/erp-seguranca-layout` não possui mais commits exclusivos em relação à `main`; está integralmente contida na `main` e 28 commits atrás.
- a branch auditada divergiu da `main`: está 357 commits à frente e 30 atrás.
- o PR #1 permanece draft e não mergeável enquanto essa divergência não for reconciliada.

## Regra de reconciliação

Não fazer merge integral das migrations antigas de `main` que já foram substituídas por hardenings posteriores da branch auditada.

Arquivos legados/reconciliados protegidos pelo CI:

- `fase79_seguranca_acesso.sql`;
- `fase80_dashboard_resumo.sql`;
- `fase81_liquidacao_boleto.sql`;
- `fase82_unificar_comissoes.sql`;
- `fase83_cadastros_padrao.sql`.

As capacidades correspondentes já foram reconciliadas por fases posteriores, incluindo 100+, 151/152/153, 187 e 188.

## Alterações de produto reconciliadas nesta fase

- tela unificada de comissões da `main` portada para a branch auditada, preservando operações críticas por RPC (`liberar_comissoes`, `pagar_comissoes`, `cancelar_pagamento_comissao`);
- painel moderno de promoções da `main` portado para a branch auditada; a superfície de escrita permaneceu equivalente à versão auditada anterior;
- proteção do script de ordem de migrations ampliada para impedir reintrodução das fases 82/83 já reconciliadas.

## Próximos blocos de reconciliação

1. comparar e reconciliar `erp-layout.tsx`/menu sem perder regras de autorização;
2. comparar `auth.tsx`, `supabase-provider.tsx` e helpers de autenticação, preservando o hardening server-side da branch auditada;
3. reconciliar `dashboard.tsx` com as RPCs agregadas endurecidas;
4. reconciliar alterações de produto/cadastros e estilos visuais da `main`;
5. executar CI completo;
6. somente depois resolver o PR contra `main` e seguir para homologação Supabase.

## Regra de segurança

Em conflitos entre uma alteração visual/funcional da `main` e uma regra posterior de segurança da branch auditada, prevalece a regra posterior de segurança; a experiência de usuário deve ser portada sobre ela, e não o contrário.