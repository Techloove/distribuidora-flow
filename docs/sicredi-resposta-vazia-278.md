# Consulta automática Sicredi e resposta vazia — fase278 / versão1.3.5

O inventário do cache recebido no CSV(6) confirmou tabela e colunas presentes, RLS ativa, permissões necessárias da service_role e duas RPCs com nomes de parâmetros e retornos compatíveis. A conclusão do token retorna `void`.

Foi encontrado um defeito reproduzível no adaptador RPC da consulta automática: ele usava `res.json()` em todo sucesso. A RPC `sicredi_token_concluir_224` pode responder HTTP204 sem corpo. A leitura de JSON vazio lançava erro depois da gravação do token; o fluxo classificava a tentativa como `token / nao_identificada` e não chegava ao GET do boleto. O adaptador da consulta manual já tratava corpo vazio.

A versão1.3.5 lê o corpo da resposta, retorna null quando vazio e interpreta JSON apenas quando existe conteúdo. Respostas HTTP de erro continuam rejeitadas. Não há mudança nas credenciais, nas regras de liquidação, nos prazos da fila ou nos valores dos boletos/títulos.

## Aplicação

**Não precisa executar SQL novo.** Publique a versão1.3.5 no Lovable. Mantenha a fase277 já aplicada.

Aguarde as próximas tentativas previstas pelo agendamento. Falhas anteriores usam o intervalo existente de30 minutos; publicar não antecipa consultas nem exige reemitir boletos. Depois execute `db/conferir_erros_sicredi_somente_leitura.sql` e envie o CSV. Se uma consulta completar sem falha, a rotina atualiza/limpa seu erro anterior. O histórico já pago não precisa ser reprocessado.

O defeito de software está confirmado em teste e é compatível com o sintoma recebido. A recuperação das consultas no ambiente real ainda depende de observar a próxima execução. Outras recusas bancárias, se ocorrerem, continuam identificadas pelo diagnóstico277. Um estado registrado não significa pagamento: somente retorno válido de liquidação passa pelo finalizador existente.

## Validação

O teste do endpoint com transporte simulado autenticou, retornou sucesso vazio na gravação do token e respondeu boleto registrado na consulta GET. Falhou antes da correção (`consultados=0`) e passou depois (`consultados=1`, `processados=0`). Foram cobertos tanto HTTP204 quanto HTTP200 com corpo vazio, sem segunda autenticação, sem repetir a conclusão e sem emissão/baixa de boleto. Não foram feitas chamadas reais ao banco.
