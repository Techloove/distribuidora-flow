# Cotação de intermediação no orçamento — fase297 / versão1.21.1

Corrige a localização e o momento da precificação: Configurações da loja contém somente o parâmetro para habilitar/desabilitar. O orçamento oferece a modalidade Intermediação, abre automaticamente o bloco de cotação da fábrica e permite informar frete/margem dos itens na própria proposta. Pedidos diretos continuam compatíveis. A data da cotação exibida é vinculada à data base do documento.

O aceite do orçamento atualiza a data comercial do pedido, como no fluxo anterior, mas conserva a data original da proposta (`orcamento_data`) como referência do custo. A validação da cotação usa essa data quando presente. O trigger permite a mudança da data comercial durante a conversão válida, mantendo as proteções contra alteração da loja/data base com itens existentes. Não recalcula custos nem preços por uma cotação de outro dia.

Orçamentos recusados ou vencidos permanecem protegidos pelo motor236, e seus itens são exibidos sem controles de edição. Não há estoque, financeiro, comissão ou expedição na fase de proposta. Conversão e aprovação interna permanecem separadas da confirmação efetiva. As parcelas e a prova logística da intermediação surgem somente na confirmação.

Cadastrar cotação é permitido a quem já pode precificar pedidos, além da gestão com permissão de configuração. Habilitar a função na loja continua exigindo a permissão de configuração existente. Loja, carteira, perfil ativo, cotação versionada e imutabilidade dos itens confirmados são preservados. A fase297 altera somente funções, sem atualizar registros de negócio.

Validação: regressão com orçamento de um dia anterior, edição/cotação sem efeitos operacionais, aceite no dia atual mantendo custos/preço, aprovação sem reserva e confirmação com financeiro integral e sem estoque. Interface verificada em1366px e390px, incluindo ausência do formulário de cotações em Lojas. Os dados de navegador e de banco local são fictícios.
