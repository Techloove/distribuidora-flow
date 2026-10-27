# Vistoria das regras de negócio — 27/10/2026

A vistoria local foi concluída sobre `main`, incorporando as alterações do Lovable até `ed722ba`. A entrega é a versão **1.3.3 / fase276**. Não houve acesso direto ao Supabase de produção, emissão fiscal, registro bancário, movimentação real de estoque ou alteração de dados reais.

**Resultado:** os cenários executados passaram; não foi reproduzida falha operacional de baixa ou geração financeira nesses cenários. Foram confirmadas e corrigidas inconsistências no diagnóstico administrativo e uma lacuna na execução automática dos testes de negócio. Isso não certifica que todos os dados reais ou todos os caminhos possíveis estejam sem falhas.

## O que foi conferido

| Fluxo | Evidência local e limites |
| --- | --- |
| Cadastro Unificado → clientes/fornecedores/representantes | Suítes de cadastro, carteira, primeiro acesso e configuração de representantes: vínculos, cadastros repetidos e permissões. O SQL de produção verifica funções marcadas sem vínculo especializado e duplicidades, sem corrigir registros. |
| Permissões por loja, módulo e carteira | Negação por outra loja/carteira, usuário inativo, rotina não liberada e anonimato nos cenários de acesso. As tabelas especializadas continuam necessárias; não foram fundidas nem apagadas. |
| Limites, desconto, margem e crédito | Testes dos motores por loja, aprovação de orçamentos e regras de produtos/ofertas. Os limites são independentes entre lojas; comissão por venda/recebimento e comissão já paga foram testadas nas suítes próprias. |
| Produtos ↔ preço normal do catálogo | Sincronização da fase275 em ambas as entradas, atualização por markup/custo, cópia privada inicial, rollback, permissões e preservação das promoções e dos itens já gravados. |
| Pedido/orçamento → itens, encargos e aprovação | Suítes de orçamento, aprovação, catálogo, prazos e frete: totais, descontos, acréscimos e despesas; orçamento não confirma venda nem baixa estoque. |
| Aprovação → reserva | Reserva da loja do pedido, rejeição de reserva acima do disponível, liberação ao sair da aprovação e bloqueio de consumo de outra loja. Permitir saída negativa não autoriza reservar mercadoria inexistente. |
| Confirmação → estoque da loja → depósito | Movimento real usando os motores SQL; quantidade global, saldo da loja e depósito confrontados. Confirmação repetida não duplica efeitos. Falha de saldo reverte a transação. |
| Compra recebida → entrada, custo e contas a pagar | Recebimento real, cálculo de total, entrada no depósito próprio, custo médio e preço por markup. Duas parcelas e repetição sem duplicidade no cenário integrado. |
| Confirmação → contas a receber | Valores das parcelas somam o total no cenário integrado; vencimentos20/40 conferidos; centro propagado e crédito aplicado testados nas suítes específicas. Uma baixa bancária/recebimento é etapa distinta da emissão de boleto. |
| Financeiro, crédito e comissão | Testes de encargos, títulos manuais, créditos/devoluções, centros, estorno/cancelamento, conciliação, comissão e histórico pago. Eles não comprovam conciliação do extrato real. |
| Separação → carga → entrega → recusa/devolução | Suítes de separação, capacidade, logística e entrega, inclusive retorno/avaria e bloqueios de transição. Regularização administrativa da fase269 altera somente o status: não cria estoque, títulos, nota ou comprovante. |
| Inventário, disponibilidade e reposição | Contagem/conferência, reservas, propriedade por categoria, renomeação da loja e acesso ao depósito. A política atual é estoque próprio por loja, não estoque compartilhado. |
| Fiscal, cobrança e backup | Testes com respostas simuladas e banco local, incluindo sigilo e idempotência. Não foi feita homologação real da Forecast/Sicredi nem restauração de um backup real. |

## Cenário integrado novo

O módulo `scripts/lib/check-fluxo-integrado276.cjs`, executado junto à regressão do estoque271, usa as funções SQL reais de recebimento, movimento físico, depósito, markup, recálculo do pedido, confirmação, parcelas e sincronização de preço.

1. Produto com10 unidades, custo5 e preço10 recebe compra de10 unidades a custo7: saldo20, custo médio6, preço12 e duas contas a pagar somando70.
2. Venda de3 unidades a12: saldo17 no produto, na loja e no depósito; outra loja permanece intacta; duas contas a receber somam36 e vencem em20/40 dias.
3. Repetir compra/confirmar pedido não duplica movimentos ou parcelas.
4. Alterar o catálogo para14 atualiza Produtos; o item da venda permanece12, os recebíveis permanecem36 e a promoção de8 permanece8.
5. Tentar vender1000 unidades sem permissão de negativo falha: pedido permanece rascunho, sem cobrança ou baixa parcial.

O resolvedor de comissão desse cenário é simulado para isolar estoque/preço/financeiro. As comissões reais são cobertas separadamente pelas suítes de rotinas e de parâmetros por loja. As demais suítes também usam fixtures e recortes de migrações; não equivalem a aplicar todas as migrações num clone do Supabase real.

## Problemas confirmados e correções

| Achado | Correção |
| --- | --- |
| A função administrativa `diagnostico_integridade_220` ainda usava o modelo compartilhado da fase226 | A fase276 compara saldo e reserva na própria loja e confronta produto, lojas e depósitos. |
| Consultas do diagnóstico executadas como SECURITY DEFINER não filtravam as primeiras contagens por loja | Todas as contagens da tela passam pelo escopo autorizado; pedidos/recusas respeitam também carteira quando aplicável. Usuário ativo e permissão de gestão são obrigatórios. |
| Saldo negativo explicitamente permitido podia aparecer como falha | Situação permitida tem classificação Operação; negativo proibido tem Atenção. Reservas acima do saldo continuam sendo problema distinto. |
| O diagnóstico não conferia a ligação recente entre preço, estoque e financeiro | Foram acrescentadas verificações de preço normal, reservas inválidas, títulos em outra loja, parcelas duplicadas e pedidos confirmados sem efeitos registrados. Regularização manual, cobertura integral por crédito e devoluções recebem tratamento próprio. |
| A CI não executava as suítes PGlite de regras de negócio | Adicionados PGlite0.3.14 como dependência de desenvolvimento, comando `bun run check:database` e execução das45 suítes na CI. Os testes são locais e descartáveis. |

Nenhum saldo, pedido, preço ou título foi corrigido automaticamente. Alertas identificam necessidade de revisão; não autorizam recompor estoque ou gerar cobranças duplicadas.

## Verificação executada

- Rodada inicial:54 verificações aprovadas —44 suítes locais de banco e10 comandos de qualidade/testes.
- Após as alterações:45/45 suítes de banco aprovadas, incluindo o fluxo integrado e o teste do diagnóstico276. Comando reproduzível: `bun install --frozen-lockfile` e `bun run check:database`.
- 165 testes unitários aprovados. TypeScript e compilação no modo Lovable aprovados.
- Guards SQL, ordem de migrações, superfície do cliente/servidor, versão/manual e testes sintéticos de backup aprovados.
- Lint sem erros; permanecem os9 avisos preexistentes de Fast Refresh.

## Conferir o Supabase real

Abra **`db/vistoria_integridade_276_somente_leitura.sql`**, copie somente o conteúdo SQL, cole em **Supabase → SQL Editor → New query** e execute. O arquivo é uma única consulta SELECT: não instala migrações nem altera dados. Execute com o responsável administrativo; não envie senhas, tokens, certificados ou chaves.

O resultado reúne ocorrências de negócio, vínculos cadastrais, limites, duplicidades de cobrança, presença das funções e gatilhos essenciais habilitados. Retorne a tabela de resultados, principalmente contagens maiores que zero. A consulta não prova a equivalência integral dos corpos de todas as funções instaladas e não substitui uma restauração/homologação real.

- **Atenção / Cadastros / Limites / Cobrança:** conferir origem e registros envolvidos antes de ajustar.
- **Revisar:** pode exigir análise de legado, crédito, devolução ou operação manual. Não é instrução de emitir cobrança ou repetir baixa.
- **Operação:** informação, como inventário aberto, retorno pendente ou negativo autorizado.
- **Pré-requisito / Gatilho:** um significa ausente/desabilitado. Não reaplique migrações antigas em massa: elas podem substituir motores mais recentes.
- **Atualização necessária:** um indica que o diagnóstico da tela ainda não recebeu a fase276; o arquivo de conferência já usa a consulta nova.

Para o diagnóstico atualizado aparecer dentro da aplicação, execute manualmente **somente `db/fase276_vistoria_integridade_por_loja.sql`**, inteiro, e publique a versão1.3.3 no Lovable. Esse segundo arquivo instala a correção da consulta administrativa e não altera dados comerciais. Este documento Markdown não deve ser executado como SQL.

## O que permanece sem comprovação em produção

É necessário receber o resultado do Supabase para afirmar se os dados existentes estão coerentes e se as migrações/índices/gatilhos necessários estão instalados. Preço que não chegou a ser salvo no banco não é recuperado por esta vistoria; o diagnóstico de26/10 continua disponível no arquivo de conferência de preços.

Forecast: homologação real ainda depende de credenciais por loja e de retorno real para validar autorização/protocolo/XML; produção permanece bloqueada. Sicredi: automação e liquidação reais dependem de credenciais, convênio, agendamentos e respostas bancárias. Backup: botão/fila não comprovam cópia externa; é preciso executor ativo, histórico de cópia verificada e restauração testada em ambiente separado.

## Resultado recebido do Supabase

Foi analisado o CSV `Supabase Snippet Untitled query.csv` enviado pelo responsável após executar a consulta: **44 verificações,42 zeradas e2 não zeradas**. O arquivo original não foi incluído no repositório.

As verificações de cadastro/vínculos, limites, preços normais sincronizados, reservas, estoque por loja/depósito, parcelas duplicadas, centro dos títulos, duplicidades de cobrança e presença/habilitação dos motores consultados retornaram zero ocorrências. Também não foram encontrados, no recorte da consulta, pedidos com confirmação auditada sem baixa registrada ou sem recebíveis/cobertura por crédito.

Os resultados não zerados foram:

- `Atualização necessária: diagnóstico da tela anterior à fase276 =1`: aplicar manualmente o SQL da fase276 para atualizar a consulta na tela. Isso não é uma divergência de preço, estoque ou financeiro.
- `Operação: estoque negativo permitido pelo cadastro =8`: existem oito posições produto/loja negativas com permissão explícita. Não são uma violação da regra configurada, mas precisam ser conferidas fisicamente e com o responsável pelo estoque. Não foram ajustadas automaticamente.

Para identificar os produtos e as lojas, executar **somente** `db/conferir_saldos_negativos_somente_leitura.sql`. A consulta lista quantidade negativa, permissão, reserva e soma dos depósitos. Depois da conferência, tratar entradas ou inventário pelo fluxo autorizado; não zerar saldos nem desativar a permissão indiscriminadamente para ocultar a ocorrência.

Esta evidência confirma a ausência de ocorrências nos critérios e no momento consultados. Não comprova a exatidão da contagem física, a integralidade de todos os valores financeiros, integrações externas ou cenários não cobertos pelas consultas/testes. Forecast/Sicredi reais e restauração do backup continuam com os limites descritos acima.

## Continuidade: origem dos oito saldos negativos

O responsável confirmou a execução bem-sucedida da fase276 e enviou a consulta detalhada dos negativos. São oito posições: uma em Cimento e sete em Ferragens. Em todas, o saldo da loja coincide com o saldo global do produto e com a soma dos depósitos; a permissão de negativo está ativa e a reserva é zero. Não foi identificado descompasso entre esses registros no arquivo recebido.

| Loja | Código | Produto | Saldo informado |
| --- | --- | --- | ---: |
| Cimento | 4 | CIMENTO CP3 CSN | -350 |
| Ferragens | 19 | ARAME LISO BWG12 | -20 |
| Ferragens | 2 | ARAME LISO BWG18 | -4000 |
| Ferragens | 20 | ARAME LISO BWM14 | -420 |
| Ferragens | 21 | GRAMPO POLIDO1"X9 | -20 |
| Ferragens | 17 | PREGO C/CABE16X24 | -160 |
| Ferragens | 40 | PREGO C/CABE17X21 | -360 |
| Ferragens | 32 | PREGO C/CABE25X72 | -220 |

Para investigar a causa, executar **`db/origem_saldos_negativos_somente_leitura.sql`** e exportar o resultado CSV. Não é migração e não muda o estado do sistema. A consulta parte das posições que estiverem negativas no momento da execução; a lista pode mudar se a operação continuar.

O resultado contém a unidade cadastrada, totais de entrada/saída/ajuste em todas as lojas, quantidade e datas dos movimentos, diferença entre o saldo global e o saldo calculado pelo histórico, compras pendentes, compras recebidas com entrada divergente e os últimos15 movimentos. Os totais usam o histórico completo acessível; os15 registros são apenas uma amostra recente. Não some quantidades de produtos com unidades diferentes.

A soma histórica é global por produto porque movimentos anteriores à fase271 podem pertencer à loja antiga; redistribuições internas de depósito não representam nova entrada de mercadoria. Diferença entre saldo atual e histórico não comprova falha: pode ser saldo inicial, legado ou histórico incompleto. Compra pendente não prova entrega física, e compra recebida divergente exige análise do documento e da auditoria antes de corrigir.

A consulta foi validada em PGlite com histórico em loja antiga, produto negativo sem histórico, compras pendentes/recebidas e produto positivo excluído. Os saldos permaneceram intactos. Não há mudança de versão da aplicação nesta etapa, pois a entrega acrescenta apenas consulta de investigação e documentação.

Permanece pendente o resultado dessa consulta e a contagem física dos produtos para decidir o tratamento operacional. Nenhum saldo foi zerado, nenhuma compra foi recebida novamente e nenhum lançamento financeiro foi criado para forçar a regularização.

## Encerramento da conferência central e pendências externas

O responsável esclareceu que a venda sem saldo foi autorizada intencionalmente pela opção Permite estoque negativo. Assim, a investigação adicional desses oito saldos não é requisito para encerrar a conferência das regras centrais. A consulta de origem permanece disponível caso apareça uma divergência futura, mas não precisa ser executada apenas por haver negativo permitido. Isso não substitui os inventários físicos rotineiros.

A conferência central disponível está concluída: testes locais e CSV do Supabase não apontaram divergências nos critérios consultados de cadastros, preços, reservas, saldos e vínculos financeiros. Não houve ajuste de dados. Restam evidências das rotinas externas, que não podem ser inferidas desses testes.

A próxima consulta é **`db/verificar_integracoes_backup_somente_leitura.sql`**, para o SQL Editor administrativo. Exportar o resultado CSV. Não é migração, não muda a versão da aplicação e não faz chamadas à Forecast/Sicredi nem inicia backup. Após a falha relatada abaixo, o arquivo foi substituído por um inventário de estruturas que funciona com tabelas ausentes.

A versão atual retorna presença de tabelas, colunas necessárias, funções e extensão de agendamento. Não lê registros comerciais ou credenciais, não executa as funções verificadas e não retorna tokens, segredos, certificados, conteúdo fiscal ou caminhos privados. O levantamento de estados, contagens e datas de execução depende primeiro de identificar as estruturas instaladas.

Interpretação:

- Backup sem sucesso registrado continua sem comprovação de execução. Uma execução recente com sucesso é evidência do executor, mas o destino externo e a restauração devem ser conferidos no host administrativo. O cron do banco não executa o backup em host Linux.
- Forecast com credencial cadastrada não equivale a conexão ou homologação aprovada. Zero tentativas/autorizações/XML indica ausência desses registros, não autoriza emitir notas para testar. A emissão de produção continua bloqueada pelo fluxo implementado.
- Sicredi marcado ativo sem última chamada/consulta não comprova automação em funcionamento. Boletos com estado liquidado no banco não comprovam isoladamente a origem automática da baixa nem conciliação com extrato. Zero boletos registrados pode simplesmente significar ausência de cobranças naquele ambiente/canal.
- A extensão pg_cron instalada não comprova que o agendamento está ativo ou que o endpoint funciona. Não foram consultados comandos de jobs, pois podem conter segredos de transporte.

Depois do inventário, será possível preparar as consultas de execução apenas para as estruturas efetivamente presentes; o inventário sozinho não distingue ausência de uso e execução registrada. Teste real de restauração e homologações externas dependem da infraestrutura e do ambiente de testes apropriado; não serão simulados como sucesso com base apenas na existência dos botões.


## Estrutura de homologação Forecast ausente no banco real

O responsável recebeu `42P01: relation public.forecast_homologacoes_266 does not exist` ao executar a primeira consulta externa. Isso confirma ausência dessa tabela naquele banco; não prova, isoladamente, que toda a fase266 está ausente ou que as demais integrações estejam instaladas. A primeira consulta pressupunha uma implantação completa e foi corrigida.

O arquivo `db/verificar_integracoes_backup_somente_leitura.sql` agora usa apenas catálogos do PostgreSQL, `to_regclass` e `to_regprocedure`. Retorna AUSENTE, INCOMPLETA ou PRESENTE para estruturas esperadas. Mesmo tabelas opcionais inexistentes não são referenciadas diretamente. O teste local cobriu banco sem integrações, implantação parcial, colunas faltantes e uma função que lançaria erro caso fosse executada; o inventário não a chamou.

A implantação/homologação Forecast permanece pendente de conferência. Não instalar tabelas isoladas nem reaplicar fases antigas em massa: após receber o inventário, revisar os pré-requisitos e preparar somente a implantação necessária preservando as funções atuais. Nenhuma estrutura, credencial, nota, boleto, estoque ou título foi alterado por esta correção de consulta.

## Inventário externo recebido

O CSV `Supabase Snippet Untitled query (2).csv` contém20 objetos verificados:14 presentes e6 ausentes. O arquivo original não foi incluído no repositório.

- Backup: fila/histórico e quatro funções esperadas presentes. Não comprova configuração do host, execução ou restauração.
- Sicredi: tabela de boletos, configuração/fila automáticas e funções de acompanhamento/disparo presentes. Não comprova chamada ao banco ou liquidação automática.
- Forecast: tabela de credenciais e função de estado da conexão262 presentes. Isso não comprova que exista uma credencial preenchida/válida.
- Forecast266: liberação, tentativas de homologação e funções de estado/consulta verificadas ausentes.
- Forecast267: tabela de documentos e função de listagem verificadas ausentes.
- pg_cron presente; jobs ativos e execução não foram comprovados.

A continuação usa **`db/conferir_execucao_integracoes_somente_leitura.sql`**, exportando CSV. A consulta lê apenas as tabelas confirmadas presentes, sem referenciar homologação266/267. Mostra execuções de backup, atividade Sicredi e estado da conexão262; verifica por metadados a prévia265, a configuração fiscal256, o vínculo261 e a coluna legada que bloquearia a prévia. Não chama funções de emissão, banco ou backup e não retorna credenciais.

A consulta foi validada num banco local sem as fases265/266/267, com backup pendente, automação sem chamada registrada e conexão262 presente. Não é migração e não exige publicação. A sequência de implantação da homologação será definida após conferir esses pré-requisitos; não há recomendação de reaplicar fases antigas indiscriminadamente.

## Estado de execução recebido — CSV(3)

O responsável enviou `Supabase Snippet Untitled query (3).csv`. Não foi incluído o arquivo original no repositório.

- Backup: zero registros de cópia concluída/verificada, zero solicitações pendentes, em execução ou com falha nos últimos7 dias. Não há comprovação de backup no histórico da aplicação; isso não exclui uma cópia externa feita fora da fila. É necessário confirmar se o executor/host foi instalado e validar restauração em ambiente isolado.
- Forecast Cimento/Ferragens: sem credenciais e sem ambiente declarado. A prévia265, configuração fiscal256 e vínculo261 estão presentes; a coluna legada `faznotas_estado` não existe. Combinado ao inventário anterior, faltam os componentes266/267 verificados e a configuração da conexão por loja.
- Sicredi Ferragens:40 boletos API de produção com estado registrado e1 com estado liquidado. Cimento:zero nesses estados/canal. Não comprova, isoladamente, se a liquidação foi automática nem se está conciliada com extrato.
- Automação Sicredi marcada ativa: última chamada aceita27/10/2026 às11:05:04 e última consulta concluída na rotina às11:05:10, horário de Brasília. Existem9 linhas da fila com erro. Essa contagem bruta pode incluir histórico; exige classificar os estados atuais antes de tratar como nove falhas abertas.

A prioridade de investigação é **`db/conferir_erros_sicredi_somente_leitura.sql`**. Exportar CSV. A consulta usa a mesma condição do painel para pendência atual, distingue histórico e retorna somente códigos de erro conhecidos, estado de boleto/título, indicação de responsável ativo e datas. Mensagem desconhecida é ocultada. Não consulta o banco Sicredi e não refaz emissão, cobrança ou baixa.

O teste local cobriu erro ativo de consulta, erro histórico em boleto liquidado, retorno divergente em boleto cancelado e ocultação de mensagem desconhecida. Não houve mudança de estado dos boletos.

Para a implantação fiscal, os pré-requisitos verificados permitem preparar a sequência das fases faltantes: executar manualmente `db/fase266_envio_homologacao_forecast.sql` e depois `db/fase267_documentos_homologacao_forecast.sql`, completos. Não é necessário reaplicar265 ou outras fases antigas com base nesse resultado. Esses scripts não transmitem notas e não habilitam homologação automaticamente. O código correspondente já existe no repositório. A configuração de tokens de homologação deve ser feita dentro do sistema, por loja/CNPJ, nunca enviada por chat. Homologação externa ainda requer validar o contrato/retorno da Forecast; produção permanece bloqueada.

## Classificação das pendências Sicredi — CSV(4)

O arquivo recebido contém10 linhas:9 pendências atuais de Ferragens e1 histórico. Todas têm `CONSULTA_FALHOU`; nos nove casos atuais, boleto está registrado, título aberto e responsável definido/ativo. O histórico tem boleto liquidado e título pago e não deve ser reprocessado. O arquivo original não foi incluído no repositório.

O código atual permitiu concluir que a consulta falhou antes de obter um retorno tratável, mas descartava a etapa e o detalhe HTTP. Não há evidência suficiente para atribuir a causa a senha, token, permissão bancária, indisponibilidade ou rede. O cadastro do responsável ativo não comprova a validade das credenciais bancárias.

Foi preparada a versão1.3.4 / fase277, descrita em `docs/sicredi-diagnostico-277.md`: acrescenta somente diagnóstico técnico filtrado às próximas tentativas e preserva o corpo do finalizador instalado. Não limpa as pendências antigas nem afirma resolver o acesso bancário. A causa deve ser analisada após a próxima consulta do agendamento.

Aplicar manualmente `db/fase277_diagnostico_consulta_sicredi.sql`, publicar1.3.4 e, após a próxima tentativa prevista, executar a versão atualizada de `db/conferir_erros_sicredi_somente_leitura.sql`. Boleto histórico pago não precisa de nova tentativa. Nenhuma cobrança/baixa real foi acionada durante esta entrega.

Validação:168 testes unitários,46 suítes de banco, verificação de tipos e compilação Lovable aprovados. A regressão nova verifica que o corpo do finalizador é preservado salvo a atribuição do diagnóstico, que campos livres são descartados, permissões de execução são mantidas e uma função incompatível aborta toda a migração. Não houve erro de lint; permanecem os9 avisos anteriores de Fast Refresh.
