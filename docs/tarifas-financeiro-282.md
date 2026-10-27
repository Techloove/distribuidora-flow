# Tarifas automáticas no financeiro e DRE — fase282, versão 1.7.0

## Instalação e primeira configuração

1. Execute inteiro **somente** `db/fase282_tarifas_automaticas_financeiro.sql` no SQL Editor do Supabase. Não cole este guia no editor. Exige as fases279/280 instaladas.
2. Publique a versão **1.7.0** no Lovable.
3. Em **Boletos**, abra **Opções → Liquidação e tarifa**. Para boleto ainda não liquidado com tarifa retornada, use **Tarifas e financeiro**.
4. Valor, data e descrição vêm do retorno da API. Escolha a **conta financeira do Sicredi** e a categoria sugerida **Tarifas de emissão de boletos**, em **Despesas Financeiras**.
5. Confira a data inicial e os lançamentos anteriores. Marque a autorização e use **Salvar e contabilizar tarifas da loja**.

A instalação cria a categoria e estruturas de controle, mas não escolhe conta, não ativa configuração e não gera despesas. O clique de configuração autoriza contabilizar os retornos já recebidos **de toda a loja** desde a data inicial, além dos próximos retornos. O responsável precisa ter acesso financeiro à loja e a rotina de registro de tarifa; perfis limitados à carteira não configuram a loja inteira.

No boleto600000007, o CSV real confirmou R$1,63 em20/10/2026, descrição `TARIFA ENTRADA/LIQUIDACAO`. Se essa data estiver no período autorizado e não existir lançamento anterior ou outra pendência, a configuração processará esse retorno existente sem precisar consultar o banco novamente.

## Resultado financeiro

A rotina usa o motor financeiro existente para gerar uma **saída**, na conta e loja configuradas, na **data do débito retornada pelo banco**. A categoria deve ser de despesa e compor `despesa_financeira` no DRE, considerando também a categoria pai. Não é necessário novo lançamento em Contas a pagar, pois o débito bancário já ocorreu; criar outra obrigação duplicaria o custo.

Exemplo validado localmente: recebimentoR$100,00 preservado + despesaR$1,63 = saldo após esses movimentosR$98,37 e despesa financeira deR$1,63 no DRE. Não se altera o valor pago pelo cliente, juros, multa ou pedido de venda. Tarifas de emissão podem ser lançadas antes do pagamento do boleto.

O diálogo mostra o resultado por data, valor vinculado, conta e categoria. Os valores bancários deixam de depender de digitação manual. Uma conta do recebimento elegível é sugerida, mas a configuração precisa ser confirmada; não se escolhe conta de outra loja. Contas compartilhadas existentes continuam permitidas pelo motor financeiro.

## Automação e proteção contra duplicação

- Cada boleto e data de débito têm um vínculo financeiro único. As tarifas identificadas daquele dia são somadas em uma saída. Reconsultas não somam novamente nem recriam a saída.
- A contabilização ocorre quando a Francesinha salva/atualiza o retorno completo. Configurar a loja também processa os retornos que já estão no cache dentro do período autorizado.
- Apenas descrições identificadas como TARIFA pela integração são contabilizadas. Outros débitos permanecem para conferência.
- Uma tarifa manual da fase279 pode ser vinculada sem novo lançamento quando data, valor, conta, categoria e movimento ativo correspondem. Se não corresponder, fica para conferência.
- Uma saída avulsa ativa com mesma conta, loja, data e valor, sem vínculo conhecido com outro boleto, bloqueia um novo lançamento automático. É uma possível duplicidade, não uma confirmação de que se trata da mesma despesa. A conciliação deve ser feita pelo responsável financeiro.
- O formulário manual anterior é bloqueado quando já existe tarifa retornada pela API ou vínculo automático, inclusive em chamadas diretas à RPC.
- Alterar conta/categoria da configuração afeta somente os lançamentos ainda não efetuados e as próximas tarifas. Movimentos já lançados permanecem em sua conta/categoria original.
- Estorno, mudança de valor/descrição no retorno ou desaparecimento do retorno preservam o vínculo e exigem conferência. Não há estorno, ajuste ou relançamento automático nessas situações.
- Conta/categoria inativa, categoria fora de Despesas Financeiras ou responsável que perdeu o acesso deixam a despesa pendente. Uma falha no motor/auditoria reverte o lançamento inteiro e mantém o retorno bancário para análise.
- Pausar a configuração impede novos lançamentos; não desfaz despesas anteriores. A consulta bancária continua conforme a automação280.

O manual da Francesinha não fornece identificador único de cada débito. Por isso, a solução mantém o conjunto de tarifas por boleto/data e uma assinatura das descrições/valores. Não tenta interpretar uma alteração posterior como cobrança adicional sem conferência.

## Validação

Os testes executam o motor `lancar_movimento` e a seleção financeira real de `vw_dre_base` em banco local descartável. Verificam saldo/DRE, recebimento preservado, reconsulta, tarifa manual, possível despesa avulsa, emissão antes da liquidação, estorno, retorno divergente/ausente, configuração pausada/inválida, revogação de permissão, carteira/loja, bloqueio de escrita direta e rollback da auditoria. Não foram lançadas despesas reais nem feitas emissões/cancelamentos bancários nos testes.
