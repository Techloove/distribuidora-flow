# Fase270 — estoque mais direto

Mudança de interface, sem migração SQL. Publicar o código após a sincronização com o Lovable.

A tela Estoque abre em **Movimentar**: escolha Entrada, Saída ou Ajuste, busque o produto pelo código ou nome e informe a quantidade. O saldo físico, reservado e disponível aparecem ao selecionar o produto. A loja do lançamento pode ser selecionada entre as lojas já permitidas; o saldo continua compartilhado. Custo de entrada e observação são opcionais e ficam recolhidos.

No ajuste, informe uma quantidade positiva e escolha Acrescentar ou Retirar. Retirar envia uma diferença negativa à mesma RPC existente. Não se trata de substituir o saldo físico pela quantidade digitada; contagens completas continuam em inventário. Saídas de pedidos já confirmados não devem ser relançadas manualmente.

**Consultar saldos** mostra os produtos com busca, filtro de reposição e atalho Movimentar. **Histórico** mantém os movimentos recentes, filtros e impressão. **Depósitos e inventário** separa Transferir produtos, Contar estoque e Organizar depósitos. Cadastro e endereço não aparecem durante uma transferência; paginação e contagens só aparecem no contexto de inventário. A busca aceita acentos ou sua ausência e permite localizar produtos além dos primeiros 50 resultados refinando o texto.

As funções existentes de movimentação, transferência e inventário permanecem responsáveis pela autorização e validação no banco. A interface mantém os mesmos papéis para movimentação e as permissões específicas de depósito/contagem/conferência. Não altera saldos na instalação, políticas RLS, carteira, histórico fiscal ou financeiro.

Ao trocar o depósito de origem, o formulário limpa destino/quantidade/contagens e renova a chave da transferência; ao concluir uma movimentação, mantém produto/tipo para facilitar novos lançamentos e limpa quantidade, custo e observação. Os campos ficam bloqueados durante o envio e os dados são atualizados após sucesso. Não há repetição automática de movimentações.

Validação: tipagem, lint dos arquivos alterados, build, testes do projeto, verificações de segurança e regressão local do estoque compartilhado. Nenhuma movimentação real foi executada.
