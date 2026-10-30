# Intermediação por loja — fase296 / versão1.21.0

A venda do estoque continua sendo o padrão. O parâmetro `intermediacao_habilitada` nasce falso globalmente e nas novas lojas; a implantação habilita apenas a loja ativa chamada Cimento. A reaplicação não sobrescreve a escolha salva. Não há conversão de pedidos existentes.

## Preço, custo e histórico

A cotação é versionada por loja, produto e data, com usuário e data de gravação. A edição cria revisão; repetir o mesmo custo é idempotente. Não altera produtos, custo médio, preço de venda ou estoque. O item registra o identificador da cotação, fábrica, frete e margem por saca. A data do pedido precisa ter cotação própria. Nova cotação nunca recalcula itens anteriores. Reaplicar uma revisão é ação explícita e permitida somente na digitação. Não é permitido mudar data, loja ou modalidade com itens já lançados.

Preço unitário = fábrica + frete + margem; custo unitário base = fábrica + frete. A quantidade é inteira em sacas. Valores unitários preservam quatro casas; totais monetários têm duas casas. A margem dos itens é apresentada separada do resultado após descontos, encargos, comissões, tributos e despesas. Frete por volume fica dispensado para não cobrar novamente o frete dos itens. O frete manual permanece ajuste separado. Custos extras de transporte devem excluir o frete por saca já contabilizado.

## Confirmação, estoque e financeiro

A cobrança é integral, usando o motor atual de parcelas, crédito e comissão. Uma confirmação privada por pedido/ciclo substitui a saída de estoque como prova logística. Acesso de loja/carteira e regras de crédito, margem, aprovação, carga, documento fiscal e entrega permanecem vigentes. Não há movimentação bancária ao criar a cotação ou cadastrar o pedido.

A aprovação não reserva estoque e a confirmação não gera saída. Uma barreira de trigger impede movimentações e reservas físicas associadas à intermediação por caminhos alternativos. O cancelamento reverte somente saídas reais; devoluções da modalidade não criam entradas no estoque da loja. A devolução parcial mantém o ajuste proporcional e os vínculos dos boletos/títulos. O índice de unicidade do financeiro conserva uma parcela original por pedido/ciclo e distingue os títulos substitutos de devolução, permitindo manter o original cancelado e o saldo restante no histórico.

Planejamento294 e reposição legada excluem intermediação do consumo e pendências de estoque físico. A margem usa o custo capturado; o CPV da DRE usa fábrica+frete do item da modalidade, sem recalcular pelo custo médio. A impressão compartilhada identifica intermediação e mantém custos e margem internos. A fila de separação identifica a entrega direta da fábrica.

Cotações/custos previstos não criam contas a pagar à fábrica ou ao transportador: não foram especificados fornecedor, transportador ou condições de pagamento desses fornecedores. Essa rotina permanece separada da cobrança integral ao cliente.

## Segurança e validação

Novas gravações passam por RPC com usuário ativo, loja/carteira e permissões existentes; cotação exige gestão/configuração, e a precificação exige permissão para alterar preços. Tabelas de cotações e provas de confirmação têm RLS e somente SELECT para authenticated. Triggers auxiliares não são RPCs executáveis. Motores existentes recebem alterações pontuais verificadas, preservando assinaturas/OIDs/ACL; incompatibilidade aborta a implantação inteira.

Regressões descartáveis verificam revisões, custo congelado, cotação errada/antiga, quantidade inteira, snapshots, prova logística, parcelas integrais idempotentes, aprovação sem reserva, conferência, cancelamento, devolução proporcional sem estoque e venda normal com reserva/baixa. Verificam também opção por loja, desabilitação, permissões, anonimato e impossibilidade de apagar cotações pela API. Navegador local usa fornecedores de dados fictícios; nenhuma emissão, cobrança, baixa bancária ou pedido real é executado nos testes.
