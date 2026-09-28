# Fase 172 — Checklist único ChatGPT + Codex antes do merge

Data: 2026-09-28

Este documento consolida a auditoria atual com a revisão paralela da branch `codex/erp-seguranca-layout`.

## Estado comparado e confirmado

- `main`: `eec3699e4ec93115e13730cb18d519da6f6f133c`.
- branch auditada: `fix/auditoria-seguranca-r1`.
- branch Codex legada: `codex/erp-seguranca-layout`.
- a branch Codex está 1 commit à frente e 12 atrás de `main`.
- a branch Codex está 1 commit à frente e 343 atrás da branch auditada.
- não fazer merge integral ou cherry-pick em bloco da branch Codex legada.
- as migrations Codex antigas `fase79_seguranca_acesso.sql`, `fase80_dashboard_resumo.sql` e `fase81_liquidacao_boleto.sql` foram substituídas por hardenings posteriores.

## Reconciliação dos achados Codex

| Achado da revisão Codex | Estado na branch atual | Evidência principal | Gate antes do merge |
| --- | --- | --- | --- |
| Integrações server-side sem autenticação forte | Reconciliado | `src/lib/server-auth.ts`, helpers server-side e testes | CI + teste de sessão inválida/inativa |
| Configuração/segredos Sicredi expostos ao navegador | Reconciliado no desenho server-only | Fases 119/121/123/124/127/129/131/135 + `sicredi-config.functions.ts` | validar secrets/env e emissão em homologação |
| Emissão Sicredi sem idempotência persistente | Reconciliado | Fases 121/129/131 | teste concorrente e recuperação de resultado desconhecido |
| Liquidação repetida de boleto duplicando pagamento | Reconciliado | Fase 152 + Fase 153 | repetir liquidação em homologação |
| Usuário sem papel / erro de menu liberando acesso | Reconciliado fail-closed | `src/lib/papeis.ts`, `src/lib/permissoes.ts`, gates 99/100 | testar usuário ativo sem papel |
| Autoescalada de perfil / atribuição automática de papel | Reconciliado | Fases 100/149 e hardening administrativo | testar alteração do próprio perfil |
| Helpers ignorando usuário inativo | Reconciliado | Fases 99/100 + preflights | testar usuário inativo chamando RPC diretamente |
| Views/RLS permissivos | Reconciliado na branch | Fases 54/73/100/144/163/166 | validar catálogo PostgreSQL real |
| Dashboard agregado no cliente / limite REST | Reconciliado para indicadores principais | Fases 151/169 | comparar valores com casos reais |
| CSV com risco de fórmula | Reconciliado | `src/lib/exportar.ts`, `tests/exportar.test.ts` | CI |
| Chamadas externas sem timeout | Reconciliado | `src/lib/fetch-timeout.ts` e integrações | CI + teste de timeout |
| Ausência de gates automáticos | Reconciliado | workflow CI + scripts `check-*.mjs` | CI verde |
| Escrita direta em tabelas transacionais | Reconciliado na branch | Fases 101/141/163/166/167 + RPCs controladas | conferir grants reais no Supabase |
| RPCs antigas/overloads contornando regras | Reconciliado com perímetro e preflights | Fases 112/114/115/116/118/137 | gate de overloads em homologação |
| Concorrência/idempotência de estoque/crédito/financeiro | Reconciliado no código | Fases 64/74/75/80/88/121/129/139/140/152 | testes simultâneos no PostgreSQL real |
| `SECURITY DEFINER` / `search_path` | Reconciliado na branch | Fases 144/159/160/161 | Supabase Advisors sem achado novo |

## Pendências que continuam reais

### 1. Banco implantado está atrás do GitHub

Este é o principal bloqueador atual.

Não aplicar somente as fases finais. Implantar as migrations pendentes em ordem numérica em homologação, começando pelas estruturas fundacionais.

### 2. Testes reais de concorrência

O CI estático não substitui PostgreSQL real. Devem existir evidências de:

- confirmação simultânea do mesmo pedido;
- transferência simultânea de estoque;
- duas aplicações do mesmo crédito;
- emissão/liquidação repetida de boleto;
- estorno repetido;
- devolução repetida.

### 3. Supabase Advisors e grants reais

Depois de aplicar as migrations, rodar novamente os advisors e conferir:

- RLS;
- `anon`;
- `authenticated`;
- trigger functions;
- `SECURITY DEFINER`;
- `search_path`;
- índices e constraints.

### 4. Multiempresa

O Codex classificou isolamento SaaS entre empresas independentes como P0.

Para a operação atual de uma única distribuidora/projeto, isso não impede o uso do ERP. Se o mesmo banco passar a hospedar empresas independentes, será necessário adicionar isolamento organizacional explícito além de centros.

## Checklist único de liberação

- [ ] backup/snapshot de homologação;
- [ ] migrations aplicadas em ordem sem erro;
- [ ] `scripts/check-migration-order.mjs` aprovado;
- [ ] gates SQL aprovados;
- [ ] RLS e grants conferidos no banco real;
- [ ] Supabase Advisors revisados;
- [ ] usuário inativo bloqueado;
- [ ] usuário sem papel bloqueado;
- [ ] Centro A não manipula Centro B;
- [ ] preço protegido para papel sem permissão;
- [ ] confirmação concorrente não duplica estoque/financeiro/comissão;
- [ ] transferência concorrente não duplica movimentos;
- [ ] mesma chave + payload diferente é rejeitada;
- [ ] crédito não pode ser consumido acima do saldo;
- [ ] boleto não pode ser liquidado duas vezes;
- [ ] emissão Sicredi suporta retry/reconciliação sem duplicar cobrança;
- [ ] estorno é idempotente;
- [ ] devolução é idempotente;
- [ ] expedição em rota impede cancelamento indevido;
- [ ] expedição entregue é imutável operacionalmente;
- [ ] dashboard confere com dados de referência;
- [ ] CI verde;
- [ ] nenhum arquivo Codex legado protegido foi reintroduzido;
- [ ] PR sai de draft somente após homologação concluída.

## Regra para novas alterações

Toda nova correção deve partir de `fix/auditoria-seguranca-r1`.

Antes de alterar SQL/RLS/RPC:

1. procurar uma fase posterior já cobrindo a regra;
2. não recriar migration Codex antiga;
3. preservar mínimo privilégio, default-deny e server-only;
4. manter idempotência e ordem determinística de locks;
5. manter todos os gates de CI verdes.

## Referências internas

- `docs/fase96_checklist_homologacao.md`
- `docs/fase164_reconciliacao_codex_supabase.md`
- `docs/fase165_ordem_implantacao.md`
- `docs/fase170_reconciliacao_chatgpt_codex.md`
- `docs/fase171_protecao_merge_codex_legado.md`
- `db/fase148_gate_revisao_codex.sql`
- `db/fase161_gate_supabase_advisors.sql`
