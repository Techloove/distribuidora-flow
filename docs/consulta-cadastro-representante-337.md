# Consulta de CNPJ e IE no cadastro do representante

O formulário simplificado passa a consultar os dados públicos da empresa ao completar um CNPJ com 14 dígitos, após uma breve pausa na digitação. Usa as mesmas funções e provedores do cadastro administrativo, com um contexto específico de inclusão por representante. Há botões para repetir a consulta do CNPJ e consultar a inscrição estadual pelo CNPJ.

A consulta preenche somente campos vazios de identificação, contato e endereço aceitos pelo cadastro do representante. Valores digitados manualmente permanecem. Ao trocar o CNPJ, valores anteriormente preenchidos pela consulta são limpos se não tiverem sido editados manualmente; respostas atrasadas de outro documento são ignoradas. A consulta não altera o documento digitado, loja, carteira, rota, limite, status nem aprovação.

Ao informar a IE, o sistema busca os registros fiscais daquele CNPJ e indica se o número corresponde. Também é possível consultar pelo botão e escolher **Usar esta IE**, especialmente quando há mais de um registro. Ausência de IE não é tratada como isenção: a fonte precisa declarar explicitamente essa condição. Os dados continuam sujeitos à revisão administrativa. Falhas ou indisponibilidade permitem preencher manualmente.

## Autorização

O caminho administrativo permanece restrito a administrador/gestor. O parâmetro de consulta do representante não amplia esses papéis: exige sessão válida, licença liberada, perfil ativo com primeiro acesso concluído, papel representante, permissão/menu de cadastro e vínculo ativo com o representante autenticado. Todas as chamadas usam o JWT do próprio usuário. Uma RPC booleana verifica somente a autorização e o vínculo do próprio usuário no servidor; não se usa service role nem SELECT administrativo no navegador. A conferência em produção identificou representantes com permissão de cadastro mas sem leitura da própria linha na tabela administrativa, por isso a validação não depende dessa leitura.

Somente CNPJ e seus registros de IE são liberados nesse contexto. A consulta externa de CPF continua restrita ao caminho administrativo existente; CPF pode ser cadastrado manualmente. O limite de chamadas por usuário e os segredos dos provedores permanecem no servidor. O formulário não abre cadastros de outros clientes nem compartilha tabelas de cache ou histórico administrativo. A fase337 cria somente essa RPC de autorização, com EXECUTE para authenticated e sem acesso anônimo ou grants em tabelas. A instalação não altera clientes, permissões de módulos, rotas, limites ou aprovações.

O cadastro continua sendo salvo pela RPC existente com carteira automática, limite zero e aprovação pendente. Preparação do pedido e revisão de rota/crédito preservam o fluxo anterior. Não foram criados clientes ou consultas externas reais para testar a entrega.

## Verificações

- Testes de autenticação, vínculo e permissão no servidor.
- `scripts/check-consulta-representante-337.mjs` simula HTTP em processo isolado: CNPJ e IE permitidos, papel/permissão/vínculo/rate limit negados antes dos provedores, CPF recusado e caminho administrativo preservado. Integra a suíte geral por teste de subprocesso.
- Testes do preenchimento limitado aos campos permitidos, preservação de entrada manual e descarte de documento divergente.
- Chromium com funções/auth simuladas e componentes reais, em computador e celular, incluindo StrictMode, preenchimento automático, escolha de IE, troca de CNPJ, resposta atrasada e cadastro final com payload limitado.
- Typecheck, build, suíte geral e guardas de servidor/cliente.

## Carteira do representante — fase338

A investigação do caso informado de Carlos Antonio Lucio encontrou um cliente corretamente vinculado nas duas tabelas, `pessoas` e `clientes`, ativo e explicitamente compartilhado entre lojas (`centro_id` vazio e `loja_pendente=false`). O dashboard o contabilizava, mas a política genérica de centro negava a listagem para usuários restritos a uma loja, apesar da carteira correta.

A fase338 corrige somente a leitura de clientes compartilhados da própria carteira, exigindo ao menos uma loja permitida. Em `pessoas`, exige também a função Cliente. Outras carteiras, clientes de lojas não autorizadas e cadastros explicitamente sem loja continuam protegidos. As demais políticas de usuário ativo, complemento cadastral, licença e carteira permanecem aplicadas.

A política de centro é separada por operação: SELECT admite o compartilhado da própria carteira; INSERT/UPDATE/DELETE conservam exatamente o predicado anterior de centro. Não muda a função global de acesso às lojas e não reatribui clientes, cria cadastros ou altera vínculos, limites, comissões ou financeiro. Os filtros da tela já incluem clientes compartilhados, portanto a correção é no banco, sem mascarar o contador.

`check-carteira-compartilhada-338.cjs` prova a diferença antes/depois, isolamento de outra carteira e loja, cadastros sem loja, registros sem função Cliente, usuário inativo e licença suspensa; verifica que escrita em compartilhados não foi ampliada, que os dados são preservados e que a reaplicação é segura. A auditoria de instalação `auditorias/consulta-carteira-representante-337-338.json` registra hashes e contagens e a leitura real sob o perfil de Carlos, sem conteúdo do cliente.
