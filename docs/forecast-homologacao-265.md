# Fase265 — prévia de homologação NF-e por loja

Esta fase acrescenta a conferência de homologação na tela **Faturamento e nota fiscal**. É uma prévia local, sem transmissão à Forecast/SEFAZ. Não significa que a empresa ou a emissão já estejam homologadas.

## Aplicar

1. Executar **somente** `db/fase265_previa_homologacao_forecast.sql`, inteiro, no SQL Editor do Supabase, após a fase264 já aplicada.
2. Publicar o código atualizado pelo fluxo habitual do projeto.
3. Em Lojas → Provedor fiscal, conferir o CNPJ e cadastrar o token de **homologação** da Forecast no campo próprio. O ambiente é uma declaração administrativa; esta prévia não consegue confirmar o ambiente remoto do token.
4. Em Faturamento e nota fiscal, escolher uma nota pendente ou rejeitada existente e clicar em **Prévia Forecast · Homologação**. Não é necessário criar dados fictícios permanentes.
5. Corrigir as pendências de cadastro e valores indicadas. Quando essas verificações passam, a tela mostra um rascunho parcial dos campos NF-e e as confirmações externas ainda necessárias. Não há botão de enviar nesta fase.

Este `.md` é documentação para leitura. Não deve ser executado como SQL.

## Conferências

- Loja/CNPJ e preferência Forecast atuais; credencial configurada para o mesmo CNPJ e declarada de homologação. Produção não é aceita para gerar o rascunho.
- Nota e pedido da mesma loja/cliente, estado compatível com faturamento e ausência de número/chave/protocolo já registrados. Não converte documentos anteriores em novas tentativas.
- Usuário ativo, primeiro acesso concluído, capacidade de faturamento, permissão fiscal/menu conforme o papel, acesso à loja e carteira do representante. A função é restrita à sessão autenticada; não usa service role para ler o contexto.
- Série, CRT, UF, CFOP e revisão do contador; documento, endereço, indicador de IE e inscrição estadual do destinatário; produto disponível no catálogo da loja; NCM, CEST, origem e GTIN quando informado.
- Quantidade, preço, desconto, total dos itens e conciliação com total da nota/pedido. Usa cálculo decimal com inteiros, respeita o arredondamento do resultado descontado e recusa precisão não suportada, negativos, zero e valores inválidos.
- Frete comum e por volume são encargos distintos no motor da fase250 e entram somados no rascunho de frete. Desconto do pedido/forma de pagamento e despesas/acréscimos são conciliados sem mudar o pedido.

O RPC retorna apenas campos selecionados; nunca retorna token, service role, dados do certificado ou configuração completa da credencial. Não altera notas, estoque, parcelas, comissão, auditoria ou preferências fiscais. O rascunho é calculado a cada consulta, não é uma reserva de emissão nem um snapshot aprovado para envio.

## Limites do contrato e da homologação

O `fore.txt` informa Basic `base64(token + ':')`, NF-e em `/api/v2/nfe`, ambiente associado ao token e regras tributárias por NCM em `/api/v2/empresas/{cnpj}/regras_tributarias`. O arquivo não detalha vários tipos de valores (`object`), formato de resposta, regex da referência, garantia de idempotência ou assinatura dos webhooks.

O rascunho usa nomes de campos documentados, valores decimais textuais como **proposta para revisão**, referência local determinística e nome do destinatário de homologação. Não escolhe CST/CSOSN/PIS/COFINS/IBS/CBS, forma de pagamento, natureza da operação ou código IBGE automaticamente. Não afirma que o payload está completo ou que esses tipos já foram aceitos pelo provedor.

Antes de implementar transmissão, confirmar com a Forecast e o contador: token e ambiente reais; empresa/certificado/série; regras por NCM e demais parâmetros fiscais por loja; tipos de valores, referência/idempotência, pagamento, endereço/IBGE e respostas de autorização/rejeição. Uma configuração de homologação não autoriza emissão em produção.

## Validação

- `bun test`: inclui testes de vínculo/CNPJ/produção, conciliação, arredondamento, CFOP, cadastro incompleto, catálogo por loja e ausência de alteração na entrada.
- `bun run typecheck`, `bun run build`, guards `check:sql`, `check:migrations`, `check:surface`, `check:server`.
- `NODE_PATH=/workspace/.validation/node_modules node scripts/check-forecast-migracoes-database.cjs` (também `--sem263`): aplica a cadeia local até265, verifica reaplicação, contexto sem credenciais, acesso por loja/carteira/papel/menu, negação a anônimo/service role e ausência de alterações no banco durante a consulta.

As credenciais Supabase não estavam disponíveis nesta máquina. A validação foi realizada com PGlite e dados locais de teste; não houve consulta autenticada real à Forecast, transmissão de homologação, nota real ou SQL no Supabase do cliente.
