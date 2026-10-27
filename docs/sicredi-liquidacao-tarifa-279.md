# Sicredi: liquidação e tarifa de cobrança — versão 1.4.0

## Instalação

1. Execute **somente** o arquivo `db/fase279_tarifa_cobranca_sicredi.sql`, inteiro, no SQL Editor do Supabase. Não cole este manual no editor SQL. A instalação não gera despesas nem altera recebimentos existentes.
2. Publique a versão 1.4.0 no Lovable.
3. Em **Boletos**, filtre os liquidados e abra **Liquidação e tarifa** em um boleto Sicredi emitido pela API.

## Como conferir

A tela apresenta juros, multa, desconto, abatimento e total recebido disponíveis no retorno bancário salvo. Dados ausentes aparecem como “Não informado”. Os acréscimos não são calculados novamente: o motor existente valida o retorno e liquida o título com o total recebido.

A imagem fornecida pelo usuário mostra **Tarifa de Cobrança de R$ 1,63** e **Tarifa de Baixa de R$ 0,00**. Isso comprova uma cobrança daquele boleto, mas não define tarifa fixa para os demais nem comprova um campo correspondente na API.

Para registrar a tarifa, confira primeiro o débito no extrato e procure lançamentos anteriores no financeiro. Informe valor efetivamente cobrado, data do débito, categoria de despesa e identificação no extrato. Marque a confirmação e registre. A data pode ser anterior à liquidação, pois a cobrança pode ocorrer antes do pagamento.

O sistema gera uma saída na mesma conta e loja do recebimento, vinculada ao boleto, com auditoria. O valor pago pelo cliente permanece intacto. Por exemplo, um recebimento de R$ 107,00 com tarifa de R$ 1,63 resulta em R$ 105,37 após essa despesa. Essa conta não comprova a forma ou data do crédito bancário.

## Proteções e limites

- Exige permissão financeira, rotina de registro, acesso à loja e carteira. A nova rotina é concedida inicialmente aos perfis admin, gestor e financeiro que já possuem acesso a Boletos.
- Aceita boleto API Sicredi de produção já liquidado, com título pago e conta financeira válida. Nenhuma chamada ao banco é feita por esta rotina.
- Há uma tarifa de cobrança vinculada por boleto. Repetir o mesmo registro não duplica a despesa; divergências são bloqueadas.
- Uma tarifa já lançada manualmente por outra tela não pode ser identificada automaticamente. Não a registre novamente.
- Se o movimento for estornado, o histórico fica preservado e exige conciliação no financeiro antes de qualquer novo lançamento.
- A captura automática da tarifa pela API ainda depende de confirmar o campo no contrato ou em um retorno real sem credenciais. Nesta versão, o registro é manual, com conferência do extrato. Não se presume tarifa zero quando o retorno não a informa.

Os testes usam banco local isolado e respostas simuladas, sem emitir boletos, notas ou lançar despesas reais.
