# Boletos e tarifas pela API — fase 280, versão 1.5.0

## Instalação

1. Execute inteiro **somente** `db/fase 280_tarifas_api_sicredi.sql` no SQL Editor do Supabase. Não cole este manual no editor SQL.
2. Publique a versão **1.5.0** no Lovable.
3. Abra **Boletos**. A lista apresenta emissão, vencimento, liquidação, valores e tarifas. Em **Opções**, ficam os botões, a linha digitável e os débitos retornados pelo Sicredi.

A fase 280 exige a automação da fase 247 e o perímetro Sicredi existente. A fase 279 anterior continua responsável pelo registro manual de uma despesa de cobrança e sua exibição. A instalação da fase 280 não gera despesas, recebimentos, baixas ou emissões.

Manual analisado (SHA-256 do PDF): `51d3cdb98ce84f374f9fdc89ad9f6ad443ec7645d30497b65ff22850d42370b9`.

## Lista e filtros

Há seleção por cliente e filtros combináveis por emissão, vencimento e liquidação, além de busca, situação e valores. Datas inicial/final são inclusivas; período de liquidação exclui boletos sem data de liquidação. Intervalos invertidos exibem aviso. Limpar remove os filtros. Os totais correspondem aos resultados filtrados.

As consultas percorrem páginas para evitar o limite padrão de resultados do Supabase. O cache identifica usuário e loja. Clientes disponíveis no seletor são os dos boletos visíveis na loja; as permissões por loja e carteira permanecem no banco.

## Contrato confirmado no manual fornecido

O arquivo enviado é o **Manual API da Cobrança 3.9.1**, datado de 11/11/2025.

- Seção 7.18, p.156: a consulta por nosso número retorna `dadosLiquidacao` com data, valor, juros, multa, desconto e abatimento. Esse grupo não contém tarifa.
- Seção 7.21, p.178–185: **Movimentações financeiras (Francesinha)** fornece créditos/débitos com nosso número, agência, posto, beneficiário, data do lançamento, descrição e valor do movimento.
- Endpoint de produção, p.183: `GET /cobranca/v1/cobranca-financeiro/movimentacoes/`.
- A implementação usa os parâmetros `codigoBeneficiario`, `cooperativa`, `posto`, `dataLancamento`, `tipoMovimento=DEBITO` e `pagina`, conforme a seção REQUEST e o exemplo Postman. Cabeçalhos privados: Authorization e x-api-key; Content-Type conforme o manual.
- A tabela de entrada e a mensagem de validação, p.179/182, especificam a data DD/MM/YYYY; a imagem do Postman usa hífens. O código começa com barras e, somente diante de HTTP400, tenta uma vez o formato com hífens documentado no exemplo, sem alterar a data consultada. Não repete recusas de autenticação ou limite de chamadas. Na saída aceita YYYY-MM-DD do exemplo e YYYY/MM/DD do quadro. O primeiro retorno real continua sujeito à conferência, sem emitir nada.
- O resultado usa `resultado`, `total`, `pagina` e `totalPaginas`. Todas as páginas e o total são validados antes de salvar.

O manual não enumera as descrições dos débitos nem apresenta exemplo específico de tarifa. A rotina guarda a descrição recebida e soma como tarifa somente os débitos que contêm a palavra **TARIFA**. Outros débitos ficam identificados para conferência, sem classificação presumida. Não deduz custo pela diferença entre valor nominal e recebido e não fixa R$1,63 para todos os boletos.

## Funcionamento automático

Um novo agendamento, `sicredi-tarifas-api-280`, chama `/api/sicredi/tarifas` a cada 15 minutos, com o segredo privado já existente na automação 247. Ele é independente do processamento da liquidação e continua com o navegador fechado. Respeita o estado ativo/pausado da automação Sicredi.

Cada execução consulta uma data, a partir da primeira emissão do convênio e limitada aos 90 dias anteriores mais o dia atual. O histórico inicial é preenchido gradualmente, começando pelas datas mais recentes. Datas dos últimos sete dias são reconsultadas a cada seis horas; as demais, semanalmente. Falhas são reagendadas após uma hora, sem apagar o último resultado completo. Reservas impedem concorrência e expiram em três minutos.

O vínculo considera convênio completo e nosso número. Ambiguidade entre boletos bloqueia a gravação do dia. O gravador exige serviço privado, reserva válida e responsável administrativo ativo com acesso financeiro à loja. O resultado visível respeita usuário ativo, acesso financeiro, loja e carteira.

O manual não fornece identificador único dos movimentos. Para evitar duplicação em reconsultas, a rotina substitui o conjunto completo de cada dia; não acrescenta novamente o que já foi lido. Linhas distintas retornadas pelo banco são preservadas, inclusive débitos de mesmo valor.

A lista atualiza o cache visível a cada minuto e mostra acompanhamento da consulta. Uma tarifa identificada aparece como **API Sicredi**. O detalhe apresenta a data do lançamento e a descrição original. Sem retorno confirmado, não presume tarifa zero.

## Financeiro e limites

A captura automática é de **consulta e exibição**. Ela não gera despesas automaticamente, não altera títulos nem os valores recebidos. O registro manual da fase 279 permanece separado: se houver tarifa pela API e despesa já registrada, a lista mostra as duas informações sem somar os valores como se fossem duas tarifas.

A descrição e a data efetivas da tarifa do boleto de R$1,63 ainda precisam ser conferidas após implantação. Uma taxa exibida no Internet Banking não garante que o mesmo lançamento será disponibilizado por essa API; o sistema informa ausência ou falha sem inventar o valor. Débitos com descrições abreviadas sem a palavra TARIFA ficam para conferência. Datas anteriores à janela de 90 dias não são buscadas automaticamente nesta fase.

## Validação

Testes usam respostas simuladas e banco PostgreSQL local descartável. Cobrem filtros combinados, datas, paginação completa/incompleta, convênio divergente, descarte de dados pessoais/credenciais, cache idempotente, falha preservando histórico, ambiguidade, loja/carteira, permissões, segredo e reserva. Foram preservadas as rotinas existentes de liquidação e despesa. Não foram feitas chamadas bancárias reais, emissões ou alterações de dados de produção.
