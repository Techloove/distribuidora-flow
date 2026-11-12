# Sicoob LIQUI — fase359

A fase358 consulta a situação individual. A fase359 adiciona o fluxo assíncrono de liquidação e recebimento financeiro, usando a mesma aplicação de Cobrança v3, certificado e conta da loja. Não emite, altera ou comanda baixa de boletos no banco. A única chamada POST bancária solicita um relatório de movimentações, tipoMovimento 5.

## Instalação e acompanhamento

Publicar o aplicativo e aplicar `db/fase359_sicoob_liqui_financeiro.sql` no SQL Editor do projeto que já possui as fases316/351, 355 e 358. O código é compatível com o banco anterior: sem fase359, o painel continua informando que a baixa por arquivos não está habilitada. A instalação habilita o coletor nas lojas Sicoob/API e mantém os outros bancos isolados. Novas lojas Sicoob são incluídas pelo gatilho de configuração; produção precisa estar ativa, autenticada na versão vigente, com conta financeira válida e administrador ativo autorizado.

O novo job `sicoob-liqui-359` executa a cada cinco minutos. Cada execução realiza uma etapa: solicitar código, consultar arquivos disponíveis ou baixar um arquivo. Não há espera bloqueante por geração do relatório. Um ciclo pode levar mais de cinco minutos. Alterna janela recente com recuperação histórica desde a primeira emissão ERP ainda sem baixa, no máximo dois dias por solicitação; a janela recente não depende do vencimento nem do intervalo de seis horas dos títulos já liquidados. Há lease exclusivo, espera progressiva após erro e invalidação do job antigo se a configuração mudar. O código de solicitação é salvo antes de consultar/download; todos os IDs de arquivos precisam terminar para concluir o ciclo.

Depois de aplicar, acompanhar o painel na loja Cimento e `scripts/sql/diagnostico-sicoob-liqui-359.sql`. Conferir no 3849 o valor_liquidado, data_liquidacao, status/valor_pago do título e conta financeira. O acesso de gerenciamento usado no ambiente de desenvolvimento estava expirado; nenhuma consulta autenticada real ou baixa financeira em produção foi realizada por este desenvolvimento. A primeira execução real continua sendo validação operacional necessária.

Para pausar apenas o recebimento por LIQUI, executar `update public.sicoob_liqui_config_359 set ativo=false where centro_id='<UUID da loja>';`. Para retomar, atualizar ativo=true e proxima_consulta=now(). Os segredos das rotinas e certificados nunca devem ser copiados ou compartilhados.

## Validações financeiras

O leitor limita Base64, arquivos, registros e bytes descompactados, valida cabeçalhos ZIP e CRC e nunca extrai caminhos em disco ou executa conteúdo recebido. Arquivos malformados não são reparados por adivinhação. Filtra referências existentes de emissões ERP confirmadas antes de ler valores, para não importar boletos anteriores feitos diretamente no banco ou de outras contas/modalidades. O banco revalida convênio, conta, versão, nosso número, seu número, código de barras, valor nominal e snapshot original.

A equação exigida é valorLiquido = valorTitulo + valorMora - valorDesconto - valorAbatimento. Esse uso do campo valorLiquido é condicionado à equação, não inferido só pelo nome: os exemplos públicos têm tarifa separada e não deduzida daquele valor. Se o retorno do convênio divergir, a rotina não registra recebimento. Usa dataLiquidacao como data financeira e dataMovimentoLiquidacao para conferir o período solicitado, sem usar data de consulta ou previsão de crédito. O retorno pode indicar movimento recente de pagamento anterior. Datas futuras ou anteriores à emissão são recusadas.

A mora agregada vira acréscimo do título; não se inventa divisão entre juros e multa. Usa receber_titulo com identidade autenticada do administrador, conta Sicoob gravada na emissão e desconto/abatimento explícitos. A conta prevista no título pode ser substituída pela conta da cobrança comprovada, mas o vínculo da cobrança/snapshot original não pode ser alterado silenciosamente. Não recebe títulos cancelados, parcialmente pagos, já pagos manualmente, com movimentos anteriores, saldo alterado ou identidade divergente. Esses casos ficam registrados como conferir, sem segunda entrada.

Chave canônica de pagamento, registro financeiro no boleto, lock do título e transação impedem repetição. Tarifa, data de processamento e contrato opcional não entram na chave de pagamento, de modo que enriquecimento de metadados não cria novo recebimento. Valores/data/identidade diferentes de recebimento anterior não são reaplicados. Estornos e inconsistências exigem conferência, sem reversão automática. A fila guarda somente dados estruturados necessários e diagnóstico financeiro de registros que foram identificados como ERP, sem pagador, certificado, token ou corpo bruto.

## Tarifas

O valorTarifaMovimento do LIQUI é armazenado no comprovante de retorno para conferência, não lançado novamente como despesa. A fonte financeira das tarifas permanece exclusivamente o extrato da fase355, com identificador bancário e referência comprovada ao boleto ERP. Isso evita duplicação entre LIQUI e extrato. Tarifas agrupadas sem referência, ou cobranças de boletos antigos feitos no banco, não são atribuídas por suposição a novos títulos. A fase359 não resolve esse vínculo ausente nem confirma débitos que ainda não retornaram no extrato.

## Fontes e testes

As referências públicas estão em `docs/sicoob-revisao-colecao-postman.md`. São referências comunitárias, não certificação da resposta real desta cooperativa. A integração aceita apenas o contrato validado e mantém erro/conferência se houver variação.

Testes Bun validam ZIP/CRC/limites, campos financeiros, distinção entre data efetiva e movimento, equivalência da equação, HTTP201/204/403, etapas e todos os IDs de arquivos. PGlite executa o receber_titulo real da fase71, sem substituí-lo por stub: testa conta Sicoob, entrada e título pago, repetição de arquivo/evento, baixa manual prévia, mora/desconto/abatimento, mudança de configuração, privilégios e ausência de segunda despesa de tarifa. Não há emissão nem chamada bancária real nos testes.


## Diagnóstico de recusas HTTP — 1.49.1

O retorno real confirmou solicitação aceita e arquivo disponível, seguido de HTTP 403 no download. O GET, o caminho, os três parâmetros e os nomes/valores dos cabeçalhos funcionais foram comparados com a coleção oficial enviada e correspondem à documentação. Isso não identifica, por si só, a razão da recusa bancária.

A rotina descartava o motivo já sanitizado pelo cliente HTTP e conservava somente HTTP_403. Agora conserva em diagnostico.respostaHttp a etapa, método, recurso, status, motivo tratado, nomes dos campos retornados e rastreio permitido pelo banco. A lista de cabeçalhos de rastreio é fechada (IDs de atendimento e data), valida caracteres/tamanho e remove valores que correspondam a credenciais conhecidas; não inclui cookies, Authorization, certificado ou corpo bruto. Mensagens estruturadas de gateway e error.message também usam a sanitização bancária.

Não há alteração de token, escopo, certificado ou permissão por suposição; o HTTP 403 real continua sem causa confirmada até a próxima resposta enriquecida ou análise do suporte Sicoob. A solicitação e os arquivos pendentes são preservados; nenhum novo boleto é emitido, nenhum download recusado é tratado como recebimento e nenhum relatório pronto é substituído automaticamente. Não exige nova migração: usa o diagnóstico JSON já existente da fase359.

O script de diagnóstico unificado faz uma única consulta, evitando mostrar só a última seção no SQL Editor.
