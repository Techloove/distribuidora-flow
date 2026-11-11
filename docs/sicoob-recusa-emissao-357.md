# Diagnóstico de emissão Sicoob recusada — versão 1.47.1

A primeira emissão real apresentada pelo usuário retornou HTTP 403 depois da autenticação OAuth. O emissor preservava o HTTP, mas descartava as mensagens reconhecidas do banco na apresentação. Não foi recuperado o corpo daquela resposta antiga; seu motivo exato continua sem confirmação. Não foram alteradas credenciais, permissões bancárias ou dados do título nesta entrega.

O cliente de produção agora extrai mensagens conhecidas (mensagens/mensagem, message, error_description e erros), reutiliza a sanitização bancária existente e remove token, senha, certificado e identificador do aplicativo antes de apresentar o motivo. O corpo bruto não é exposto. A emissão registra a nota sanitizada pelo RPC existente; respostas registradas não recebem uma segunda atualização redundante para estado incerto. O RPC existente já preserva estados terminais recusado/confirmado/encerrado.

A janela oferece Consultar tentativa no Sicoob (sem emitir) para erros e tentativas pendentes/em processamento. Chama somente a consulta existente: GET por nosso número ou recuperação por pagador e seu número persistido. Pode reconhecer e sincronizar um registro real que corresponda à identidade esperada, mas não executa novo POST de emissão e não baixa recebimento financeiro. A seleção de novas emissões é limpa durante essa consulta.

A configuração agora diz Autenticação testada: obter token não comprova liberação para incluir boletos. HTTP 403 pode exigir verificar com o banco a autorização do aplicativo Cobrança Bancária v3, certificado vinculado e operação. Não é possível afirmar a causa específica apenas pelo status.

Verificação: 18 testes unitários/regressões, 134 expectativas; certificado fictício, motivo sanitizado e ausência de repetição do POST. Chromium com tentativa fictícia confirma consulta e erro visível, zero chamadas aos emissores e layout no celular. Typecheck, lint, build e controles de versão/manual/datas aprovados. Nenhum boleto real foi emitido, reemitido, cancelado ou alterado durante a validação. Não há nova migração SQL.

## Atualização 1.47.2 — consulta sem conteúdo

A consulta apresentada depois retornou HTTP 204. Esse status significa processamento sem conteúdo, sem provar existência/inexistência do registro ou autorização para inclusão. O retorno agora é SEM_RESULTADO, com condições nulas e pendência local preservada; aparece como informação, não como erro bancário sem motivo. Nenhuma sincronização de título, confirmação de emissão ou nova chamada POST ocorre a partir desse retorno. Recuperações de emissão não contam o retorno vazio como boleto emitido.

A coleção oficial descreve dataInicio/dataFim da lista por pagador como vencimento inicial/final; a busca já utilizava esses campos corretamente. A query agora também inclui numeroCpfCnpj, além do documento no caminho, conforme os parâmetros da coleção. A recusa POST HTTP 403 continua sem causa específica comprovada.

19 testes aprovados (142 expectativas) e Chromium validando mensagem informativa, ausência de confirmação/impressão e zero chamadas aos emissores. Sem nova migração SQL e sem requisição bancária real durante os testes.

## Atualização 1.47.3 — período ampliado

A recuperação por pagador consulta agora vencimentos de 30 dias antes até 30 dias depois do vencimento original persistido na tentativa. Não aplica filtro de situação. Mantém a correspondência exata de seuNumero, beneficiário e modalidade, seguida das demais validações de identidade. Não altera título, credenciais nem reenvia emissão. O HTTP 403 anterior não é resolvido por ampliar a consulta. Sem nova migração SQL.

## Atualização 1.47.4 — consulta direta na listagem

O atalho Consultar boleto na listagem usava o componente de emissão da parcela. A listagem agora oferece Consultar boleto no Sicoob, que chama diretamente a consulta autenticada existente e apresenta o resultado ou erro. Tentativas Sicoob com erro, pendentes ou em processamento não mostram o atalho de emissão nessa listagem. As demais rotinas de emissão permanecem com suas proteções existentes. A mensagem genérica de falha de transporte não sugere certificado inválido: não há evidência para esse diagnóstico.

Chromium com sessão e retorno fictícios verificou uma consulta, zero emissões e zero diálogos abertos; nenhuma requisição ao banco real. Typecheck, lint e build aprovados. Sem SQL novo. O erro real de conexão ainda precisa de diagnóstico no servidor.
