# Sicredi CNAB 240 e boleto híbrido

Referências conferidas nos PDFs fornecidos: Manual Sicredi CNAB 240 **2.9, fevereiro/2026** (arquivo 081, lote 040) e Manual BR Code do Banco Central **2.0.1, agosto/2020**. A versão editorial do manual não corresponde ao código do layout do arquivo.

## Ativação

1. Aplicar `db/fase204_sicredi_cnab240.sql` após a fase203 no Supabase. Esta tarefa não aplicou a migração no banco de produção.
2. Abrir **Configurações do sistema → Cobrança Sicredi → Sicredi · CNAB 240**, selecionar um centro de custo e configurar como administrador/gestor: dados do beneficiário, conta corrente, conta financeira, categoria das tarifas, juros/multa e próximos sequenciais. Conferir os sequenciais em uso com a cooperativa; não reiniciá-los.
3. Para boleto híbrido, selecionar **Boleto híbrido com PIX** e informar a chave PIX aleatória vinculada ao convênio. Confirmar a contratação e homologar arquivos normais/híbridos com a cooperativa. A opção de homologação libera a aplicação de retornos.

Runtime do servidor: `EXT_SUPABASE_URL`, `EXT_SUPABASE_ANON_KEY`, `EXT_SUPABASE_SERVICE_ROLE_KEY`. O processamento de arquivos CNAB não exige API key Sicredi. A publicação do código no GitHub não executa migrações no Supabase nem homologa o convênio bancário.

## Remessa e retorno

No pedido confirmado, o financeiro abre **Emitir boletos**, seleciona as parcelas em aberto do pedido e escolhe **Arquivo de remessa CNAB 240**. O sistema gera uma remessa para enviar pelo Sicredi Internet Empresas. O ERP reserva os títulos como pendentes; não transmite ao banco nem os marca como registrados. Em **Boletos**, o histórico permite baixar novamente o mesmo arquivo, sem gerar novos sequenciais. A mesma tela mantém a importação de retornos e o acompanhamento; configuração e emissão ficam em seus respectivos locais.

Para registro direto via API, usar o mesmo botão no pedido e selecionar **Registro direto no Sicredi (API)**. Somente administrador, gestor e financeiro podem emitir. As parcelas já cobradas ou pagas são excluídas da seleção, e as RPCs existentes revalidam a disponibilidade antes da gravação. A emissão também está disponível por parcela em **Financeiro → Contas a receber**. Há um único menu **Boletos**; a rota antiga `/faturamento` redireciona para `/boletos`, preservando permissões legadas.

Remessa: registros ASCII de 240 posições com CRLF; header/lote, P/Q, R para multa, Y04 opcional para híbrido e trailers. Carteira simples, emissão pelo Sicredi e distribuição pelo beneficiário. O vencimento deve ser pelo menos sete dias após a emissão. Juros/multa começam no dia seguinte ao vencimento. Nosso número usa DV módulo 11 com cooperativa/posto/beneficiário e sequencial controlado. O limite de nosso número é 99.999, sem reset automático.

Retorno: prévia obrigatória, identificação de conta/beneficiário, layout, pares T/U, Y04, sequências, totalizadores, documentos e valores. Operador confirma a origem bancária. Uma divergência impede a aplicação de todo o arquivo.

Ocorrências: 02 registra, 03 rejeita entrada, 06 liquida, 09 confirma baixa, 17 liquida após baixa, 61 liquida PIX. Outras ocorrências ficam auditadas sem modificar títulos. O processamento só concilia boletos deste centro gerados pelo canal CNAB; operações API continuam independentes.

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
