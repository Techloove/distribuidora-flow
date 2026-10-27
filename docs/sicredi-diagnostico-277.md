# Diagnóstico de falha na consulta automática — fase277 / versão1.3.4

O CSV(4) recebido contém9 pendências atuais da Ferragens com `CONSULTA_FALHOU`, boleto registrado e título aberto; todos têm responsável definido e ativo. Há também1 registro histórico com boleto liquidado e título pago. Esse registro não deve ser reprocessado. O arquivo original não foi incluído no repositório.

A rotina anterior descartava o motivo técnico da falha. O código recebido não permite determinar se houve recusa de autenticação, erro HTTP do banco, timeout, rede ou retorno inválido. A causa das nove falhas continua sem comprovação; esta entrega melhora a observação, sem afirmar que a falha bancária foi resolvida.

## Aplicação

1. No Supabase, execute somente `db/fase277_diagnostico_consulta_sicredi.sql`, inteiro. Não execute este guia como SQL.
2. Publique a versão1.3.4 no Lovable para atualizar o endpoint automático.
3. Aguarde a próxima consulta já prevista no agendamento. Erros usam a espera existente de30 minutos; a atualização não antecipa a fila nem exige permanecer na tela. O histórico de cada boleto mostra sua próxima consulta.
4. Execute novamente o arquivo atualizado `db/conferir_erros_sicredi_somente_leitura.sql` e envie o CSV. Agora inclui etapa, categoria e status HTTP. Sem diagnóstico novo, indica aguardar a próxima consulta após a atualização.

## Comportamento

- `token`: falha durante obtenção/cache do token; o HTTP, quando presente, é da autenticação bancária.
- `consulta`: falha no GET do boleto.
- Categorias: HTTP, timeout, rede, retorno inválido ou não identificada. São sinais técnicos; não substituem a análise da configuração e dos logs administrativos.
- Somente HTTP400–599 pode ser persistido. Não são guardados corpo da resposta, URL, senha, token, cabeçalhos ou mensagem de erro livre.
- O finalizador instalado é preservado; apenas a atualização da fila recebe o campo opcional filtrado. A migração aborta integralmente se não reconhecer uma única atualização da fila no corpo existente.
- As tentativas antigas não são preenchidas com causas presumidas. Em consultas posteriores sem falha técnica, o diagnóstico anterior é limpo. Boletos já liquidados continuam protegidos pelo finalizador original.

Não houve nova chamada real ao Sicredi durante o desenvolvimento. Não foram mudadas credenciais, convênios, agendamentos, prazos de espera, boletos, títulos ou valores. A migração não solicita consultas nem efetua baixa. O agendamento já existente continua com seu fluxo normal após a publicação.

## Validação

Testes com transporte simulado verificam registro de HTTP503 sem copiar a resposta privada, códigos seguros de token/consulta e tratamento de timeout/rede. O teste de banco compara o corpo do finalizador antes/depois removendo somente o novo trecho, testa reaplicação, filtragem de campos, recuperação e proteção de boleto pago sem nenhuma chamada de baixa.
