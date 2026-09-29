# Fase 195 — Reconciliação Codex/Lovable concluída no front crítico

Data: 2026-09-29

## Revisão realizada

Foi verificado o merge do PR #2 (Codex: `codex/erp-seguranca-layout`) já incorporado à `main`.
A branch de auditoria não deve receber merge cego dessas migrations antigas porque possui hardenings posteriores que substituem parte delas.

## Alterações portadas desta revisão

- `src/components/erp-layout.tsx`
  - menu compacto persistente;
  - melhorias de acessibilidade e navegação móvel;
  - preservados os módulos endurecidos da branch auditada, incluindo estoque, boletos e conciliação de créditos.

- `src/routes/auth.tsx`
  - nova experiência visual de login;
  - permanece sem cadastro público;
  - autenticação continua via Supabase e liberação administrativa.

- `src/lib/supabase-provider.tsx`
  - reconciliação mais robusta de eventos de sessão;
  - limpeza de cache quando muda a identidade;
  - revalidação periódica de perfil e papéis;
  - invalidação do roteador em eventos relevantes de autenticação.

- `src/routes/_app/dashboard.tsx`
  - experiência visual e tratamento de erro portados;
  - rankings continuam usando a RPC endurecida `dashboard_rankings`, em vez de voltar às agregações no cliente.

- `src/routes/_app/route.tsx`
  - tela explícita para acesso negado/pendente;
  - fail-closed quando o módulo não está autorizado;
  - redirecionamento somente para módulo permitido.

- `src/router.tsx`
  - retry controlado e staleTime global;
  - mutations sem retry automático.

- `src/routes/__root.tsx`
  - localização pt-BR e metadados/UX do fluxo Codex/Lovable.

- `src/lib/supabase-client.ts`
  - promessa do cliente é resetada após falha de configuração/conexão, permitindo nova tentativa sem recarregar o processo.

## Decisões de segurança

Os arquivos `src/lib/auth.server.ts` e `src/lib/auth-middleware.ts` da `main` não foram copiados de forma paralela.
A branch auditada já usa `src/lib/server-auth.ts` nas funções de servidor e acrescenta rate limit e validações específicas.
Duplicar dois mecanismos de autenticação server-side aumentaria risco de divergência.

As migrations Codex 79/80/81 também não devem ser reaplicadas sobre as fases posteriores da branch auditada sem reconciliação, pois suas capacidades já foram substituídas por hardenings posteriores.

## Estado de merge

O PR #1 ainda diverge da `main`. A resolução deve continuar por reconciliação seletiva, preservando a versão mais restritiva das regras de segurança e trazendo por cima as melhorias de produto/UX.
