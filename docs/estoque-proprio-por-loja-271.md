# Fase271 — estoque próprio e depósito automático por loja

A regra passa a ser **cada loja vende e movimenta somente seu próprio estoque**. A proposta de Depósito geral foi descartada antes de qualquer aplicação. Não é necessário preencher uma divisão manual: a propriedade segue a categoria já cadastrada nos produtos e vinculada à loja na fase246.

## Aplicação

No editor SQL do Supabase, execute somente o conteúdo de `db/fase271_estoque_proprio_por_loja.sql`. Este guia Markdown não é SQL. Aplique o arquivo inteiro e publique o código atualizado no Lovable. Faça a migração em uma janela sem operação: as tabelas de estoque ficam bloqueadas durante a conferência e redistribuição.

Em **Lojas**, cada loja ativa deve ter a categoria correta configurada (ex.: Ferragens e Cimento). Nos produtos, a categoria deve corresponder ao cadastro selecionado para a loja. A migração usa os IDs das lojas/categorias e a normalização já existente; não adivinha pelos nomes das lojas. Uma categoria pertence a uma única loja ativa. Renomear a loja posteriormente preserva os vínculos.

Se um produto com saldo ou reserva não tiver vínculo único, se uma reserva estiver na loja errada ou se os depósitos divergirem do saldo físico, a migração é interrompida e revertida integralmente. Confira as categorias e as reservas indicadas, sem somar estoque nem alterar pedidos antigos para forçar a migração. Produtos zerados ainda sem categoria ficam indisponíveis para movimentação até terem um vínculo válido.

## O que acontece com os saldos

A migração confere o saldo total de cada produto e o redistribui para o depósito **Principal da loja correspondente à categoria**, inclusive o saldo antes mantido em “Estoque compartilhado”. Ela não soma o saldo global aos depósitos: conserva o total que já existe.

Mantém os IDs e nomes das lojas, produtos, pedidos, carteiras, notas, recebíveis, comissões e reservas. Salva um retrato privado das posições anteriores e registra movimentos internos de redistribuição e auditoria. Não gera compra, venda, nova baixa física, cobrança ou nota fiscal. Os depósitos antigos ficam arquivados, com os registros históricos preservados. Posições antigas zeradas podem permanecer para histórico, mas não entram na contagem de produtos de outra loja.

Inventários ainda em contagem são cancelados com auditoria, preservando os itens informados. Sua base antiga deixa de representar a nova distribuição; abra uma nova contagem no depósito da loja após aplicar a fase271. Inventários já conferidos permanecem no histórico.

## Funcionamento

Selecionar a loja seleciona automaticamente seu depósito principal. Os produtos e saldos da tela Estoque seguem a loja selecionada. Trocar de loja limpa o produto e os dados de um lançamento ainda não enviado. Não há escolha manual de outro depósito, criação de depósitos extras ou transferência entre lojas nessa tela.

Entradas, saídas, confirmação de pedidos, reservas e inventários usam a posição da própria loja. Uma movimentação de produto de categoria pertencente a outra loja é rejeitada, inclusive por chamada direta à RPC. Reservas de uma loja não consomem a disponibilidade de outra. A opção já existente de permitir saldo negativo continua sendo uma política explícita por produto; ela não autoriza utilizar o depósito de outra loja.

Permissões de loja, usuário ativo e carteira permanecem aplicadas. As funções de inventário agora conferem o acesso à loja correspondente também no servidor. O catálogo segue a categoria da loja; consultas de disponibilidade e planejamento de compras retornam posições por loja. Alertas do dashboard seguem a loja e o acesso selecionados. O saldo agregado de produtos permanece para compatibilidade e representa o total por produto, sem criar estoque adicional.

Para preservar a propriedade de mercadoria com saldo ou reservas, o sistema bloqueia a reclassificação da categoria do produto, a troca da categoria da loja e a reclassificação do nome normalizado da categoria. Essa reorganização exige um procedimento próprio de conciliação, não uma edição do cadastro. Alterar somente o nome da loja continua permitido.

Novas lojas recebem automaticamente o depósito Principal. Configure uma categoria exclusiva antes de cadastrar/movimentar produtos nela. A transferência interlojas fica bloqueada pela rotina antiga; uma futura operação desse tipo precisará tratar também a categoria/propriedade e seus registros comerciais.

## Validação

Regressão local com duas lojas: falha atômica por categoria ambígua e reserva na loja incorreta; redistribuição sem alterar total/pedidos/financeiro/comissões/reservas; reaplicação; entrada e saída na loja correta; rejeição de movimentação da outra loja; reserva; confirmação real do motor de vendas sem duplicar baixa; inventário local idempotente; renomeação da loja preservando saldo; negação de acesso ao inventário da outra loja e sigilo do retrato anterior.

Os testes usam banco local e dados sintéticos. Nenhum pedido, saldo ou documento fiscal real foi alterado automaticamente. As migrações de produção são executadas manualmente pelo responsável no Supabase.
