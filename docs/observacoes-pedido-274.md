# Nome fantasia e observações dos pedidos — fase274 / versão 1.2.0

Execute manualmente no Supabase somente o arquivo `db/fase274_observacoes_pedido.sql` inteiro. Este documento é um guia, não SQL. Depois publique a atualização no Lovable.

Na impressão, os dados do cliente incluem razão social e nome fantasia; o cabeçalho continua mostrando a identidade da loja. Pedidos, orçamentos, separação e expedição usam o mesmo modelo de impressão.

No final do pedido em rascunho/digitação, escreva em **Observações do pedido** e clique **Salvar observações** antes de imprimir. O texto tem até 4000 caracteres e mantém as quebras de linha no documento. Observações preenchidas na criação continuam disponíveis; é possível apagar o conteúdo e salvar.

A edição respeita usuário ativo, operação liberada, rotina de pedidos, loja e carteira do representante. Propostas precisam estar válidas e em negociação. Documentos que já avançaram no fluxo ficam somente para leitura. Não modifica status, estoque, parcelas ou dados fiscais. A alteração é auditada e conflitos entre edições simultâneas são rejeitados.
