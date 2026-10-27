# Conferir a tarifa do boleto600000007

Não há nova versão do aplicativo nem migração nesta investigação. O ambiente de desenvolvimento não possui acesso autenticado ao banco de produção. Os arquivos abaixo são para execução manual no Supabase, usando a integração privada já instalada na fase280.

1. Com a versão1.5.0 ou superior publicada, execute inteiro `db/consultar_tarifas_boleto_600000007.sql`. Ele prioriza as datas desde a emissão do boleto até hoje, limitadas a31 datas, e solicita uma consulta pela integração. Não limpa reservas/erros, não ativa automação pausada nem altera convênio, boleto, título ou lançamento financeiro.
2. Aguarde1–2 minutos e execute `db/conferir_tarifas_boleto_600000007_somente_leitura.sql`. Esse segundo arquivo apenas lê os resultados. Exporte o resultado para análise, sem enviar credenciais.

A Francesinha consulta movimentos por data, não oferece filtro documentado de nosso número. A integração atualiza os boletos reconhecidos do convênio para cada data; o relatório separa somente o boleto600000007. A primeira data priorizada é a emissão. Em27/10/2026, o período informado de emissão em20/10 abrange oito datas: a primeira tem disparo imediato e as demais seguem a cada15 minutos, podendo levar aproximadamente duas horas se não houver falhas ou reservas em andamento.

`RETORNO_DISPONIVEL` permite conferir valor e descrição originais. `CONSULTADO_SEM_DEBITOS_VINCULADOS` não comprova isenção nem ausência de cobrança no Internet Banking. Em `FALHA_NA_CONSULTA`, os dados salvos anteriormente são preservados. Datas aguardando consulta ainda não têm resultado conclusivo.

A data de emissão/liquidação20/10 não prova que a tarifa foi debitada nesse mesmo dia. Não se pressupõe que o valor1,63 esteja presente na API e nenhum lançamento desse valor é criado por esses arquivos.
