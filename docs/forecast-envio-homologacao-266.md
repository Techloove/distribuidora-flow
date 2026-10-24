# Fase266 — envio e consulta de NF-e em homologação

Esta fase implementa o envio de teste à Forecast e a consulta manual da referência, com persistência e proteção contra duplicidade. **Produção continua bloqueada.** Testes desta entrega usaram transporte simulado e banco local; nenhuma NF-e foi transmitida à Forecast ou à SEFAZ durante o desenvolvimento.

## Aplicação manual

1. Executar **somente** `db/fase266_envio_homologacao_forecast.sql`, inteiro, após a fase265, no SQL Editor do Supabase. Reaplicável. O arquivo `.md` é documentação para leitura.
2. Publicar o código atualizado pelo fluxo habitual do projeto. A migração não faz chamadas externas, não libera testes automaticamente e não altera a configuração de produção.
3. Conferir as variáveis **server-side** existentes `EXT_SUPABASE_URL`, `EXT_SUPABASE_ANON_KEY`, `EXT_SUPABASE_SERVICE_ROLE_KEY`. A chave de serviço nunca deve usar prefixo `VITE_` ou ser exposta no navegador.
4. Em Lojas → Provedor fiscal → Conexão Forecast, cadastrar o **token de homologação** para o CNPJ da loja, conferir o acesso e os dados fiscais gerais. No painel do provedor, conferir certificado, série e regras tributárias por NCM com o contador.
5. Antes de habilitar testes, confirmar com a Forecast o contrato dos campos de NF-e, tipos dos valores decimais, referência, pagamentos e formato do retorno. O Swagger fornecido deixa respostas e vários tipos genéricos; não há comprovação de compatibilidade real nesta entrega.
6. O administrador pode então marcar a declaração e **Habilitar homologação desta loja**. A liberação é vinculada ao CNPJ, à versão da credencial e à fotografia dos dados fiscais da loja. Mudanças invalidam a liberação. **Suspender testes** bloqueia novos envios; tentativas já iniciadas precisam continuar sendo consultadas.
7. Em Faturamento e nota fiscal, abrir **Forecast · Homologação**, conferir a prévia e preencher natureza da operação, município IBGE, modalidade de frete, consumidor final, presença e meio de pagamento da nota. Não há preenchimento silencioso dessas escolhas.
8. Confirmar explicitamente a operação e usar **Enviar NF-e em homologação**. Depois usar **Consultar retorno na Forecast**. Nenhuma emissão deve ser feita em produção para validar esta fase.

## Persistência e prevenção de duplicidade

`forecast_homologacoes_266` armazena a referência, o payload exato, o contexto, o estado e o resultado sanitizado, separados de `notas_saida`. Há unicidade por nota, pedido e referência. O token não fica no snapshot: a credencial continua na tabela protegida da conexão; a tentativa guarda apenas uma impressão de comparação do token.

A referência é determinística (`CPRHML` + UUID da nota sem hífens). Antes do POST, uma operação atômica revalida ator, loja, carteira, configuração, contexto e payload, registra o início e entrega uma única autorização de envio. Duas requisições concorrentes ou repetidas não geram dois POSTs. Não depende de uma garantia de idempotência remota ainda não documentada.

Depois de iniciado o envio, não há retorno automático ao estado preparado nem novo POST, inclusive após timeout, HTTP400/401/404/500, resposta inválida ou falha ao gravar o retorno. Uma referência incerta deve ser consultada e conferida no provedor. Se o processo cair entre a marcação e o POST, pode haver uma referência que nunca chegou ao provedor; o sistema prefere bloquear a repetição. A recuperação/reemissão após esse caso ou após rejeição exige definição do contrato com a Forecast e não está automatizada nesta fase.

A consulta usa somente `GET /api/v2/nfe/{ref}`, com bloqueio temporário para impedir consultas simultâneas e sem seguir redirecionamentos. Uma consulta HTTP404 **não** autoriza novo envio. A credencial usada para consultar deve corresponder ao token/CNPJ original; trocar o token não permite consultar o documento com outra conta. Suspender novos envios não impede acompanhar uma tentativa existente usando a credencial correspondente.

## Homologação isolada da operação real

O corpo enviado fixa `ambiente: HOMOLOGACAO`; a liberação aceita apenas credencial declarada de homologação. Conforme a descrição R4 do Swagger, a API determina o ambiente pelo token e recusa contradição com o corpo. É necessário confirmar que o token é efetivamente de homologação no provedor; o cadastro local não prova isso sozinho.

O nome do destinatário é o texto de teste sem valor fiscal. A implementação desta fase cobre saída normal, finalidade normal, CNPJ numérico e um meio de pagamento por documento. Não habilita devolução, importação, notas complementares/ajuste, pagamentos mistos ou cartões, nem escolhe códigos tributários automaticamente. Os tributos dependem das regras por NCM/CNPJ configuradas e conferidas na Forecast.

Um resultado de homologação **não** atualiza o status da nota operacional, não libera carga/boleto, não baixa estoque, não cria parcelas e não liquida títulos. Uma chave já registrada por este fluxo de teste também é bloqueada se tentarem usá-la em `notas_saida` como chave operacional.

## Validação do retorno

O parser exige `ref`, `cnpj_emitente`, `ambiente` de homologação e status reconhecido. Para reconhecer autorização, também exige `chave_nfe`, `protocolo`, `numero` e `serie`; confere comprimento, dígito verificador, CNPJ/modelo/série/número embutidos na chave e correspondência ao documento reservado. Essa conferência não substitui a validação criptográfica do XML ou uma homologação real com o provedor.

Sem identidade/prova suficiente, o resultado fica **incerto**, nunca autorizado por um HTTP200 isolado. Estados em processamento e rejeição só são aceitos depois de conferir a identidade. Mensagens e corpos remotos genéricos não são repassados ao navegador; os detalhes de uma rejeição devem ser conferidos no painel Forecast. Uma autorização confirmada não é apagada por uma falha temporária de consulta posterior.

Esses nomes de resposta precisam de confirmação com um exemplo real do provedor: o Swagger fornecido declara apenas `object`. Se o formato real for diferente, o parser deve ser ajustado com base no contrato confirmado, sem afrouxar a prova para aceitar respostas genéricas.

## Segurança e testes

Funções de liberação usam a sessão do administrador e as permissões de configuração da loja. A leitura de contexto/status usa a sessão do usuário. Reserva, autorização única de envio e registro do retorno são exclusivos do servidor, com revalidação explícita do ator; a service role não depende de `auth.uid()` e não amplia o acesso do usuário. Representantes com outro papel continuam sujeitos à carteira, salvo administrador, conforme a regra vigente.

Os testes simulam a service role sem `auth.uid()` para conferir o contexto de forma realista. Também cobrem atualização de credencial/CNPJ/configuração, produção recusada, contexto/payload alterados, uma tentativa por pedido, concorrência, lease, prova incompleta, falhas de rede/persistência, sigilo, estados monotônicos e separação da nota real.

Comandos: `bun test`, `bun run typecheck`, `bun run build`, guards `check:sql`, `check:migrations`, `check:surface`, `check:server`, e `NODE_PATH=/workspace/.validation/node_modules node scripts/check-forecast-migracoes-database.cjs` (também `--sem263`). Os fixtures são locais e não ficam no banco do cliente.

## O que ainda falta para produção

Validar o contrato e o ciclo real de homologação com a Forecast, resolver eventuais diferenças do retorno, implementar obtenção e validação de XML/DANFE, cancelamento e demais eventos necessários, e definir a recuperação após rejeição/falhas conforme as garantias da API. Webhooks e agendamento automático não estão ativos. Só depois habilitar um fluxo de produção separado e revisado por loja/CNPJ. As credenciais do Supabase não estavam injetadas nesta máquina; login, chamada autenticada real e emissão de homologação externa não foram testados nesta entrega.
