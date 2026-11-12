# Confirmação de emissão e documento Sicoob — fase362

O boleto3850 foi registrado no Sicoob e apareceu no DDA, mas o ERP só confirmou seu registro após consulta manual. O fluxo anterior encerrava a tentativa quando o retorno imediato não passava na conferência; o job358 excluía emissões em processamento sem nosso número. Não foi capturado o corpo original desse retorno, portanto não se atribui a divergência a um campo específico sem prova.

O PDF real do3850 mostra `89f2dfbb048047fbb5` no campo Número do Documento, enquanto o título do ERP é Teste2/1. Isso corresponde ao UUID abreviado que o sistema enviava em `seuNumero`, e não a uma troca de banco ou conta. A especificação fornecida pelo usuário define até18 caracteres para `seuNumero` e até25 para `identificacaoBoletoEmpresa`.

## Comportamento

- Resposta válida é confirmada diretamente. Se a inclusão aceita não passar na conferência e contiver nosso número válido, faz uma consulta GET individual e reaplica todos os validadores antes de vincular. Aceita200/201/202 como respostas de inclusão recebida; sem dados suficientes, mantém a confirmação pendente.
- Sem confirmação imediata, a operação fica incerta/em processamento e a interface informa pendência, sem contar o título como emitido com sucesso. Não repete o POST. Enquanto a janela estiver aberta, atualiza a lista local a cada dez segundos; isso não faz consultas adicionais ao banco.
- A fase362 amplia o job358 já existente, a cada cinco minutos, para operações ERP enviadas/incertas ainda sem nosso número. Consulta por pagador em janelas de até31 dias, sem filtro de situação, exige referência única e confirma o detalhe individual. Configuração/versão/loja/conta/identificadores/valor são revalidados. Sem confirmação, reagenda com espera progressiva; uma recusa explícita ou uma reserva nunca enviada não entra nessa recuperação.
- Nunca substitui divergência por sucesso. Não inventa nosso número, data ou valor e não afrouxa a identificação. Banco com demora, recusa403 ou indisponibilidade ainda pode deixar uma pendência de conferência.
- Novas emissões de produção usam `documento/parcela` em `seuNumero`. Documento ausente, controle/quebra de linha ou mais de18 caracteres impede a criação, sem truncar silenciosamente. O UUID abreviado permanece em `identificacaoBoletoEmpresa`; o snapshot exige essa identificação técnica nos retornos de novas emissões, inclusive no PostgreSQL. Um documento reutilizado não é prova suficiente de vínculo.
- Boletos anteriores, incluindo3849 e3850, preservam a referência registrada no banco. A migração não reemite, cancela, altera o documento bancário antigo nem modifica o PDF fornecido pelo banco. As reimpressões antigas continuam mostrando a referência originalmente enviada. Homologação mantém o fluxo isolado.
- A coleta LIQUI aceita a referência textual do documento com limite e sem caracteres de controle; continua exigindo mesmo nosso número, código de barras, convênio, conta e valores. Pagamentos/tarifas361 não são alterados pela instalação.

## Instalação

Publicar1.51.0 e executar `db/fase362_sicoob_confirmacao_emissao.sql` após358/351 e demais fases atuais. É repetível e preserva o mesmo job, segredo e configurações. A primeira instalação antecipa pendentes elegíveis sem interromper leases; não chama o banco durante o SQL. Não é necessário novo certificado nem alterar a configuração de produção.

## Verificação

- `node scripts/check-sicoob-tarifas-355.cjs --confirmacao` usa as funções reais316/351/358/362 em banco descartável. Confere documento/parcela, identificação técnica, recuperação do mesmo registro, ausência de segundo envio, bloqueios de valor/identidade/lease e preservação financeira.
- Testes TypeScript exercitam resposta inicial divergente seguida de GET válido, resposta correta sem GET extra, identificador ausente/zero, referência reutilizada/ambígua, pagador em duas janelas e retorno com empresa divergente.
- Regressões359/361 e de isolamento358 mantêm as rotinas financeiras existentes. Não se emite boleto real durante os testes de desenvolvimento.

A consulta real do próximo boleto novo deve confirmar o comportamento publicado e o PDF do banco com o documento/parcela. O vencimento e o abatimento de R$5 do3850 já foram confirmados pelo usuário no banco; não são reaplicados por esta entrega.
