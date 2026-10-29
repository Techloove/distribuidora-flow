# Emitir e reimprimir boletos por pedido/parcela

A mesma janela de boletos está disponível:

- no detalhe do **Pedido**, após gerar o financeiro na confirmação da venda;
- na lista de **Separação**, em cada pedido, inclusive após a conferência;
- em **Contas a receber**, em cada parcela, inclusive parcelas pagas quando exibidas pelo filtro;
- em **Boletos**, nas ações do registro: abre o pedido completo quando há vínculo, ou somente a parcela para títulos manuais.

Use **Boletos do pedido**. No financeiro, use **Emitir boleto** ou **Reimprimir boleto**, conforme o ciclo atual. A aba **Emitir pendentes** consulta as parcelas financeiras e a elegibilidade da view existente; não oferece nova emissão para um boleto ativo. **Reimprimir emitidos** abre a seleção dos ciclos API registrados/liquidados com linha digitável disponível. Escolha parcela, mesmo pedido ou mesmo cliente, selecione um ou vários boletos, ou todos do grupo, e abra o PDF. A seleção respeita o filtro de loja e não mistura clientes. O download e a impressão usam um único arquivo com as páginas originais fornecidas pelo banco, na ordem de vencimento e identificação.

A reimpressão somente consulta o PDF: não registra outra cobrança, não baixa o título e não movimenta estoque ou caixa. Ciclos cancelados, baixados ou ainda em processamento não são tratados como cobranças atuais imprimíveis. CNAB legado continua em seu acompanhamento de arquivos/retornos; não se utiliza o endpoint API para imprimi-lo.

Em caso de falha parcial na emissão, a janela informa quantos boletos já foram emitidos e atualiza as parcelas. Reimprimir continua disponível mesmo se novas emissões estiverem desativadas no centro, desde que o convênio/ambiente atual corresponda ao boleto. Falhas de obtenção de PDFs não criam registros bancários novos. A emissão mantém o limite de 10 registros novos por operação. A impressão de mais de 20 PDFs aguarda 61 segundos entre lotes para respeitar o limite por minuto; pode ser interrompida entre consultas. Uma recusa explícita de limite aguarda e repete a consulta uma vez; outras falhas interrompem sem apresentar um arquivo parcial como completo.

No ambiente de homologação, a prévia informa que o Sicredi pode retornar arquivos MOCK com dados fictícios, sem uso para cobrança real. A junção preserva as páginas bancárias; não inventa um boleto para corresponder ao título do ERP.

## Acesso e implantação

As permissões financeiras existentes são preservadas: administrador, gestor ou financeiro, com acesso ao centro e aos documentos pelas políticas RLS. O botão na Separação não concede poderes financeiros a um separador nem altera acesso de representantes. Toda leitura é limitada ao pedido/parcela e utiliza a sessão do usuário; emissão e PDF continuam autenticados/limitados no servidor.

Não exige nova migração SQL. Publicar o código conectado no Lovable e recarregar. Requer a configuração por centro da fase237 já aplicada. A biblioteca `pdf-lib`1.17.1 é carregada apenas quando prepara o arquivo de impressão, com versão e lockfile registrados.

## Verificação

Os testes de `boletos-documento.test.ts` exercitam a escolha do ciclo atual, exclusão de outro título, recusa de estados não imprimíveis, saldo com encargos e pagamento parcial, e união real de PDFs com preservação da quantidade/ordem das páginas. Os testes bancários existentes continuam verificando autenticação, isolamento por centro, idempotência e recusa de requisições inválidas.

A conferência no Chromium usa Supabase e respostas bancárias simuladas: seleção individual/todas na Separação conferida, download de1 e2 páginas, aviso de homologação, apresentação no celular, acesso em Pedidos e reimpressão de parcela paga no Financeiro. Não implica emissão nem homologação com o banco real.
