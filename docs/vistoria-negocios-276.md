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
