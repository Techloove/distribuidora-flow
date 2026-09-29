# Fase 173 — Diagnóstico real Supabase + reconciliação Codex

Data: 2026-09-28

## Projeto Supabase identificado

O schema ERP corresponde ao projeto `CaparaoSystem` (`zviwittrjdwyczhutvjf`).
O outro projeto disponível (`Techloove's Project`) possui schema de catálogo/Natura/marketplaces e não é o banco deste ERP.

## Estado real de migrations no banco

No projeto ERP existem apenas três migrations registradas:

- `erp_seguranca_acesso_fase79`
- `erp_dashboard_resumo_fase80`
- `erp_liquidacao_boleto_fase81`

Essas três migrations correspondem à revisão Codex antiga. A branch atual `fix/auditoria-seguranca-r1` já contém versões reconciliadas e hardenings posteriores.

Conclusão: o banco real está significativamente atrás do GitHub. Não aplicar somente fases finais isoladas.

## Verificação da branch Codex

- Branch Codex: `codex/erp-seguranca-layout`.
- Ela divergiu da branch atual.
- A branch atual contém centenas de commits posteriores e já incorporou os achados relevantes do Codex.
- Não fazer merge integral nem cherry-pick em bloco da branch Codex antiga.
- O CI já bloqueia a reintrodução das migrations legadas `fase79_seguranca_acesso.sql`, `fase80_dashboard_resumo.sql` e `fase81_liquidacao_boleto.sql`.

## CI atual

- Head auditado: `c1b21842e53e3758f464ae321c2f3e8ffa5d81f8`.
- GitHub Actions: sucesso, run 630.

## Advisors reais do Supabase

O advisor de segurança do projeto ERP confirmou que o banco implantado ainda possui os pontos que as migrations posteriores já tratam no GitHub.

### Search path mutável

Foram apontadas 8 funções:

- `compra_itens_total()`
- `set_updated_at()`
- `pedido_itens_total()`
- `sync_status_ativo()`
- `sincronizar_markup_produto()`
- `so_digitos(text)`
- `norm_cidade(text)`
- `rota_cidades_touch()`

A Fase 159 já endurece exatamente essas funções.

### Trigger functions expostas / SECURITY DEFINER

O advisor apontou várias funções SECURITY DEFINER executáveis por `authenticated`, inclusive funções de trigger e RPCs legadas.

As Fases 99, 112, 114, 115, 116, 118, 137, 160 e posteriores fazem o fechamento de perímetro e mínimo privilégio.

### RLS/policies

O banco real ainda apresenta múltiplas policies permissivas em várias tabelas. As fases 163/166 e gates posteriores fazem defesa em profundidade e bloqueiam escrita direta nas tabelas transacionais protegidas.

## Próxima etapa segura

1. Criar branch de desenvolvimento/homologação do Supabase.
2. Aplicar migrations pendentes em ordem numérica.
3. Executar gates SQL e advisors novamente.
4. Testar concorrência/idempotência no PostgreSQL real.
5. Somente depois promover para produção.

## Observação de custo

A criação de uma branch Supabase para homologação tem custo informado pela plataforma de US$ 0,01344 por hora. A branch não deve ser criada sem confirmação explícita do responsável.