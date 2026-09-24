# Auditoria de integração entre tabelas (venda -> estoque -> financeiro)

Objetivo: confirmar, com dados reais e testes controlados, que cada ação do sistema gera os efeitos esperados nas outras áreas, e corrigir somente o que estiver quebrado. Nenhum dado existente será apagado ou alterado.

## 1. Verificação estrutural (somente leitura)
- Listar tabelas, chaves estrangeiras, gatilhos e funções ativas no banco.
- Confirmar que as funções principais existem e estão na versão mais recente: confirmar pedido, separação, faturamento, notas, boletos, cargas, receber compra, baixas/estornos, comissões, devoluções.
- Checar permissões de acesso (RLS/grants) em todas as tabelas e visões usadas pelas telas.

## 2. Verificação de consistência dos dados existentes (somente leitura)
Consultas que apontam registros "órfãos" ou divergentes:
- Pedidos confirmados/faturados sem contas a receber, ou com soma das parcelas diferente do total do pedido.
- Pedidos confirmados sem movimento de saída de estoque; itens com quantidade baixada diferente da vendida.
- Estoque atual do produto diferente da soma dos movimentos.
- Compras recebidas sem entrada de estoque ou sem contas a pagar.
- Títulos pagos/recebidos sem movimento financeiro, ou saldo de conta bancária divergente dos movimentos.
- Pedidos sem comissão prevista quando há representante; comissões pagas sem conta a pagar.
- Notas/boletos/cargas ligados a pedidos em status incompatível.
- Devoluções sem retorno ao estoque ou sem ajuste financeiro.
- Registros sem centro de custo ou rota (afeta filtros por centro e relatórios).

## 3. Teste ponta a ponta controlado
Executar dentro de uma transação que é desfeita ao final (não deixa rastro):
- Compra -> marcar comprado -> receber NF: conferir estoque, custo médio, contas a pagar.
- Pedido -> confirmar -> separar -> faturar -> NF -> boleto -> carga: conferir estoque, contas a receber, comissão, histórico de status.
- Baixa de recebimento e pagamento, estorno: conferir movimentos, saldo e DRE/fluxo de caixa.
- Devolução e cancelamento: conferir reversões.
- Estoque negativo bloqueado/permitido conforme o produto.

## 4. Relatório e correções
- Entregar um relatório em linguagem simples: o que está funcionando, o que falhou e quantos registros são afetados.
- Para falhas encontradas: nova migração compatível (fase51) corrigindo a regra e, se necessário, reprocessando registros inconsistentes — sempre após sua confirmação antes de mexer em dados existentes.

## Detalhes técnicos
- Consultas via psql (leitura) e script SQL de teste com `begin ... rollback`, executado como usuário autenticado simulado (`set local request.jwt.claims`) para respeitar permissões.
- Checagem das telas principais (/pedidos, /compras, /receber, /pagar, /estoque, /dre, /fluxo-caixa) com navegador automatizado e logs de erro.
