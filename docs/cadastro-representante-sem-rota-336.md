# Cadastro do representante sem exigência de rota — fase336

O cadastro exigia uma rota e desabilitava o envio quando o representante não tinha opções. O formulário passa a pedir nome, CPF/CNPJ e uma loja permitida; preenche a loja automaticamente quando houver apenas uma opção. Contato, endereço e demais dados conhecidos continuam opcionais. Rota e código IBGE saem do formulário, que não consulta nem depende do módulo de rotas. A carteira continua vinculada automaticamente, com cadastro bloqueado, limite zero e aprovação administrativa pendente.

A proteção do banco aceita rota vazia na inclusão do cliente, mantendo as demais verificações. Rotas explícitas em clientes antigos da aplicação continuam limitadas à carteira. A atribuição automática por cidade não escolhe a rota de um cadastro pendente sem rota; clientes já liberados conservam o comportamento anterior. Não há concessão de permissões de rota.

Para manter o fluxo de cadastro e pedido, a criação do rascunho permite rota vazia somente quando o cliente ainda está pendente. Carteira, loja, forma de pagamento e demais regras são preservadas. A criação bloqueia a linha do cliente para coordenar revisão concorrente. O representante pode preparar e imprimir o pedido e enviá-lo à análise; não aprova nem confirma o cliente pendente.

Em Cadastro Unificado, o administrador define uma rota ativa antes de liberar o cadastro e limite. A liberação atribui essa rota somente aos pedidos da mesma loja ainda em digitação ou aguardando aprovação que estejam sem rota. Não substitui uma rota própria e não altera aprovados, confirmados ou históricos. Não confirma o pedido automaticamente. Um trigger impede aprovar ou confirmar uma venda sem rota ativa, inclusive por chamada direta às rotinas existentes.

A migração altera funções e instala a proteção, sem modificar registros de pessoas, clientes, pedidos, rotas, estoque, financeiro, comissões ou permissões. A auditoria da instalação contém somente hashes e contagens em `auditorias/cadastro-representante-sem-rota-336.json`.

## Verificações

O script `scripts/check-clientes-representante-database.cjs` mantém os testes anteriores e acrescenta cadastro por um representante sem vínculos de rota e com SELECT e consulta de rotas negados. Usa sincronização real de pessoa/cliente e regras de carteira e loja. Testa cadastro sem rota mesmo com regra automática por cidade, rejeição de rota alheia, pedido pendente sem rota, crédito bloqueado, revisão administrativa exigida, propagação da rota somente na liberação, status ainda aguardando aprovação e impossibilidade de venda sem rota após a liberação. Verifica rollback dos efeitos da confirmação recusada e instalação repetida.

A tela foi verificada com autenticação e dados simulados em Chromium, sem criar clientes reais, usando os componentes publicados. O teste confere nome, CPF/CNPJ, loja automática, ausência de rota e IBGE e payload de cadastro sem rota em computador e celular. Typecheck, build, testes gerais, lint dos componentes e guardas de SQL/cliente completam a validação.
