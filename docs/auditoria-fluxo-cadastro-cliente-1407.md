# Revisão do cadastro do representante e aprovação administrativa — 1.40.7

Revisão de 05/11/2026 do cadastro simplificado, consultas CNPJ/IE, visibilidade na carteira, criação do rascunho, envio à aprovação, revisão administrativa, liberação e proteção da confirmação. Não foram criados clientes ou pedidos de teste no banco em uso.

## Correção encontrada

A criação do pedido verificava a pendência usando apenas o resultado já disponível em memória. Se a consulta ainda estivesse carregando ou desatualizada, o formulário podia exigir rota de um cliente recém-cadastrado. Agora, ao criar sem rota, aguarda a consulta atualizada e confere o vínculo pessoa/cliente. Erro de consulta pede nova tentativa; não libera venda nem dispensa rota para cliente já aprovado. As verificações do banco permanecem soberanas.

## Evidências

- `check-clientes-representante-database.cjs`: banco PostgreSQL isolado, sincronização real pessoa/cliente, carteira/lojas, cadastro sem acesso a rotas, limite zero, envio do pedido pendente, bloqueio de aprovação/confirmação, revisão de rota, liberação administrativa, ausência de confirmação automática e reexecução de migrações.
- `check-aprovacao-estoque-333.cjs`: estoque insuficiente permite envio à aprovação e bloqueia a aprovação pelo representante antes dos efeitos.
- Testes da revisão administrativa: salvamento bloqueado antes da liberação, falta de rota, falha de gravação/concorrência, erro de liberação e ausência de concessão a usuário sem admin.
- Testes da consulta cadastral: identidade do CNPJ, preenchimento sem substituir dados manuais e proteção dos campos comerciais.
- Consulta somente leitura no banco em uso: funções de criação, avanço, confirmação e liberação possuem as proteções das fases334/336. Triggers de crédito em pessoas/clientes e rota em pedidos estão habilitados. Na consulta havia zero cadastros pendentes; portanto o caminho pendente foi exercitado em banco isolado, não sobre registros reais.

## Condições necessárias para o representante

Conta ativa, vínculo com representante ativo, permissão de cadastrar clientes e loja permitida. Nome e CPF/CNPJ são obrigatórios; rota e limite não são exigidos na inclusão simplificada. Para criar o pedido, cliente da carteira, loja e forma de pagamento continuam necessários. O representante pode preparar, imprimir e enviar à análise com cadastro pendente. Aprovação cadastral e comercial continuam separadas; a liberação exige administrador, rota ativa e limite positivo.

A etapa administrativa salva os dados com o cliente ainda bloqueado e depois chama a liberação protegida. Se a liberação falhar, o cadastro permanece pendente e a tela informa que os dados foram salvos. A fase339 adiciona índice único do documento normalizado, sem alterar registros. A auditoria somente leitura encontrou zero grupos duplicados. Essa proteção fecha a possibilidade de duplicação com máscaras diferentes entre cadastros administrativos e de representantes. O índice preserva letras para documentos alfanuméricos e aceita documentos ausentes.

Fase339 aplicada no banco em uso e conferida por consulta somente leitura: índice normalizado presente e zero grupos duplicados. Testes focados: 14 passaram (33 verificações), além dos dois cenários de banco isolado de cadastro/aprovação e estoque. Guardas de segurança SQL e ordem de migrações passaram.
