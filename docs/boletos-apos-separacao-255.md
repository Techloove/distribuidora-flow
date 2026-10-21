# Boletos após separação conferida — fase255

Execute inteiro `db/fase255_boleto_apos_separacao.sql` no Supabase e publique no Lovable. Depois atualize a lista e tente emitir novamente as parcelas do pedido já liberado para carga. Não é necessário alterar o status manualmente nem montar uma carga apenas para emitir os boletos.

A trava antiga aceitava somente `faturado` e etapas posteriores, apesar de o fluxo simplificado oferecer emissão imediatamente após a conferência da separação (`conferido`, mostrado como **Pronto para carga**). A fase255 inclui essa etapa na liberação, preservando o corpo e as leituras dos parâmetros por loja da função existente.

A emissão continua exigindo a separação concluída e conferida, com registro de conferência e sem itens pendentes/divergentes. Permanecem as exigências fiscais configuradas na loja, as validações de título/saldo, os vínculos, as credenciais e as reservas contra boletos duplicados. Títulos manuais continuam usando a regra anterior. Nenhuma parcela, vencimento, estoque ou lançamento financeiro é alterado pela migração, e nenhum boleto é emitido automaticamente.

A janela agora consulta a liberação do pedido antes de habilitar a seleção para emissão, inclusive ao abrir uma parcela financeira vinculada a pedido. Se houver bloqueio, mostra o motivo e não anuncia a parcela como disponível para emissão. A reimpressão de boletos existentes continua independente dessa liberação. A validação no banco continua sendo a autoridade na reserva/emissão, mesmo que o estado mude depois da consulta da tela.

Se a mensagem seguinte exigir nota fiscal, confira **Lojas → Configurações da loja → Exigir nota fiscal para boleto**. A fase255 não muda essa opção. O fluxo atual sem emissão fiscal deve estar configurado sem essa exigência na loja responsável.

Validação: reprodução da recusa em pedido conferido; teste da guarda real de inserção de boletos após a correção; bloqueio antes da conferência, item divergente/não conferido e NF exigida por loja; isolamento por carteira/loja, papéis e acesso anônimo; fluxo completo de logística; teste de tela com emissão liberada/bloqueada e reimpressão preservada, sem chamada externa ao banco.
