# Fase 165 — Ordem determinística de implantação

A revisão conjunta ChatGPT + Codex deixou a branch com muitas migrations de hardening e alguns números de fase compartilhados por mais de um arquivo.

Para evitar ambiguidade na homologação, a ordem oficial passa a ser:

1. ordenar pelo número após `fase`;
2. para arquivos com o mesmo número, ordenar pelo nome completo do arquivo;
3. aplicar todos os arquivos anteriores antes de executar gates/preflights finais;
4. nunca aplicar somente as fases finais em um banco que ainda não possui as estruturas fundacionais.

O CI executa `bun run check:migrations` para garantir que os arquivos fundacionais e gates essenciais continuam presentes e que migrations transacionais não ficaram com BEGIN/COMMIT incompletos.

## Estado verificado em 2026-09-28

O projeto Supabase `CaparaoSystem` ainda possui apenas três migrations recentes registradas e não contém várias estruturas fundacionais esperadas pela branch. Portanto, esta sequência deve ser validada primeiro em homologação.

A branch atual também já incorpora a revisão Codex, os hardenings de segurança e os gates finais. O CI deve permanecer verde antes de qualquer implantação.
