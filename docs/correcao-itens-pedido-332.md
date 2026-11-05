# Itens visíveis e aviso de estoque — versão 1.37.1

O pedido 94 tinha um item gravado e total calculado, mas o representante não o enxergava. A política restritiva de loja consultava `pedido_itens.centro_id`, vazio nos itens desse fluxo, em vez da loja do pedido. A fase332 passa a exigir o pedido pai visível e sua loja autorizada; um centro explícito incompatível no item continua oculto. As regras de carteira, usuário ativo, assinatura e negação de escrita direta são preservadas. Não há backfill ou regravação de itens.

O aviso por item usa uma consulta somente leitura, autorizada por loja e carteira. Compara a soma de quantidades do produto no pedido ao saldo da própria loja, descontando reservas de outros pedidos e sem descontar a reserva do próprio pedido novamente. Quantidade disponível negativa aparece como zero disponível. Itens inconsistentes de outra loja ficam fora da consulta. Não retorna custo ou margem e não gera alertas para Intermediação, orçamento ou vendas já confirmadas/entregues.

O texto segue o status real: em digitação, informa item mantido para análise comercial; em aguardando aprovação, informa Aguardando aprovação comercial; em aprovado, reconhece a aprovação já registrada. O aviso não altera status nem transforma falta de estoque em bloqueio obrigatório quando o cadastro permite estoque negativo. Validação e confirmação continuam no servidor com as regras existentes.

Falha de consulta não é apresentada como pedido vazio. Se houver total de itens positivo sem linhas retornadas, a tela informa a inconsistência e orienta atualizar em vez de inserir o mesmo item novamente.

Validação em produção: pedido 94 visível para o representante, itens visíveis de zero para um; quantidade 20, disponível zero e alerta verdadeiro. Contagens/hashes de pedidos, itens, contas a receber, comissões, boletos, saldos, reservas e movimentos ficaram iguais. Evidência em `docs/auditorias/pedido-94-visibilidade-332.json`.

Testes: 303 testes unitários aprovados, `check-itens-estoque-332.cjs` em PGlite, typecheck, build, verificações de SQL/superfície do cliente/servidor, versão e manual. A regressão de banco cobre acesso por pai, isolamento de loja/carteira, centro explícito incompatível, preservação de registros, escrita direta negada, soma de linhas e reservas e ausência de alerta em modalidades/status fora do escopo.
