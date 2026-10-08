# Sicredi CNAB 240 e boleto híbrido

Referências conferidas nos PDFs fornecidos: Manual Sicredi CNAB 240 **3.0, maio/2026** (com retorno Y04 legado da versão 2.9) (arquivo 081, lote 040) e Manual BR Code do Banco Central **2.0.1, agosto/2020**. A versão editorial do manual não corresponde ao código do layout do arquivo.

## Ativação

1. Para a instalação existente, com as fases204–206 já aplicadas, executar `db/fase207_sicredi_cnab30.sql` e, depois, `db/fase208_sicredi_configuracao_compartilhada.sql`. Ela permite CPF numérico ou CNPJ alfanumérico sem substituir RPCs, RLS, sequenciais ou histórico. Não reaplicar a fase204 por cima das posteriores. A aplicação no Supabase de produção é uma etapa separada da publicação do código.
2. Abrir **Configurações do sistema → Cobrança Sicredi → Sicredi · CNAB 240**, configurar uma única vez como administrador, independentemente do filtro de centro: dados do beneficiário, conta corrente, conta financeira, categoria das tarifas, juros/multa e próximos sequenciais. Conferir os sequenciais em uso com a cooperativa; não reiniciá-los.
3. Para boleto híbrido, selecionar **Boleto híbrido com PIX** e informar a chave PIX aleatória vinculada ao convênio. Confirmar a contratação e homologar arquivos normais/híbridos com a cooperativa. A opção de homologação libera a aplicação de retornos.

Runtime do servidor: `EXT_SUPABASE_URL`, `EXT_SUPABASE_ANON_KEY`, `EXT_SUPABASE_SERVICE_ROLE_KEY`. O processamento de arquivos CNAB não exige API key Sicredi. A publicação do código no GitHub não executa migrações no Supabase nem homologa o convênio bancário.

## Remessa e retorno

No pedido confirmado, o financeiro abre **Emitir boletos**, seleciona as parcelas em aberto do pedido e escolhe **Arquivo de remessa CNAB 240**. O sistema gera uma remessa para enviar pelo Sicredi Internet Empresas. O ERP reserva os títulos como pendentes; não transmite ao banco nem os marca como registrados. Em **Boletos**, o histórico permite baixar novamente o mesmo arquivo, sem gerar novos sequenciais. A mesma tela mantém a importação de retornos e o acompanhamento; configuração e emissão ficam em seus respectivos locais.

No histórico de remessas há **Baixar .CRM para homologação**. A cópia preserva todos os registros e não reserva novos títulos ou sequenciais. O nome usa os códigos de mês `123456789OND`; a data do header corrige o nome da cópia de arquivos antigos que usavam A/B/C. O arquivo original permanece no histórico.

O portal de homologação exige validação externa. Para emissão pelo beneficiário, a cartilha recomenda cinco títulos e PDF correspondente; para híbrido, exige também QR gerado com a location de teste fornecida pelo portal. O ERP não gera esse PDF de homologação nem substitui a location de produção por uma de teste. O download CRM facilita a submissão, mas não significa aprovação bancária.

CPF/CNPJ nos registros CNAB seguem o formato alfanumérico do manual 3.0, com zeros à esquerda. A validação aqui confere formato, não calcula os dígitos verificadores. O cadastro de clientes deve fornecer o documento completo; funcionalidades externas de consulta cadastral precisam aceitar o novo formato para uso com CNPJ alfanumérico.

Para registro direto via API, usar o mesmo botão no pedido e selecionar **Registro direto no Sicredi (API)**. Somente administrador, gestor e financeiro podem emitir. As parcelas já cobradas ou pagas são excluídas da seleção, e as RPCs existentes revalidam a disponibilidade antes da gravação. A emissão também está disponível por parcela em **Financeiro → Contas a receber**. Há um único menu **Boletos**; a rota antiga `/faturamento` redireciona para `/boletos`, preservando permissões legadas.

Remessa: registros ASCII de 240 posições com CRLF; header/lote, P/Q, R para multa, Y04 obrigatório quando o título é híbrido e trailers. Carteira simples, emissão pelo Sicredi e distribuição pelo beneficiário. O vencimento deve ser pelo menos sete dias após a emissão. Juros/multa começam no dia seguinte ao vencimento. Nosso número usa DV módulo 11 com cooperativa/posto/beneficiário e sequencial controlado. O limite de nosso número é 99.999, sem reset automático.

Retorno: prévia obrigatória, identificação de conta/beneficiário, layout, pares T/U, Y03 (Y04 legado também aceito), sequências, totalizadores, documentos e valores. Operador confirma a origem bancária. Uma divergência impede a aplicação de todo o arquivo.

Ocorrências: 02 registra, 03 rejeita entrada, 06 liquida, 09 confirma baixa, 17 liquida após baixa, 61 liquida PIX. Outras ocorrências ficam auditadas sem modificar títulos. O processamento só concilia boletos do convênio compartilhado gerados pelo canal CNAB; operações API continuam independentes.

Liquidação reutiliza as funções financeiras existentes: recebido bruto, juros e descontos/abatimentos, mais a diferença entre bruto/líquido como tarifa bancária. IOF, outras despesas/créditos, liquidação parcial, saldo alterado ou encargos incompatíveis exigem conciliação manual. Identificação por arquivo/evento e conferência de liquidação anterior impedem crédito duplicado, inclusive quando a mesma liquidação chega como 06 e 61.

## PIX e QR Code

Na remessa híbrida, Y04 informa a chave aleatória; TXID fica em branco para geração pelo Sicredi. O retorno de registro fornece a URL e o TXID. Somente após importar esse retorno o ERP disponibiliza **QR Code PIX** e **PIX copia e cola** na lista de boletos registrados.

BR Code dinâmico: formato 01, iniciação 12, GUI `br.gov.bcb.pix`, location sem protocolo em 26/25, moeda 986, país BR, nome PIX, cidade Cidade e referência `***`, conforme exemplo do Sicredi. O TXID e os valores são obtidos pelo aplicativo pagador na location; o ERP não inventa uma cobrança PIX estática. CRC-16/CCITT-FALSE usa polinômio 1021, inicial FFFF, incluindo `6304`. QR é renderizado localmente, sem serviço externo de imagens. URLs aceitas neste módulo são do domínio de produção `pix-qrcode.sicredi.com.br`; outra location exige conferir o manual/convênio antes de ampliar o suporte.

A impressão do boleto emitido pelo Sicredi continua pelo banco. O módulo não fabrica PDF, código de barras ou linha digitável a partir do arquivo CNAB. Baixa por remessa CNAB, alteração de valor, descontos negociados na remessa, protesto e carteiras adicionais não estão implementados; executar essas instruções pelo banco e importar o retorno correspondente.

## Segurança e validação

Tabelas com RLS e leitura financeira por centro. Escritas exclusivamente no servidor, sessão e perfil ativo, autorização por papel/centro e rate limit. RPCs aceitam apenas service_role e revalidam o ator; importação e reserva são transacionais. Credenciais ficam no servidor.

```sh
bun test
npm run typecheck
npm run build
bun run check:sql
bun run check:migrations
bun run check:server
```

Teste de banco isolado com PGlite, schema mínimo e funções financeiras reais da fase71:

```sh
npm install --prefix /tmp/cnab-db-tests --no-package-lock @electric-sql/pglite@0.3.14
NODE_PATH=/tmp/cnab-db-tests/node_modules node scripts/check-cnab-database.cjs
```

Validação local: 25 testes passaram, assim como typecheck, build e checks SQL/migrações/servidor. O teste de banco isolado passou. Chromium verificou o fluxo financeiro normal e híbrido; um leitor independente (jsQR) decodificou o QR exibido e confirmou o PIX copia e cola.

Testes sintéticos verificam posições, CRC com vetores independentes, remessa híbrida, leitura Y04, conciliação de bruto/líquido, duplicidade e rollback. Eles não substituem homologação bancária ou validação no Supabase real. O check:surface tem uma falha preexistente em `auth.tsx` (auth.signUp no cliente), independente desta implementação.

## Alteração de vencimento — fase205

Aplicar `db/fase205_sicredi_alteracao_vencimento.sql` **após a fase204**. A migração cria solicitações auditadas, RLS por centro, trava de uma solicitação ativa por boleto e RPCs exclusivas do servidor. Não reaplicar a fase204 depois da fase205: a fase205 mantém a função financeira anterior como auxiliar privada e acrescenta o tratamento de confirmação de vencimento na mesma transação.

Em Contas a receber ou Boletos, **Alterar vencimento** fica disponível para boleto Sicredi registrado. O novo vencimento não pode estar no passado. Boletos e títulos com data divergente, pagos/cancelados ou com solicitação pendente são bloqueados. A data do boleto e da parcela só muda após confirmação bancária; o nosso número é preservado e nenhum novo recebimento é lançado.

- API: `PATCH /cobranca/boleto/v1/boletos/{nossoNumero}/data-vencimento`, corpo `{dataVencimento: "YYYY-MM-DD"}`. Envio aceito fica pendente; **Conferir no Sicredi** consulta o banco e confirma apenas quando a data devolvida coincide. Timeout/HTTP 5xx ficam inconclusivos, sem reenvio automático. Convênio e ambiente devem corresponder ao boleto original.
- CNAB: gera uma remessa de instrução **06**, preservando os dados originais e ajustando datas de juros/multa. Usa novo sequencial de remessa, sem consumir nosso número. Y04 é exclusivo de entrada e não é enviado na alteração. Enviar pelo Internet Empresas e importar o retorno: **14** confirma, **26** rejeita. Data divergente impede importação. O arquivo pode ser baixado novamente pelo histórico.

O endpoint API foi conferido no código público ACBr (`Fontes/ACBrBoleto/WS/ACBrBoletoW_Sicredi_APIV2.pas`, commit `2784a56ad10f60b9fa412c8d172e495e9d93a0e7` do espelho frones/ACBr). A documentação oficial HTTP não estava acessível neste ambiente; essa referência complementa os testes locais e não substitui homologação bancária. A instrução CNAB usa o manual Sicredi 2.9 fornecido.

Validação adicional: testes de requisição API simulada (envio, timeout, rejeição, contrato divergente e confirmação por consulta), vetores CNAB06/retorno14 e transações reais em PostgreSQL isolado (confirmação/rejeição/divergência, sem alteração financeira). Migração de produção não executada pelo agente.

Resultado da validação desta alteração: 33 testes passaram, typecheck e build passaram, checks SQL/migrações/servidor passaram. Chromium verificou menu único, permissões antigas, filtros com/sem boleto, emissão por parcela e alteração CNAB com vencimento preservado até confirmação. O teste PostgreSQL isolado também verificou reaplicação idempotente da fase205.

## Atualização para manual 3.0 — fase207

Validação desta atualização: 42 testes passaram; typecheck e build passaram. O PostgreSQL isolado validou a reaplicação da fase207, aceitação de CPF/CNPJ alfanumérico e rejeição de formatos inválidos, mantendo os testes financeiros e de duplicidade das fases anteriores. Os checks de migrações e segurança do servidor passaram. O cadastro convencional e as consultas cadastrais externas ainda usam documento numérico; o suporte alfanumérico desta atualização se aplica à configuração e ao processamento bancário.

## Configuração e sequenciais compartilhados — fase208

Aplicar `db/fase208_sicredi_configuracao_compartilhada.sql` após a fase207. Há uma única configuração CNAB, válida para todos os centros, na mesma seção das configurações do sistema. O campo legado `centro_id` da configuração preserva apenas sua origem; a emissão não o utiliza para escolher convênio ou contador. Somente administrador pode editar o convênio global. A API Sicredi já tinha configuração global e continua com sua numeração fornecida pelo banco.

A migração preserva o histórico, os números reservados, as solicitações de vencimento e as políticas de carteira. O próximo nosso número é pelo menos o maior sequencial CNAB já reservado para o convênio mais um; a próxima remessa é pelo menos a maior remessa histórica mais um. Arquivos de teste, rejeitados e baixados não liberam números para reutilização. A configuração existente é aproveitada e sua conta financeira passa a ser compartilhada (`centro_id = null`). Nenhuma venda, título, boleto ou movimento troca de centro. Novas configurações exigem conta financeira compartilhada. Se existir mais de uma configuração bancária distinta, a transação inteira é bloqueada para evitar escolher um convênio incorreto.

As RPCs de emissão e alteração de vencimento travam a mesma linha global. Se duas emissões forem calculadas com a mesma versão/numeração, só uma grava; a outra recebe “Configuração mudou. Atualize e gere novamente”, sem arquivo, boleto ou avanço parcial. Repetir a emissão após atualizar usa o próximo número. Há também índice único de sequencial global para as novas remessas e o índice bancário existente protege o nosso número em todos os centros. Alterar vencimento consome apenas o sequencial de remessa.

Um retorno pode reunir boletos dos dois centros: a prévia mostra o centro de cada venda, e o banco concilia cada evento no centro do título, em uma única transação. Uma divergência ou falta de acesso a qualquer centro impede o processamento inteiro. Recebimentos e tarifas mantêm os centros de origem na mesma conta financeira. Uma cópia de retorno misto no histórico só é visível para quem pode acessar todos os centros contidos no arquivo; isso evita expor dados de outro centro pelo conteúdo bruto.

Validação em PostgreSQL isolado: reaplicação da fase208, recuperação dos maiores números do histórico, primeira configuração sem filtro de centro, duas emissões com a mesma versão, rejeição e nova tentativa sem duplicidade, alteração de vencimento do segundo centro, retorno misto com rollback integral, acesso restrito ao arquivo misto e liquidação sem duplicidade com movimentos separados por centro. Chromium com dados simulados verificou configuração sem centro selecionado, um único par de campos de sequência, alternância entre os dois centros e Todos, e gravação pelo servidor. A migração ainda precisa ser aplicada no Supabase de produção; os testes não substituem a homologação Sicredi.
