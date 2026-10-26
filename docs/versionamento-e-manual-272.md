# Fase272 — versões do sistema e manual do usuário

A numeração começa em **1.0.0**. As fases técnicas anteriores permanecem no histórico do repositório; não foram inventadas versões públicas retroativas. O número aparece no rodapé do menu, inclusive no menu compacto e no celular. O link **Manual do usuário** abre `/ajuda`, com busca por assunto, orientações das rotinas, atalhos conforme as permissões e histórico de novidades. O botão de impressão inclui o manual completo e permite salvar em PDF pelo navegador.

O manual é informativo e acessível a usuários autenticados que já têm acesso ao sistema. Não é um módulo de operação e não concede permissões de loja, carteira ou rotina. Contas bloqueadas, sem cadastro concluído ou sem acesso operacional não ganham acesso ao sistema por essa rota. O conteúdo administrativo é explicado como exclusivo aos perfis responsáveis; os atalhos continuam sujeitos às permissões existentes.

Não há migração SQL nesta fase. Publicar o código após a sincronização com o GitHub/Lovable. A versão exibida corresponde ao código da publicação; o registro de versão não confirma aplicação de migrações no banco nem ativação da infraestrutura de backup ou de produção fiscal.

## Próximas entregas

- Correções: `npm run version:patch -- "Resumo da correção"` (ex.: 1.0.1).
- Funcionalidades compatíveis: `npm run version:minor -- "Resumo da novidade"` (ex.: 1.1.0).
- Mudanças incompatíveis: `npm run version:major -- "Resumo da mudança"` (ex.: 2.0.0).

Executar uma vez por entrega; o script prepara a versão, mas não faz commit, push ou deploy. Datas usam Brasília. Revise as notas em `src/content/versoes.json`, mantendo as versões anteriores. Atualize as instruções em `src/content/manual.json`, execute `npm run manual:gerar` e valide `npm run check:version`. Não use `npm version` isoladamente: ele não atualiza o histórico e o manual deste projeto.

A interface usa `src/lib/versao.ts` para ler a versão atual do histórico. `package.json` mantém a mesma versão. O build e a CI rejeitam divergência entre eles, histórico inválido ou cópia do manual desatualizada. As instruções para futuras alterações também estão em AGENTS.md.

O manual em `docs/manual-do-usuario.md` é gerado do mesmo conteúdo usado pela tela. Não altere apenas essa cópia: edite a fonte JSON e gere novamente. O manual descreve o estoque próprio por loja, a regularização administrativa, o backup condicionado ao executor e as limitações atuais da homologação fiscal.

Validação: geração de versões patch/minor/major em diretório temporário, preservação do histórico, sincronização do manual, rejeição de versões divergentes e de resumo vazio; instalação com lock congelado, testes do projeto, tipagem, verificações de segurança e build. Nenhuma alteração de dados de produção é necessária.
