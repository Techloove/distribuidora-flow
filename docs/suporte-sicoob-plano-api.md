# Texto para o suporte Sicoob — associação de aplicativo à API

Assunto: HTTP 403 intermitente — “Forbidden : Not registered to plan” na Cobrança Bancária v3

O aplicativo de Cobrança Bancária consta ativo no Portal Developers e a API aparece associada. Na integração em produção, algumas operações funcionam e outras retornam “Forbidden : Not registered to plan”. Já foi possível registrar um boleto, solicitar movimentação de liquidação, obter a lista de arquivos e realizar download; consultas individuais também alternaram sucesso e essa recusa.

Solicitamos verificar o vínculo do Client ID com o plano da API Cobrança Bancária v3 no gateway de produção, a publicação/propagação dessa associação e as permissões das rotas. Em especial:

- GET https://api.sicoob.com.br/cobranca-bancaria/v3/boletos
- POST/GET https://api.sicoob.com.br/cobranca-bancaria/v3/boletos/movimentacoes
- GET https://api.sicoob.com.br/cobranca-bancaria/v3/boletos/movimentacoes/download

Client ID do aplicativo de Cobrança: [preencher com o do portal; é diferente do aplicativo Conta Corrente]
Cooperativa / conta / beneficiário: [preencher]
Data e horário da recusa, em Brasília: [preencher]
Identificador de rastreamento retornado pelo banco, se disponível: [preencher]
Código da solicitação e ID do arquivo, se a recusa for no download: [preencher]

Não estamos solicitando nova emissão de boleto. Precisamos estabilizar o acesso aos retornos da cobrança já registrada.
