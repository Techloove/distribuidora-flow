# Conta Corrente Sicoob — conferência de extrato, fase 352

Disponível após instalar a migração 352 e publicar a versão 1.45.0, em Lojas → Sicoob → Produção, junto às condições de emissão.

## Configuração

O aplicativo de Conta Corrente tem Client ID próprio. Informe a conta com dígito e sem pontuação e envie o A1 autorizado para esse aplicativo, com sua senha. Se o mesmo A1 for autorizado pelo banco nos dois aplicativos, o arquivo pode ser o mesmo; esta configuração mantém sua própria credencial no Vault. Salvar o aplicativo de extrato não altera o aplicativo de cobrança, seu certificado, condições, ativação ou versão.

O arquivo e a senha não retornam ao navegador. Salvar outros campos sem enviar arquivo mantém o certificado guardado. Não há Secret ID, token manual ou endereço editável.

## Consulta

A integração solicita apenas `cco_consulta openid`, usando client_credentials e mTLS. O único recurso de Conta Corrente exposto por este cliente é GET /extrato/{mes}/{ano}, com numeroContaCorrente obrigatório e agruparCNAB=false. Não implementa transferências.

A consulta é manual: mês atual ou três meses anteriores, dias válidos e sem datas futuras. Reserva transacional global e por loja limita novas consultas a um intervalo de quinze segundos. As respostas e os arquivos A1 têm limites de tamanho. Falhas de autenticação não expõem a resposta crua do banco.

A tabela apresenta data, tipo, descrição/complemento, documento/identificador e valor. transactionId é opcional e não é inventado quando ausente. Valores sem formato reconhecido são sinalizados; CPF/CNPJ e saldos não são retornados para essa tabela. O filtro de possíveis tarifas verifica apenas palavras da descrição; não confirma vínculo, tipo de débito ou despesa. Não há conciliação automática, recebimento, despesa, cancelamento ou alteração de boleto. Respostas de extrato ficam apenas no estado da página, não no banco financeiro. A auditoria registra a solicitação, sem o conteúdo do extrato.

## Segurança e verificação

Apenas administrador ativo, autorizado para a configuração bancária e com acesso à loja pode salvar e consultar. A tabela não concede SELECT ao navegador. RPCs são exclusivos de service_role e revalidam o ator. Gravações usam controle de versão e certificado em Vault separado.

Validação: 18 testes unitários Sicoob (143 expectativas); fixture PostgreSQL com permissões, migração repetível, certificado preservado, controle de versão, intervalo e comprovação de preservação dos boletos, títulos e configuração da cobrança. Chromium: campos na mesma seção, Client IDs independentes, salvar extrato sem acionar gravação da cobrança, consulta, filtro, moeda brasileira e celular sem overflow horizontal. Typecheck, lint, build e verificações de versão, manual, datas e SQL aprovados.

## Implantação

Aplicar db/fase352_sicoob_extrato_leitura.sql antes da publicação. O acesso de gerenciamento Supabase disponível nesta sessão retornou HTTP 401 ao teste de leitura. O usuário confirmou a aplicação manual da migração com sucesso em 11/11/2026; não houve verificação independente pelo acesso indisponível. Nenhuma consulta de extrato real foi executada. Após a instalação e publicação, o administrador deverá configurar o aplicativo e confirmar a primeira resposta real usando Consultar extrato / testar conexão. A importação e contabilização automática das tarifas continua pendente da validação dos retornos reais e do vínculo sem duplicidades.
