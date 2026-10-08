# Revisão do sistema — 08/10/2026

A revisão encontrou e corrigiu falhas. Não equivale a certificar que todo caminho possível está livre de bugs: os testes usaram ambiente local e dados sintéticos. Não houve acesso às credenciais/projeto Supabase de produção nem chamadas reais ao Sicredi. Nenhuma das novas sugestões de funcionalidades foi implementada nesta revisão.

## Correções

| Problema confirmado                                                                           | Resultado                                                                                         |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Cadastro público reapareceu no login, contrariando o guard e o fluxo administrativo           | Login somente para contas existentes; criação continua em Usuários e papéis                       |
| Saldo global usado quando não existia saldo no centro selecionado                             | Estoque usa saldos por centro; ausência equivale a zero; Todos soma apenas os saldos acessíveis   |
| Falha/carregamento dos saldos podia ser apresentado como dado válido                          | Tela aguarda a consulta e exibe o erro, sem substituir por saldo global                           |
| Cartões de receber/pagar ignoravam o centro da listagem                                       | Totais respeitam o centro escolhido no filtro                                                     |
| Parcelas `vencido_parcial` sumiam nos filtros de vencidos/parciais                            | São incluídas nos dois filtros pertinentes                                                        |
| Saldos e filtros monetários ignoravam encargos/descontos                                      | Usam saldo calculado pela view; fallback inclui juros, multa, acréscimos e descontos              |
| Títulos selecionados continuavam na baixa em lote após desaparecer dos filtros                | A operação usa apenas títulos visíveis e não pagos/cancelados                                     |
| Fluxo de caixa ignorava centro e encargos                                                     | View agrupa por centro e inclui encargos no saldo previsto; frontend aplica seleção global        |
| Datas UTC/local podiam deslocar dia comercial ou prévia das parcelas                          | Pedidos/compras/títulos usam dia de São Paulo; parcelas usam calendário sem deslocamento por fuso |
| Consultas com formatos diferentes compartilhavam cache                                        | Chaves distintas para dados de produtos, centros e representantes nas telas afetadas              |
| Telas antigas de fornecedores/transportadoras editavam cópias separadas do cadastro unificado | Links antigos redirecionam ao cadastro único, preservando tabelas/FKs/dados especializados        |
| Lint e CI falhavam                                                                            | Corrigidos escape de regex CNAB e tipo de função no teste; dependências dos hooks revisadas       |
| Mensagem genérica de falha financeira orientava reaplicar SQL antigo                          | Orientação passa a verificar acesso/versão em vez de reinstalar migração antiga                   |

## Duplicidades

Cadastro unificado é a entrada para pessoas, clientes, representantes, fornecedores e transportadoras. Tabelas especializadas continuam necessárias às FKs e à sincronização: não devem ser apagadas ou fundidas cegamente.

`/faturamento` redireciona para `/boletos`; não existe segundo menu de emissão. Contas a receber/pedidos usam os mesmos componentes de emissão/alteração. Configuração CNAB e sequência compartilhadas dos centros continuam preservadas.

Lead Rota (oportunidades por produto), Clientes sem comprar (análise de inatividade) e Agenda comercial (registro de contatos) são complementares. Comissões, gestão de pagamento e cadastro de regras/faixas também têm finalidades distintas. Conciliação de créditos de clientes não é conciliação de extrato bancário. Nenhuma dessas rotinas foi removida por semelhança de nome.

Migrações históricas redefinem funções e algumas fases têm números repetidos; o verificador de ordem identifica os arquivos esperados. Isso não comprova que o projeto real recebeu todos os arquivos. Não reaplicar indiscriminadamente fases antigas, pois podem substituir versões mais recentes.

## Verificação

- 53 testes unitários passaram. TypeScript, build e guards SQL/migrações/cliente/servidor passaram. Lint sem erros; permanecem nove avisos de Fast Refresh em arquivos que exportam componentes e helpers (não são falhas de operação).
- PGlite: carteiras e papéis combinados; CNAB e sequências compartilhadas; confirmação/cancelamento de pedido/devolução, crédito, comissão, entrega, capacidade, conciliação, auditabilidade e reaplicação.
- Novo teste de banco `scripts/check-auditoria-database.cjs`: migração210 aplicada duas vezes sobre view original, dependência preservada, encargos, centros, RLS, anonimato bloqueado e calendário São Paulo; recebimento de compra com motor de estoque real, parcelas somando o total, repetição sem duplicidade e rollback por saldo insuficiente.
- Navegador: abertura de 51 rotas autenticadas com dados sintéticos sem exceção JavaScript, aliases e login/visitante; isso valida renderização, não cada operação de cada módulo.
- Interações nas rotinas novas, painéis por perfil, conferência de pedido, histórico financeiro e telas móveis. Testes adicionais cobrem os erros de saldo/centro e seleção em lote corrigidos nesta revisão.

## Pendências do ambiente real e limites

1. Aplicar a fase209, se ainda não foi aplicada, e depois todo o arquivo `db/fase210_correcao_fluxo_caixa_centros.sql` no Supabase. A fase210 altera views; não reescreve pagamentos, saldos, custos ou sequências. Recarregar o sistema ao concluir.
2. Executar opcionalmente `db/diagnostico_integridade_somente_leitura.sql` no SQL Editor com acesso administrativo para investigar dados reais: documentos repetidos, duplicidade de títulos/boletos ativos, centros divergentes, saldos negativos/legados, constraints e perímetro. Só SELECTs em transação read-only; amostras de até 100 grupos. Não efetua reparação automática.
3. Conferir no Supabase Auth se criação pública de contas está desabilitada. Remover botão do login não altera a configuração do provedor nem bloqueia chamadas diretas à API Auth; novos usuários seguem o processo administrativo.
4. Testar emissão/retorno/alteração de vencimento com a cooperativa no ambiente de homologação. Testes locais não substituem homologação bancária e não demonstram que webhooks/jobs estão instalados.
5. Algumas listagens antigas ainda consultam conjuntos sem paginação completa. Volumes acima do limite de resposta do PostgREST podem deixar buscas/indicadores locais incompletos. Modernização de paginação e agregações deve ser feita por módulo, com testes de volume; esta revisão não comprova capacidade para milhares de registros nem resolveu todas essas telas.
6. Autorização por menu e autorização por papel/RPC são controles distintos: liberar menu a um papel não concede automaticamente operações. Testes de acesso local passaram, mas permissões customizadas de cada usuário real precisam ser conferidas.

Não apagar duplicatas ou corrigir saldo global diretamente com base no diagnóstico: cada diferença precisa ser reconciliada com seus documentos/movimentos de origem.
