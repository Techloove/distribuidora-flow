# Primeiro cadastro de representantes — fase221

## Ativação

1. Execute **todo** o arquivo `db/fase221_cadastro_representante_aprovacao.sql` no SQL Editor do Supabase como `postgres`, mantendo RLS ativo. Pré-requisito: estrutura existente até a fase220, incluindo as funções administrativas das fases27,28 e47. O arquivo é transacional e pode ser reaplicado sem reclassificar usuários existentes.
2. Em Supabase → Authentication → configuração de cadastro, permita novos cadastros e mantenha o provedor de e-mail habilitado. Se o projeto estiver com novos cadastros desabilitados, o formulário informa isso; o código não modifica essa configuração externa. Mantenha confirmação de e-mail habilitada e configure o envio de e-mails do projeto. Se a confirmação estiver desabilitada, o Supabase poderá confirmar automaticamente; a autorização administrativa continua obrigatória.
3. Confira Site URL e URLs de redirecionamento autorizadas para `https://caparaosystem.lovable.app/auth` e o domínio próprio utilizado, quando houver. O formulário utiliza a origem atual com `/auth` para o retorno da confirmação.
4. Atualize o aplicativo após a sincronização do GitHub/Lovable. A interface só habilita o envio do primeiro cadastro quando o sinal público da fase221 estiver disponível. Não precisa executar fases anteriores novamente.

## Representante

Na tela de login, clique em **Não tenho cadastro · Primeiro acesso**. Informe nome, e-mail, telefone opcional e uma senha de pelo menos 8 caracteres, repetida na confirmação. O cadastro público passa pelo Supabase Auth, que aplica validação de e-mail, política de senha e limites de requisição configurados no projeto.

O perfil nasce **inativo**, em **Aguardando autorização**, com somente o papel `representante` e sem centros de custo liberados. O solicitante não escolhe papéis, carteira nem status. Metadados enviados fora do formulário também não podem escolher privilégios. Se receber mensagem de confirmação de e-mail, confirme o endereço e aguarde o administrador. Entrar antes da autorização mostra o bloqueio, sem abrir as rotinas do ERP.

Não há confirmação falsa de liberação quando o Supabase devolve sessão automaticamente: a sessão gerada no cadastro é encerrada e o acesso continua bloqueado no banco. Para preservar a proteção do provedor contra identificação de contas existentes, a mensagem de recebimento é genérica; se o e-mail já estiver cadastrado, use o login ou procure o administrador.

## Administrador

Em **Usuários e papéis → Primeiros cadastros de representantes**, escolha **Analisar cadastro**:

- Vincule um representante ativo existente sem outro login associado, preservando sua carteira, ou crie um novo representante. O novo representante começa sem clientes na carteira; a gestão deve associar os clientes posteriormente nos cadastros existentes.
- Selecione pelo menos um centro de custo ativo. A autorização não libera “todos os centros”.
- Clique em **Autorizar representante**. O e-mail precisa estar confirmado no Supabase. A decisão ativa o perfil, registra administrador/data na auditoria e mantém somente o papel representante. Depois da aprovação, alterações de papéis seguem a administração já existente.
- Para recusar, informe uma justificativa. O perfil permanece sem acesso. As recusas podem ser consultadas no filtro **Recusados** e reavaliadas pelo administrador.

Só administrador **ativo** pode decidir; gestor não autoriza. A edição genérica do usuário não substitui a aprovação, e os controles de ativo/papéis ficam bloqueados na interface enquanto o cadastro aguarda decisão. As funções existentes de criação deliberada por administrador conservam seu fluxo; contas já existentes não são colocadas em aprovação pela migração.

## Verificação realizada

TypeScript, compilação, 60 testes existentes e verificações de segurança. Os verificadores de cadastro foram atualizados para reconhecer exclusivamente o fluxo pendente da fase221; outros cadastros públicos no cliente e atribuição automática de privilégios continuam sendo rejeitados. Teste de banco PGlite executa a migração e os helpers administrativos de centros/vínculo/edição: metadados maliciosos ignorados, impossibilidade de autoativação, gestor/administrador inativo bloqueados, exigência de confirmação/centros, representante já ocupado rejeitado, criação de representante novo, recusa, reavaliação e reaplicação preservando decisões.

O teste no navegador usa Auth/API simulados para verificar o formulário, confirmação de senha, bloqueio antes da migração, sessão automática, login pendente, autorização/recusa e tela móvel. Não foi enviado e-mail real nem executado SQL no Supabase de produção neste ambiente. A configuração de Authentication e o envio real devem ser conferidos após a implantação.
