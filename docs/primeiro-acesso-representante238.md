# Primeiro acesso do representante — fase238

O cadastro público continua atribuindo somente o papel representante, inicialmente sem acesso. A confirmação de e-mail e a aprovação do administrador continuam obrigatórias, com escolha da carteira e dos centros autorizados. Depois da aprovação, o próximo acesso exige nome, CPF/CNPJ, telefone e endereço no formulário próprio. Ao concluir, o Cadastro Unificado passa a identificar a mesma pessoa como representante e usuário, mantendo o mesmo login e representante da carteira.

## Implantação

Após as fases221 e237 já aplicadas, execute **todo** `db/fase238_primeiro_acesso_representante.sql` no SQL Editor do projeto correto. A migração é transacional e reaplicável. Publique a versão correspondente do aplicativo no Lovable. A fase238 não exige reexecutar as anteriores; deve ficar depois delas, pois preserva e complementa suas funções de autorização.

Somente aprovações públicas posteriores à implantação exigem o formulário. Usuários já aprovados/internos não são bloqueados retroativamente. O cadastro do Édson já corrigido permanece vinculado. O formulário não depende de permissão para editar cadastros gerais: usa RPCs próprias que validam o usuário autenticado, aprovação e vínculo, sem aceitar IDs de outras pessoas, permissões, comissões ou centros no conteúdo enviado.

Enquanto há complemento pendente, o layout não monta as telas operacionais, as rotas do servidor recusam operações, e os helpers e políticas restritivas do banco bloqueiam o acesso operacional. A alteração direta do indicador no perfil é recusada; somente a conclusão validada pode produzir o comprovante privado exigido pelo gatilho. Os OIDs dos helpers são preservados para manter a proteção em policies e views existentes.

O Cadastro Unificado é criado com o papel representante inicialmente desmarcado, vinculado ao representante da aprovação e só então ativado; isso evita que o espelhamento crie uma segunda carteira. Documento já utilizado por outra pessoa exige revisão administrativa e toda a operação é revertida. O e-mail vem do perfil confirmado. Regras comerciais, comissões, centros e clientes não são enviados pelo formulário. O administrador deve continuar atribuindo a carteira correta na aprovação.

## Conferência após implantação

1. Faça um cadastro de teste pelo login e confirme o e-mail: nenhum acesso operacional deve ser liberado antes da aprovação.
2. Autorize em Usuários e papéis, escolhendo carteira e centros.
3. Entre com esse representante: deve aparecer “Complete seu cadastro”, inclusive acessando diretamente `/pedidos`.
4. Complete e salve os dados. Confira em Cadastro Unificado as marcações Representante e Usuário e a preservação da carteira no cadastro do usuário.
5. Entre como um usuário antigo para conferir que continua com o acesso normal.

## Validação de desenvolvimento

- `bun test`, `bun run typecheck`, `bun run lint`, `bun run build`.
- `NODE_PATH=<instalação do PGlite>/node_modules node scripts/check-primeiro-acesso-database.cjs`: fluxo real221 e gatilho real198, aprovação, RLS, alteração indevida do perfil, documento duplicado com rollback, preservação de carteira/comissões/centros e reexecução.
- Teste de navegador em ambiente simulado: URL direta, preenchimento móvel sem transbordamento, bloqueio inicial e liberação após salvar sem recarregar.

A validação local não executa a migração no Supabase de produção.
