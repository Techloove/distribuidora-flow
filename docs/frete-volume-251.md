# Frete por volume — grade por cidade (fase251)

Execute inteiro `db/fase251_frete_volume_grade.sql` após a fase250 e publique no Lovable. Não é necessário refazer as tarifas existentes, nem reaplicar a fase250. As permissões são as mesmas da configuração de frete da loja.

Em **Lojas → Configurações da loja → Frete por volume**:

1. Escolha **Produto**, **Grupo** ou **Categoria** em “Configurar por”.
2. Selecione o produto/grupo/categoria existente. Apenas o catálogo disponível da loja é apresentado. Grupos e categorias vêm dos produtos desse catálogo.
3. Confira os produtos marcados; todos do grupo/categoria começam selecionados, e você pode desmarcar exceções. Havendo unidades diferentes, filtre a unidade de venda ou selecione somente produtos com a mesma unidade.
4. Na lista de cidades/UF do cadastro de clientes, preencha o frete por unidade cidade por cidade. Cada valor será aplicado aos produtos selecionados. É possível filtrar cidades sem perder as alterações nas demais.
5. Clique em **Salvar alterações** para gravar todas as cidades editadas de uma vez. O botão mostra a quantidade de cidades e produtos envolvidos.

Uma tarifa comum já cadastrada aparece preenchida. Se houver valores diferentes, situações diferentes ou apenas alguns produtos configurados, a cidade aparece como **Tarifas diferentes ou parciais**, sem escolher um preço arbitrário. Só será substituída quando você editar essa linha. Tarifas de cidades/produtos não editados são mantidas. Zero é um valor válido; vazio não apaga tarifas. Para inativar, informe/mantenha o valor e desmarque “Ativa”.

O salvamento de um lote é atômico: se uma linha for recusada, nenhuma alteração daquele lote é gravada. O limite é de 5.000 combinações cidade × produto por chamada. Alterar o escopo de produtos com valores pendentes pede confirmação antes de descartá-los.

Esta é uma ferramenta para configurar **os produtos selecionados no momento**. Não cria uma regra permanente para futuros integrantes de um grupo/categoria. Produtos adicionados depois precisam ser incluídos em um novo lote. O cálculo nos pedidos continua usando as tarifas individuais da fase250; pedidos aprovados e estoque compartilhado permanecem preservados.

Validação: testes de tarifa comum/mista, integração SQL real com rollback, restrições de catálogo/unidade/permissão, migração reaplicável e teste de tela cobrindo produto, grupo, categoria, várias cidades, seleção parcial e manutenção dos preços não editados.
