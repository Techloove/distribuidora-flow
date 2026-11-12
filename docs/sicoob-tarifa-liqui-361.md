# Tarifa individual Sicoob — fase361

A baixa do boleto 3849 confirmou R$50 recebidos em 11/11/2026 e `valorTarifaMovimento=1.44` no LIQUI. O usuário conferiu essa tarifa no banco e confirmou que o débito de R$2,88 do extrato contém cobranças agrupadas. A fase361 contabiliza apenas a tarifa individual vinculada à emissão ERP; não atribui o total agrupado aos novos boletos.

## Instalação e operação

Aplicar `db/fase361_sicoob_tarifa_liqui.sql` no SQL Editor, após as fases355 e359/360. A instalação é repetível, preserva configurações e histórico, e não lança despesas dentro da migração. O agendamento `sicoob-tarifa-liqui-361` executa a cada cinco minutos diretamente no PostgreSQL. O primeiro ciclo considera os recebimentos já salvos, inclusive o 3849, se a contabilização da loja estiver ativa, com data inicial que inclua sua emissão e a tarifa. Não é necessário novo pagamento ou acesso à página para disparar.

Em Lojas → Sicoob → Contabilização de tarifas, reutiliza ativação, conta financeira da cobrança, categoria de despesa financeira, responsável e data inicial da fase355. Pausar essa configuração bloqueia os dois importadores. A configuração da cobrança deve continuar ativa e autenticada, na mesma conta/convênio de origem. Não há credencial, escopo de transferência ou chamada bancária nova. A conta recebe o crédito integral do cliente, e uma saída independente registra a despesa/DRE pelo lançador financeiro existente. A data da tarifa é `dataMovimento` confirmada pelo LIQUI; não se usa data da consulta ou previsão de crédito. Essa é a data de competência do movimento de cobrança; o débito consolidado do extrato pode ocorrer em outra data e não é associado por estimativa.

A tela Boletos distingue tarifa informada, contabilizada e pendências; detalhes mostram a origem e o motivo de conferência. O total ignora uma possível repetição genérica do extrato, mas inclui outras tarifas comprovadamente distintas. A leitura do registro de tarifas exige acesso financeiro e à loja por RLS; escrita e processamento permanecem exclusivos do servidor. O botão de sincronização do extrato não dispara nem condiciona o job local LIQUI.

## Proteções

- Emissão de produção ERP confirmada, evento359 válido e recebido, identidade/conta/convênio consistentes e título pago são obrigatórios. Exclui sandbox, Sicredi e títulos antigos emitidos no banco, mesmo com débito recente.
- Cada boleto tem no máximo um registro de tarifa LIQUI, com chave bancária, assinatura do retorno, conta, categoria e movimento preservados no registro355. Repetições e reinstalação não recriam despesa.
- Tarifa posteriormente alterada, estorno ou movimento divergente exige revisão; não há estorno ou relançamento automático.
- O importador355 e o job361 usam a mesma trava transacional. Tarifa genérica/de liquidação do extrato posterior ao LIQUI fica em conferência; uma tarifa incerta do extrato anterior impede criar outra despesa LIQUI. Não deduz igualdade ou diferença apenas por data/valor.
- Saída manual preexistente de mesma conta/data/valor ou possível tarifa agrupada manual da mesma categoria/data exige revisão. Não a associa ao boleto por estimativa.
- Descrições explicitamente de outra natureza (registro/emissão, alteração de vencimento/prorrogação, abatimento, desconto, baixa/cancelamento etc.) continuam pelo extrato se houver referência explícita ao boleto. Uma descrição que também menciona liquidação é tratada como incerta. Linhas antigas sem natureza registrada exigem revisão conservadora.
- O job processa até100 candidatos por execução. Ausência de tarifa e tarifa zero não bloqueiam os demais. Falha em uma loja reverte seus lançamentos e registra erro para revisão; as outras lojas continuam. Operações não autorizadas não podem executar o job nem criar tarifas diretamente.

## Outras operações e referências

A coleção oficial de Cobrança V3 fornecida pelo usuário lista movimentações1 Entrada,2 Prorrogação,3 A Vencer,4 Vencido,5 Liquidação e6 Baixa, com janelas de até dois dias. O modelo público [SharpSistemas/SicoobAPI](https://github.com/SharpSistemas/SicoobAPI/blob/main/Sicoob.Cobranca/Models/Shared/Movimentacoes.cs), consultado em12/11/2026, contém `valorTarifaMovimento` no objeto de movimentação. A estrutura isolada não comprova que cada tarifa seja cobrada, nem que o campo venha preenchido em todas as operações/contas. Abatimento não consta como um tipo específico nessa lista. Não se infere tarifa de alteração, abatimento ou cancelamento apenas porque a operação foi solicitada ou confirmada.

Esta fase contabiliza LIQUI e mantém o extrato355 para outras tarifas comprovadas; não instala coleta de arquivos de prorrogação/baixa nem interpreta texto do histórico como despesa. Os testes reais das outras operações ainda devem verificar o que o banco disponibiliza. Se vier apenas total agrupado, não é importado por estimativa.

## Validação

`node scripts/check-sicoob-tarifas-355.cjs --liqui` executa a instalação duas vezes e os casos de conta/categoria/data, recuperação, duplicidade nas duas ordens, débito agrupado, tarifas de outras operações, manual, pausa, estorno, retorno alterado, isolamento Sicredi/sandbox/legado e privilégios/RLS em banco descartável, usando o lançador financeiro real. Não acessa dinheiro ou banco externo. As regressões359/358 preservam recebimentos e consulta automática.

Depois de aplicar, aguarde o próximo ciclo de cinco minutos e execute `scripts/sql/diagnostico-sicoob-liqui-359.sql`. Em `tarifas_3849`, confira origem `liqui`, valor1.44, estado `lancado`, movimento ativo de saída e conta/categoria esperadas. A implantação em produção precisa dessa confirmação; testes locais não comprovam que o lançamento já ocorreu na conta real.
