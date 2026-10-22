# Forecast Fiscal — preparação da migração (fase261)

Esta fase prepara a mudança de fornecedor; **não implementa conexão nem emissão na Forecast Fiscal**. A documentação pública indicada é https://forecastfiscal.com.br/api/docs. As tentativas de leitura de `/api/docs` e `/api` no ambiente de desenvolvimento retornaram `CONNECT tunnel failed, response 403`. É necessário receber o OpenAPI/Swagger JSON/YAML ou manual para implementar o contrato correto, sem presumir endpoints ou autenticação.

## O que muda

- Em Lojas, a escolha do provedor passa a ser Forecast Fiscal (em preparação) ou emissão por API suspensa, com vínculo local ao CNPJ atual da loja. Apenas administrador com acesso à loja/configurações pode salvar. Mudanças do CNPJ invalidam o vínculo; a preferência nunca libera emissão automaticamente.
- Dados fiscais gerais, NCM, CEST, EAN, origem, CFOP e validação de UF/CEP são preservados como cadastro local. A compatibilidade final será revisada com o contrato da Forecast.
- Regras tributárias formatadas para a FAZNOTAS passam a histórico somente para leitura, sem serem convertidas ou aprovadas automaticamente para a Forecast.
- Novas reservas/envios e liberações FAZNOTAS são bloqueados no servidor e no banco. Os testes e a configuração de novas credenciais FAZNOTAS também ficam indisponíveis no servidor. O agendamento da fase260 é desativado; seu endpoint retorna 410 sem consultar o provedor, mesmo antes da aplicação do SQL261.
- Notas, chaves, protocolos, DANFE/XML e credenciais anteriores não são apagados. A consulta manual de recibos existentes continua disponível usando o fornecedor original. Uma preparação sem recibo não pode ser reenviada pela aplicação; confira o painel do provedor antes de iniciar outra emissão. Descartar preparação continua sujeito às regras seguras da fase259.
- O faturamento local e o registro manual de autorização de nota externa continuam seguindo as permissões existentes. Esses registros não significam envio à Forecast.

## Aplicação

1. Executar por inteiro `db/fase261_preparacao_forecast_fiscal.sql`, após a fase259. Não depende da existência da fase260; desativa-a quando presente. Reaplicável, sem exclusão de documentos ou tokens.
2. Publicar a versão no Lovable.
3. Em Lojas, conferir o CNPJ e salvar a preferência Forecast Fiscal para cada loja que usará a integração.
4. Enviar o manual/OpenAPI. Não cadastrar tokens Forecast nos campos FAZNOTAS nem enviar credenciais no chat.

A ordem do SQL e publicação não substitui o controle de operações já em andamento. Uma requisição de emissão que já tenha sido enviada antes da mudança deve ser conferida no provedor original e nunca repetida na nova API sem verificar sua situação.

## Próxima etapa, dependente da documentação

Conferir URLs e ambientes oficiais; autenticação da conta e escopo por empresa; identificação de CNPJ/empresa remota; certificado e séries; contratos de NF-e/NFC-e e impostos; referências/idempotência; consulta, webhooks e validação de assinatura; DANFE/XML; rejeição, cancelamento, carta de correção e inutilização. O painel com vários CNPJs será vinculado conforme o modelo real da API, sem replicar a credencial por loja por suposição.

A validação local usa banco PGlite e provedor simulado. Nenhum comando foi executado no banco do cliente e nenhuma nota real foi emitida na validação.
