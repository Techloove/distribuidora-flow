# Compras unificadas — fase231

Execute `db/fase231_compras_unificadas.sql` integralmente no SQL Editor do Supabase, após a fase230. Depois atualize o sistema com Ctrl+F5.

O menu **Compras** reúne:

- **Compras e entradas:** cadastro e acompanhamento das compras, itens, recebimento, custos, parcelas e importação conferida de XML. Reutiliza integralmente DocumentoPage e ImportarCompraXml; não emite nota fiscal.
- **Planejamento e reposição:** reposição inteligente e sugestões existentes por produto, estoque compartilhado, estoque mínimo, vendas30/60/90 dias, pedidos pendentes e mercadorias em trânsito; preserva os filtros, identificação por código e impressão. As leituras da sugestão e dos atributos dos produtos agora percorrem páginas ordenadas, sem truncar em1000 produtos.

`/planejamento-compras` redireciona para `/compras?aba=planejamento`. A aba fica no endereço e suporta atualização/compartilhamento. Se um papel só possuir uma das rotinas, a tela abre a aba permitida. Um único título e item lateral, sem sobreposição de layouts.

## Acessos

Duas ações no módulo Compras, configuráveis em Usuários e papéis:

- `compras_operar`: consulta e operação de compras/entradas; na primeira aplicação recebe os papéis que já tinham o menu `/compras`.
- `compras_planejar`: planejamento e reposição; recebe os papéis que já tinham `/planejamento-compras`.

Os menus são reunidos após copiar as ações. Reaplicar não restaura ações revogadas. Administradores e gestores continuam sob o acesso total já existente. `reposicao_ver` e `compra_xml_importar` continuam como autorizações adicionais; o XML também exige a ação de operação de compras. Os motores existentes continuam exigindo suas capacidades operacionais (estoque/financeiro), centro e situação do documento.

A migração acrescenta um guard de `compras_operar` nas RPCs de criar/editar/cancelar compras, criar/editar/excluir itens, marcar como comprada, receber e importar XML, usando as definições atualmente instaladas. Não substitui os cálculos nem as transações dos motores. PUBLIC/anon permanecem sem execução.

As views de planejamento continuam SECURITY INVOKER e ganham condição de `compras_planejar`, conservando as restrições existentes de centro/carteira. As políticas das tabelas de compras não são ampliadas ou removidas: o planejamento ainda consegue calcular o trânsito com as leituras que já possuía. O editor de acesso normaliza o endereço antigo e conserva os aliases de Agenda Comercial e Relatórios de Vendas.

Não altera documentos, saldos, valores de custo, títulos a pagar, configurações Sicredi ou dados fiscais. Os efeitos de estoque e financeiro ocorrem no recebimento existente da compra.

## Validação local

`NODE_PATH=/workspace/.onboarding-tools/node_modules node scripts/check-compras-unificadas-database.cjs` verifica a migração e reaplicação em PostgreSQL/PGlite, com o controle real211 e os motores reais109/111: concessão separada dos antigos menus, planejamento sem operação, compras sem planejamento, CRUD/centro/status preservados, revogações, usuário inativo e anônimo. O recebimento usa uma função sentinela para testar somente o novo guard; não simula efeitos financeiros/estoque de produção. A importação XML mantém o motor218 e continua protegida por suas validações.

A interface foi conferida em Chromium com dados de teste: redirect, item/título únicos, abas, filtros do planejamento, código do produto, modal Nova compra, disponibilidade do XML, perfis com apenas uma rotina, atualização de página e celular de390px sem transbordamento horizontal. Compilação e TypeScript aprovados, 91 testes aprovados; lint sem erros, com os avisos React Refresh já existentes. Nenhuma consulta ou alteração foi executada no Supabase de produção.
