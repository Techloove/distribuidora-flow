# Senha inicial, aprovação e recuperação

O cadastro público envia a senha diretamente ao Supabase Auth. A aprovação administrativa altera o perfil, representante, lojas e papel, mas não atualiza `auth.users.encrypted_password`. Não é necessário definir uma nova senha para aprovar um representante.

## Verificação de 28/10/2026

- Leitura da configuração e das funções instaladas: sete contas existentes tinham senha definida, identidade de e-mail e e-mail confirmado; nenhuma estava banida. Nenhuma senha ou hash foi exposto.
- Cadastro público de conta temporária, sem envio de e-mail porque a confirmação automática já estava habilitada no projeto: o login aceitou a senha inicial.
- Três trocas sucessivas pelo Auth, incluindo a verificação da senha atual e encerramento somente da sessão verificadora: as três novas senhas foram aceitas, e a senha antiga foi recusada.
- Geração administrativa de token de recuperação de uma conta temporária, sem envio de mensagem: token validado pelo Auth, senha redefinida e novo login aceito.
- Contas temporárias removidas após os testes. Usuários existentes não tiveram suas senhas alteradas.
- Teste isolado de banco confere que a aprovação preserva a credencial do Auth e mantém as restrições de aprovação.

Esses testes não reproduziram a perda da senha inicial relatada pelo usuário e não identificam a causa de uma tentativa específica de login. Um novo cadastro com e-mail já usado não é uma redefinição de senha. A aplicação agora explica isso e oferece recuperação pelo titular.

## Operação

- Logado: **Alterar minha senha**, informando senha atual, nova senha e confirmação. Não há limite total de trocas; limites temporários e requisitos do Supabase continuam valendo.
- Sem acesso: preencher o e-mail na entrada e usar **Esqueci minha senha**. A resposta é neutra para não revelar existência de contas. O envio só ocorre quando o usuário solicita.
- `/recuperar-senha` exige uma sessão de recuperação validada pelo SDK (`PASSWORD_RECOVERY`) e revalida o usuário com o Auth antes de atualizar a senha. Abrir a rota ou adicionar parâmetros não libera o formulário. Após salvar, a aplicação encerra a sessão e pede novo login.
- Recuperar senha não aprova cadastro, não ativa usuário e não concede papel, loja ou módulos. As verificações do banco e do servidor continuam valendo.

## Supabase e hospedagem

Os callbacks `/auth` e `/recuperar-senha` foram adicionados à lista permitida de redirecionamentos para os endereços conhecidos de produção: `caparaosystem.vercel.app`, `caparaosystem.lovable.app`, `caparaosystem.com.br` e `www.caparaosystem.com.br`. As entradas anteriores foram preservadas. Não houve alteração da política de confirmação de e-mail ou de reautenticação.

Não foi feito teste de entrega de e-mail real nem de clique no link em um dispositivo do usuário. A entrega depende do serviço de e-mail e dos limites do Supabase; domínios próprios também dependem de DNS e HTTPS válidos. Ao adotar outro endereço de produção, incluir seu callback na lista permitida antes de usar recuperação.
