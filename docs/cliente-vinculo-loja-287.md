# Vínculo explícito de loja do cliente — fase287

`pessoas.loja_pendente` distingue o cadastro Sem loja do compartilhado. `clientes.loja_pendente` acompanha o espelho do Cadastro unificado. O valor padrão falso preserva os registros antigos: centro preenchido continua específico, centro vazio continua compartilhado.

A migração acrescenta campos, restrições e gatilhos; não recategoriza ou atualiza linhas existentes. Cliente Sem loja deve ter centro vazio. Alterações no novo campo exigem usuário ativo com gestão do cadastro. Clientes vinculados a pessoas recebem o campo do cadastro principal e não podem divergir por edição direta. A criação do representante continua exigindo loja específica e crédito pendente pela fase284.

O gatilho de pedidos bloqueia nova venda ou troca de cliente/loja e aprovação/confirmação inicial quando o cliente estiver Sem loja. Não impede entrega ou cancelamento de pedidos avançados, nem altera títulos, boletos ou estoque. Orçamentos continuam disponíveis para preparação.

Testes PGlite executam o espelho real da fase198 com a correção da fase200, a fase284 e a nova migração reaplicada. Conferem preservação dos compartilhados, ida/volta entre os três estados, espelho, estados incoerentes, alteração direta, permissões, bloqueio de venda nova e continuidade do histórico. A instalação no Supabase foi validada primeiro com rollback; a execução verificou as assinaturas dos dados existentes em pessoas, clientes, pedidos, contas a receber/pagar e boletos, sem alteração.

No navegador, dados fictícios conferiram filtro e contador Sem loja, distinção dos compartilhados e específicos, escolha em Dados gerais e payloads de gravação (booleano e centro) sem persistir campos de filtro.
