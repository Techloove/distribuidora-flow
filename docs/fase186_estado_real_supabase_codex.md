# Fase 186 — Estado real Supabase + reconciliação Codex

Data: 2026-09-28

## Verificação executada

A validação foi feita diretamente no projeto Supabase `CaparaoSystem` em modo somente leitura e comparada com a branch `fix/auditoria-seguranca-r1` e com a branch legada `codex/erp-seguranca-layout`.

## Estado do GitHub

- branch auditada: `fix/auditoria-seguranca-r1`;
- CI do head atual: verde;
- PR #1: aberto, draft e mergeável;
- branch Codex legada: divergiu e, na verificação atual, está 363 commits atrás da branch auditada, com apenas 1 commit exclusivo;
- não fazer merge/cherry-pick em bloco da branch Codex legada; os achados relevantes já foram reconciliados e substituídos por hardenings posteriores.

## Estado real do Supabase

- Organização confirmada no plano Free (`tier_free`).
- Projeto ERP confirmado: `CaparaoSystem` (`zviwittrjdwyczhutvjf`).
- CI do head `e96a6daf6643386f12959acd69f344043015652d`: sucesso (run 667).


O banco implantado está significativamente atrás do GitHub.

Migrations registradas no projeto atual:

1. `erp_seguranca_acesso_fase79`
2. `erp_dashboard_resumo_fase80`
3. `erp_liquidacao_boleto_fase81`

As estruturas fundacionais novas da branch ainda não estão implantadas no banco atual.

## Achados de segurança atuais no banco implantado

- 8 funções foram apontadas pelo Advisor com `search_path` mutável;
- o Advisor aponta várias funções `SECURITY DEFINER` executáveis por `authenticated`; parte delas é RPC intencional, mas trigger functions e helpers internos devem ser removidos da superfície pública conforme as Fases 159/160;
- tabelas transacionais críticas ainda possuem privilégios diretos de `INSERT/UPDATE/DELETE` concedidos a `authenticated` e também a `anon` no catálogo;
- RLS está habilitado nas tabelas consultadas, mas GRANT + RLS atuais ainda não refletem o perímetro final da branch.

Exemplos confirmados com DML direto concedido atualmente: `pedidos`, `pedido_itens`, `compras`, `compra_itens`, `estoque_movimentos`, `contas_receber`, `contas_pagar`, `comissoes`, `movimentos_financeiros`, `boletos`, `expedicoes`, `cargas`, `carga_pedidos`, `pedido_separacoes`, `sicredi_config` e `user_roles`.

Também foi confirmado que existem policies restritivas de usuário ativo/centro em várias dessas tabelas, mas elas coexistem com policies permissivas de escrita e com GRANTs amplos. Portanto, o perímetro implantado ainda é o legado e não deve ser confundido com o hardening final da branch.

## Consequência

Não aplicar apenas um REVOKE isolado em produção agora. O frontend/banco implantado ainda depende do schema antigo. O endurecimento deve ser aplicado em homologação na ordem oficial para que as RPCs controladas existam antes de remover a escrita direta.

## Ordem segura

1. criar/usar homologação separada;
2. aplicar migrations na ordem definida em `docs/fase165_ordem_implantacao.md`;
3. executar gates 177, 179, 181, 183 e 185 após cada lote;
4. executar gates finais 147, 148, 153 e 161;
5. rodar Supabase Advisors novamente;
6. executar testes de concorrência/idempotência;
7. só depois promover para produção.

## Bloqueador atual

Não existe branch de desenvolvimento Supabase separada no projeto neste momento. A única branch listada é `main`. Criar uma branch Supabase pode ter custo e deve ser confirmado antes da criação.

## Regra de continuidade

Novas correções de código devem partir da branch auditada atual. O próximo ganho relevante não é criar mais hardening duplicado, e sim implantar o conjunto existente em homologação e validar o PostgreSQL real.