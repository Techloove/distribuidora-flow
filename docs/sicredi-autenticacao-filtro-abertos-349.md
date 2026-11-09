# Autenticação do agendamento e filtro de abertos — fase349 / versão1.43.6

Após corrigir o destino antigo na fase 348, o ciclo natural recebeu HTTP 401 no domínio atual. O servidor retornava corpo vazio; a credencial armazenada foi conferida apenas por comprimento/formato (64 caracteres hexadecimais), sem exposição do valor. O transporte da automação passa a usar `X-Sicredi-Automacao`, evitando interpretação da credencial como JWT/login pelo transporte intermediário. Os endpoints de consulta e tarifas validam exatamente o formato e continuam exigindo correspondência com o segredo privado e execução de RPCs exclusivas do servidor. O transporte Bearer anterior segue compatível nos handlers.

A fase349 altera somente os dois disparadores do agendamento. Não altera o segredo, o destino verificado, a fila ou o financeiro. Os jobs existentes continuam sendo os responsáveis pelas chamadas; não houve disparo manual com credencial extraída.

O menu Boletos e a ação Limpar iniciam no filtro Registrado (em aberto), incluindo os registrados já vencidos. Os cartões continuam exibindo totais de abertos, pagos e vencidos; clique ou filtro permite consultar as outras situações. Atalhos com boleto/título/pedido/cliente preservam seu contexto e podem mostrar um registro já pago. A migração não altera estados para satisfazer o filtro.

Validação: 335 testes, 2.113 verificações, TypeScript, lint, build e controles SQL/manual/datas/versão. Os testes de endpoint exercitam cabeçalho próprio, compatibilidade Bearer e cache de token com resposta vazia; o teste PostgreSQL reaplica fases 348/349, confere transporte privado, escopo de serviço, segredo preservado, rotação de todos os vencimentos e financeiro idempotente. O teste de filtro verifica abertos vencidos, liquidados acessíveis por contexto e troca explícita de situação.

A auditoria `auditorias/sicredi-autenticacao-agendamento-349.json` comprova preservação da configuração e do financeiro e a alteração dos disparadores privados. A execução efetiva é confirmada pela versão/horário registrados no status do serviço, não apenas pelo deploy da interface.

Validação operacional concluída no ciclo natural de 09/11/2026 às 17h20 de Brasília: executor 1.43.6 confirmado; boleto 600000597 liquidado automaticamente por R$ 1.624,86, com data bancária 04/11/2026 e um único recebimento ativo. Nenhuma consulta individual foi disparada pelo agente. A evidência foi acrescentada à auditoria da fase 348.
