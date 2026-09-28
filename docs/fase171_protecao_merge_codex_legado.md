# Fase 171 — Proteção contra merge da branch Codex legada

Data: 2026-09-28

Foi verificada a branch `codex/erp-seguranca-layout`.

## Resultado

- A branch Codex divergiu de uma base antiga (`4bf9a2d6...`).
- Em relação a `main`, ela está 1 commit à frente e 12 atrás.
- Em relação a `fix/auditoria-seguranca-r1`, ela está 1 commit à frente e 337 atrás.
- Portanto, não deve ser mesclada integralmente na branch atual.

## Correções do Codex já reconciliadas

A branch atual já incorporou, por implementações próprias e fases posteriores, os pontos relevantes da revisão paralela:

- validação de usuário ativo e papel;
- proteção contra autoescalada de perfil;
- cadastro sem concessão automática de papel;
- `security_invoker` em views;
- remoção de execução anônima de RPCs críticas;
- dashboard agregado no PostgreSQL;
- liquidação de boleto idempotente;
- emissão Sicredi com reserva server-only;
- credenciais Sicredi fora do navegador;
- autenticação server-side e rate limit;
- neutralização de fórmulas em CSV;
- timeouts para chamadas externas;
- testes e gates de CI.

## Arquivos antigos que não podem reaparecer

- `db/fase79_seguranca_acesso.sql`
- `db/fase80_dashboard_resumo.sql`
- `db/fase81_liquidacao_boleto.sql`

Esses arquivos foram substituídos pelas fases reconciliadas 100+/148/151/152/153 e hardenings posteriores.

O CI agora falha caso esses nomes sejam reintroduzidos por merge ou cherry-pick.

## Continuidade

Continuar somente sobre `fix/auditoria-seguranca-r1`, mantendo o CI verde e validando o schema real em homologação antes da promoção para produção.