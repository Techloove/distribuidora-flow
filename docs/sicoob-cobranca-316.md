# Sicoob Cobrança Bancária v3 — fase316

Configuração por loja, com produção e sandbox independentes. A instalação prepara Cimento desativada e preserva Sicredi, títulos e movimentos existentes.

## Configuração

Em Lojas → Cobrança por loja → Sicoob → Sandbox, informar Client ID e token sandbox. Segredos são gravados apenas no Supabase Vault por funções de servidor. A leitura da configuração devolve somente metadados. Produção exige A1/PFX, senha, beneficiário, contrato, conta bancária e conta financeira; não reutiliza token sandbox. Ativar exige teste recente da mesma revisão de configuração.

O teste de conexão verifica disponibilidade/autenticação, não substitui a homologação de emissão e instruções no banco. A entrega foi validada com banco de dados isolado e HTTP simulado, sem credenciais reais do usuário.

## Operações e limites

Boletos permanece o menu comum, com loja e banco. Sandbox tem registros separados de boletos reais e contas a receber. Emissão, consulta, PDF original, vencimento, baixa, abatimento e descontos são suportados. Administrador configura credenciais e concede alterações monetárias/baixa; operadores financeiros precisam da rotina sicoob_operar e acesso à loja.

Cada instrução é reservada antes do envio e possui chave única. Timeout, HTTP ambíguo ou ausência de confirmação deixa operação pendente. A recuperação consulta o banco e não repete emissão ou alteração automaticamente. Confirmação exige identidade, contrato e valores coerentes. Vencimento da parcela muda somente após confirmação bancária e se o título ainda conserva o vencimento anterior.

Baixa bancária não cancela a venda nem paga o título. Desconto e abatimento não antecipam lançamentos financeiros. Liquidação consultada é sinalizada, mas valor/data efetivamente recebidos devem ser conferidos em Contas a receber: não há recebimento automático Sicoob nesta fase. Tarifas, webhooks, Pix e protesto não são implementados por esta entrega.

## Contrato de referência

Produção: https://api.sicoob.com.br/cobranca-bancaria/v3

Sandbox: https://sandbox.sicoob.com.br/sicoob/sandbox/cobranca-bancaria/v3

OAuth produção: https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token, client_credentials com mTLS. Sandbox usa Bearer token e cabeçalho client_id.

O portal oficial não pôde ser consultado pela rede do ambiente. O contrato foi conferido no espelho público Swagger 2 Cobrança Bancária 3.0.8.0, arquivo openapi.json do repositório https://github.com/open-fidias/sicoob-cobranca-bancaria-api (blob SHA 057e275b70860d5443e409f6e2b51f45828d96b1), e cruzado com a interface pública https://github.com/SharpSistemas/SicoobAPI. Nenhum código desses repositórios foi executado. Validar as operações com o sandbox contratado antes de habilitar produção.

## Validação

scripts/check-sicoob-316.cjs testa migração repetível, cofre, permissões, lojas, idempotência, confirmação, alterações e isolamento financeiro. tests/sicoob-api.test.ts testa parsing, instruções e validação PFX no runtime Node. Telas foram verificadas com Playwright em 1366 e 390 pixels com HTTP simulado.
