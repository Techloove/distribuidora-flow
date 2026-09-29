# Fase 174 — Continuidade segura no Supabase Free

Data: 2026-09-28

## Contexto confirmado

- Projeto ERP: `CaparaoSystem` (`zviwittrjdwyczhutvjf`).
- O projeto está ativo e saudável.
- O banco real registra apenas as migrations legadas Codex 79/80/81.
- A branch `fix/auditoria-seguranca-r1` já reconciliou a revisão Codex e contém os hardenings posteriores.
- O CI da branch está verde.

## Estratégia para o plano Free

Como o plano Free não será usado com branching pago, a implantação deve evitar alterações cegas no banco principal.

1. Continuar o desenvolvimento e auditoria somente na branch `fix/auditoria-seguranca-r1`.
2. Não mesclar a branch Codex legada.
3. Antes de DDL no banco real, obter um backup lógico/exportação recuperável.
4. Executar primeiro somente diagnósticos read-only e gates que não alterem dados.
5. Aplicar migrations em lotes pequenos, na ordem definida em `docs/fase165_ordem_implantacao.md`.
6. Após cada lote, rodar os gates SQL, Supabase Advisors e smoke tests do ERP.
7. Interromper imediatamente o lote se houver erro; não pular migrations dependentes.
8. Só avançar para o lote seguinte com CI verde e banco saudável.

## Lotes recomendados

### Lote A — fundação de segurança
- Fases 48, 51, 54–58.
- Objetivo: fail-closed, escopo por centro, estoque por centro, planejamento e rate limit.

### Lote B — logística/estoque/financeiro base
- Fases 59–76.
- Objetivo: fluxo operacional, cancelamentos, transferências, escrita controlada e perímetro financeiro.

### Lote C — crédito/pedidos/expedição
- Fases 80–89.
- Objetivo: crédito de cliente, CRUD controlado, expedição e idempotência de faturamento.

### Lote D — perímetro e mínimo privilégio
- Fases 99–118.
- Objetivo: fechar RPCs legadas, escrita direta e operações administrativas.

### Lote E — Sicredi server-only
- Fases 119–135.
- Objetivo: credenciais fora do navegador, reserva, persistência e idempotência.

### Lote F — reconciliação/gates
- Fases 136–169.
- Objetivo: preflights Codex, default-deny, Advisors, RLS restritivo, mínimo privilégio e dashboard.

### Lote G — documentação/gate final
- Fases/documentos 170+.

## Regras de segurança

- Não executar migrations antigas Codex `fase79_seguranca_acesso.sql`, `fase80_dashboard_resumo.sql` ou `fase81_liquidacao_boleto.sql` novamente.
- Não aplicar somente migrations finais sobre o schema atual.
- Não executar DDL destrutivo sem backup recuperável.
- Não alterar o projeto `Techloove's Project`; ele não é o banco deste ERP.
- Mercado Livre e Shopee continuam fora do escopo.

## Estado dos Advisors antes da implantação

O banco atual ainda reporta achados que a branch já trata, incluindo:

- 8 funções com `search_path` mutável;
- várias funções `SECURITY DEFINER` executáveis por `authenticated`;
- múltiplas policies permissivas.

Esses avisos devem ser reavaliados depois dos lotes correspondentes, não corrigidos manualmente fora das migrations versionadas.

## Critério para aplicar no banco real

Somente iniciar os lotes após existir backup lógico recuperável e janela de manutenção. Até lá, continuar auditoria, CI e reconciliação no GitHub.