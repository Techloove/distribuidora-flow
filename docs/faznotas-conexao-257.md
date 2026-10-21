# FAZNOTAS — conexão por loja, fase257

## Instalação

1. Aplicar integralmente `db/fase257_conexao_faznotas.sql` após a fase256, no Supabase usado pelo sistema. A migração não modifica documentos, produtos, séries ou credenciais Sicredi. É reaplicável.
2. Publicar a versão no Lovable. O servidor utiliza as variáveis já usadas na integração Sicredi: `EXT_SUPABASE_URL`, `EXT_SUPABASE_ANON_KEY` e `EXT_SUPABASE_SERVICE_ROLE_KEY`. A última deve permanecer exclusivamente no servidor, sem prefixo público/VITE e sem ser enviada pelo chat.
3. Como administrador, acessar **Lojas → Configurações da loja → Conexão FAZNOTAS por loja**.
4. Conferir o CNPJ cadastrado na loja. No painel FAZNOTAS da mesma empresa, obter o token em **Meus Dados → Integração**. Informar apenas o token, sem `Token ` no início, e confirmar o CNPJ associado no painel.
5. Salvar. O campo fica vazio novamente; a tela mostra apenas se existe token cadastrado. Campo vazio preserva a credencial anterior exclusivamente para o mesmo CNPJ.
6. Usar **Testar acesso sem emitir nota**. A chamada é `GET https://api.mysebr.com.br/nfemyse-v3/rest/produtos?page=1&page_size=1`, com `Authorization: Token …`. Nenhuma nota ou produto é criado. `/health` não foi utilizado porque não exige autenticação.

Uma consulta confirmada comprova acesso autenticado à API. Ela não comprova a correspondência do token ao CNPJ: o endpoint de produtos não retorna identidade da empresa. Por isso essa conferência é feita no painel pelo administrador, e a configuração exige que o CNPJ informado coincida com o cadastro local. Também não comprova autorização da SEFAZ nem qual ambiente fiscal está habilitado na conta. A documentação recebida não informa URL separada de homologação; não foi criada uma URL fictícia.

## Proteção

- Credencial por loja em tabela com RLS, sem permissões de SELECT/INSERT/UPDATE/DELETE para anon ou authenticated. Somente service_role pode ler o token. O servidor só realiza essa leitura depois de autenticar o administrador e validar a loja, a situação do usuário, a permissão de configuração e o limite de requisições.
- A gravação é uma RPC controlada: administrador ativo, loja acessível e ativa, permissão de configuração e CNPJ correspondente. Não há retorno de token, exportação ou preenchimento automático do segredo na tela.
- O gestor autorizado consulta apenas o estado da conexão. Cadastro e teste de credencial são exclusivos do administrador.
- Alterar o CNPJ da loja invalida a conferência da conexão e impede o teste até atualizar o vínculo. Não preserva token anterior ao trocar o CNPJ.
- Token não aparece na auditoria: registra-se apenas CNPJ, usuário e data. Dados remotos do catálogo também não retornam à tela.
- Endpoint externo fixo, sem URL fornecida pelo navegador, sem seguir redirecionamentos; chamadas têm timeout. Não há chamada de emissão nesta etapa.

## O que continua pendente

A conexão não libera emissão. A próxima etapa operacional precisa parametrizar os blocos tributários por loja/produto/CFOP/UF, sincronizar os cadastros com a API, validar os totais e endereços por documento e implementar a fila idempotente de emissão e consulta. Após autorização, gravar chave/protocolo e disponibilizar DANFE/XML. Notas históricas e o faturamento atual permanecem como estão.

## Validação local

- `bun test tests/faznotas-conexao.test.ts`: GET autenticado paginado, ausência de criação/emissão, token e catálogo não retornados, corpo200 sem status005 não confirma acesso, tratamento401/403/429.
- `NODE_PATH=/tmp/validacao-unificacao/node_modules node scripts/check-faznotas-conexao-database.cjs`: migração reaplicada, preservação de token, CNPJ divergente, bloqueio de não administrador, proibição de leitura direta, auditoria sem segredo.
- Nenhuma credencial real foi usada nem houve contato com a FAZNOTAS durante a implementação.
