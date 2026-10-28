# Clientes do representante, crédito e painel comercial — fase284

## Comportamento

- Em Cadastro Unificado, representantes com `clientes_cadastrar` usam **Cadastrar novo cliente**. O formulário não recebe limite, papel ou outro representante. Loja permitida, CPF/CNPJ e rota são obrigatórios. Rotas são as vinculadas explicitamente ou já atendidas pela carteira acessível, sem ampliar o acesso a clientes de terceiros da mesma rota.
- O cadastro entra na própria carteira, com limite zero, `credito_pendente=true` e status bloqueado. O gatilho real de sincronização mantém o registro correspondente em `clientes`.
- Apenas administrador ativo define o limite. A fila **Clientes aguardando liberação de limite**, em Cadastro Unificado, permite revisar o cadastro e confirmar um valor positivo com até duas casas decimais. Liberação, valor e responsável são auditados.
- O representante não pode aumentar limite, retirar pendência, desbloquear, transferir carteira, incluir papéis privilegiados ou excluir o cliente. A proteção existe no banco, inclusive em chamadas diretas e quando o representante acumula outros papéis sem ser administrador.
- Pedidos podem ficar em rascunho durante a análise. Aprovação e confirmação ficam bloqueadas até a liberação do cliente, inclusive em chamadas administrativas de aprovação de pedido. Isso evita que zero seja interpretado como crédito ilimitado.
- Clientes antigos conservam limite e situação. A atualização não solicita nova aprovação para a carteira existente.

## Painel

`Meu painel comercial` mantém metas e mostra 12 meses do ano selecionado, total anual, total do mês, clientes da carteira e limites pendentes, respeitando a loja selecionada. O cálculo exige simultaneamente o representante do pedido, a carteira atual do cliente e acesso à loja. Orçamentos, rascunhos e pedidos cancelados são excluídos; etapas posteriores à confirmação entram. A referência é a data do pedido, sem abatimento de devoluções: não é uma demonstração de receita fiscal líquida.

Os indicadores de reativação e atraso reutilizam **`agenda_clientes_228`** e as permissões atuais. Cliques abrem as abas correspondentes da Agenda Comercial, onde já existem filtros por rota/cidade, títulos, contatos e promessas. O intervalo inicial sem compras continua em 60 dias. Nenhuma mensagem é enviada automaticamente a clientes; os avisos são exibidos ao representante.

## Instalação e verificação

Aplicar `db/fase284_clientes_representante_credito_painel.sql` antes da nova interface. O arquivo é transacional e reaplicável. A concessão inicial da nova ação ocorre apenas ao criar o código de permissão; o acesso ao Dashboard é incluído uma única vez, com marcador de instalação na auditoria. Reaplicações preservam revogações posteriores. Nenhuma credencial nova é necessária.

`node scripts/check-clientes-representante-database.cjs` usa PGlite descartável, a sincronização real da fase198 e a carteira restritiva da fase206. Exercita criação direta e RPC, vínculo automático, loja/rota/cliente forjados, bloqueio do crédito e dos pedidos, aprovação exclusiva e repetida, representante com papel gestor, contas inativas/sem vínculo, valores inválidos, meses sem vendas, orçamentos/cancelamentos, outra carteira na mesma rota, outra loja e preservação de revogações.

A migração também foi pré-validada no projeto Supabase com ROLLBACK antes da instalação. Não foi criado cliente, aprovado limite ou confirmado pedido real para testar. A compilação Vercel, verificação de tipos, testes unitários e verificações de segurança complementam o teste de banco; não substituem homologação visual no dispositivo do usuário.
