# Diagnóstico de emissão Sicoob recusada — versão 1.47.1

A primeira emissão real apresentada pelo usuário retornou HTTP 403 depois da autenticação OAuth. O emissor preservava o HTTP, mas descartava as mensagens reconhecidas do banco na apresentação. Não foi recuperado o corpo daquela resposta antiga; seu motivo exato continua sem confirmação. Não foram alteradas credenciais, permissões bancárias ou dados do título nesta entrega.

O cliente de produção agora extrai mensagens conhecidas (mensagens/mensagem, message, error_description e erros), reutiliza a sanitização bancária existente e remove token, senha, certificado e identificador do aplicativo antes de apresentar o motivo. O corpo bruto não é exposto. A emissão registra a nota sanitizada pelo RPC existente; respostas registradas não recebem uma segunda atualização redundante para estado incerto. O RPC existente já preserva estados terminais recusado/confirmado/encerrado.

A janela oferece Consultar tentativa no Sicoob (sem emitir) para erros e tentativas pendentes/em processamento. Chama somente a consulta existente: GET por nosso número ou recuperação por pagador e seu número persistido. Pode reconhecer e sincronizar um registro real que corresponda à identidade esperada, mas não executa novo POST de emissão e não baixa recebimento financeiro. A seleção de novas emissões é limpa durante essa consulta.

A configuração agora diz Autenticação testada: obter token não comprova liberação para incluir boletos. HTTP 403 pode exigir verificar com o banco a autorização do aplicativo Cobrança Bancária v3, certificado vinculado e operação. Não é possível afirmar a causa específica apenas pelo status.

Verificação: 18 testes unitários/regressões, 134 expectativas; certificado fictício, motivo sanitizado e ausência de repetição do POST. Chromium com tentativa fictícia confirma consulta e erro visível, zero chamadas aos emissores e layout no celular. Typecheck, lint, build e controles de versão/manual/datas aprovados. Nenhum boleto real foi emitido, reemitido, cancelado ou alterado durante a validação. Não há nova migração SQL.
