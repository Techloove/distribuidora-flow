# Código do beneficiário nas instruções Sicredi

As instruções PATCH de alteração de vencimento e baixa identificam o convênio pelo cabeçalho `codigoBeneficiario`, além de cooperativa, posto, chave da API e token. O envio anterior omitia esse cabeçalho. A correção usa o código do convênio já validado contra o boleto, preservando zeros à esquerda.

A alteração mantém o corpo `dataVencimento` em formato ISO. A reserva da solicitação acontece antes do PATCH; a confirmação do vencimento continua dependendo da consulta ao banco. HTTP 400 registra rejeição, sem mudar a data local. Timeout, HTTP 408 e 5xx continuam pendentes/incertos, sem reenvio automático.

Quando o banco recusa uma alteração, a tela mostra as mensagens estruturadas reconhecidas, com limpeza de credenciais. O corpo bruto e respostas HTML não são enviados à interface. A correção não reenvia nenhuma operação pendente e não altera boletos existentes.

Referência complementar do contrato de instruções: [implementação pública de alteração e baixa](https://github.com/Ctrl-Mota/banco-sicredi-connector-php/blob/0cd7695fce9315254776f48ced42318057bcdb34/src/SicrediCobranca.php). A coleção pública `open-fidias/sicredi-client-api`, arquivo `sicredi-postman-collection-1.json`, também especifica o cabeçalho nas instruções; seus exemplos de credenciais não são reproduzidos aqui.

Testes simulados verificam cabeçalhos, corpo e ordem das chamadas, motivo seguro da recusa, preservação dos estados, ausência de reenvio e confirmação somente por consulta. Nenhuma instrução real foi enviada ao Sicredi pelo agente. A aceitação da nova data ainda depende do retorno bancário em produção.
