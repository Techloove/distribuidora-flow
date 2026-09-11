# Módulo Financeiro completo e integrado

Analisei o sistema atual antes de propor. O que já existe e será **reaproveitado sem duplicar**:

- Cadastros: pessoas (cliente/fornecedor/representante/transportadora), produtos (com custo médio, último custo, custo de reposição, markup, margem mínima), centros de custo, empresas, rotas, formas de pagamento, vendedores.
- Documentos: pedidos + itens, compras/NF de entrada, notas de saída, devoluções, expedições, boletos Sicredi, comissões.
- Financeiro atual: `contas_receber` e `contas_pagar` (simples: valor, valor pago, vencimento, status) + fluxo de caixa básico.
- Permissões: papéis, menus por perfil, acesso por centro de custo, regras de segurança no banco.

O que **não existe** e será criado: contas de banco/caixa, movimentações financeiras com saldo auditável, transferências, categorias/subcategorias de despesa, despesas de rota com parâmetros de custo, DRE, análise de rentabilidade, dashboard financeiro e exportações.

Entrego em 5 etapas incrementais, cada uma funcionando por si, sem quebrar nada do que já roda.

## Etapa 1 — Base financeira

- **Contas financeiras** (banco, caixa, conta corrente, poupança, conta de pagamento, outros) com nome, banco, agência, conta, saldo inicial + data, centro de custo e situação.
- **Movimentações financeiras**: toda entrada, saída e transferência com origem obrigatória (recebimento, pagamento, transferência, ajuste), vínculo ao título, à conta e ao centro de custo. Saldo da conta é sempre somado a partir das movimentações — nunca um número guardado à mão, então dá auditoria linha a linha.
- **Transferência entre contas**: movimenta as duas contas e é marcada para ficar fora do resultado (DRE).
- **Categorias e subcategorias** de despesa/receita em dois níveis, com ordenação, categoria padrão por tipo de lançamento e inativação (nunca exclusão quando já houver movimento).
- **Extrato por conta**: saldo inicial, entradas, saídas, transferências, saldo atual.

## Etapa 2 — Contas a Receber e a Pagar aprimorados

Campos novos nos títulos existentes (preservando todos os registros atuais): data de emissão, desconto, acréscimo, juros, multa, forma de pagamento, conta de banco/caixa, categoria/subcategoria (a pagar), descrição, número do documento. Status ganha "vencido" calculado e "pago parcialmente".

- Recebimento/pagamento passa a exigir conta de banco/caixa e forma de pagamento; ao confirmar, gera a movimentação financeira, atualiza saldo do título, saldo da conta, fluxo de caixa, DRE e relatórios.
- Baixa parcial e **baixa múltipla** (selecionar várias parcelas e liquidar de uma vez).
- Estorno/cancelamento em vez de exclusão de movimentos já usados.
- Lançamento manual de despesa com **parcelamento** automático.
- Geração automática das parcelas a partir da condição/forma de pagamento do pedido (já existe hoje; será mantida e ampliada com os campos novos).
- Filtros: parceiro, vencimento, pagamento, status, centro de custo, conta, forma de pagamento, período. Indicadores: total a receber/pagar, vencido, recebido no período, em aberto, do dia, futuros.

## Etapa 3 — Fluxo de caixa, DRE e Dashboard Financeiro

- **Fluxo de caixa** diário/semanal/mensal/anual, separando realizado e previsto, com projeção pelos títulos em aberto e gráficos de entradas, saídas, saldo e receitas x despesas.
- **DRE gerencial**: receita bruta, deduções, receita líquida, CPV, lucro bruto, despesas operacionais por grupo, resultado operacional, receitas/despesas financeiras, resultado líquido. Com valor, percentual sobre receita e comparação com o período anterior; visões mensal/trimestral/semestral/anual/personalizado; filtros por centro de custo, empresa, categoria e período. Transferências ficam fora.
- **Dashboard financeiro** com cards (saldo em contas, a receber, a pagar, recebimentos e pagamentos do mês, faturamento, custo, lucro bruto, margem, resultado) e gráficos por mês, por categoria e por centro de custo.

## Etapa 4 — Rentabilidade de vendas e custo de rota

- Análise por pedido/produto/cliente/vendedor/rota/centro: receita, quantidade, preço, custo unitário e total, lucro bruto, margem %, markup, desconto, comissão e resultado após comissão — usando o custo que já está no cadastro de produto e no histórico de custos.
- Rankings (mais vendidos, maior faturamento, maior lucro, maior margem, melhores clientes, vendedores, rotas) e ticket médio.
- **Despesas de rota/viagem** ligadas às rotas existentes: data, responsável, veículo, km inicial/final, combustível, alimentação, hotel, pedágio, estacionamento, outras.
- **Parâmetros configuráveis** (nada fixo no código): preço do combustível, consumo km/l, custo por km, pedágio, alimentação/dia, hotel/noite — com cálculo do custo estimado e do custo real da rota, custo por km, custo por cliente visitado.
- Rentabilidade real da rota: faturamento dos pedidos da rota − custo dos produtos − despesas da rota = resultado e margem.

## Etapa 5 — Relatórios, exportação, auditoria e permissões

- Relatórios exportáveis em PDF e Excel/CSV: contas a receber, a pagar, fluxo de caixa, extrato, DRE, vendas, custos, margens, lucro por produto/cliente/vendedor/rota, despesas por categoria e por centro de custo, rentabilidade por empresa, resultado mensal.
- Registro de auditoria (usuário, data/hora, ação, registro, valor anterior e novo) em toda movimentação financeira relevante, aproveitando a auditoria já existente.
- Novas permissões, encaixadas no sistema de papéis atual: ver financeiro, criar/editar contas a pagar, aprovar pagamentos, criar contas a receber, receber, ver DRE, ver custos, ver margens, ver contas bancárias, transferir, gerenciar categorias, gerenciar centros de custo. Quem não tem permissão não vê valor sensível — nem na tela nem nos dados.

## Menu

O grupo Financeiro passa a ter: Dashboard Financeiro, Contas a Receber, Contas a Pagar, Caixa e Bancos, Categorias, Centros de Custo (o cadastro que já existe), Fluxo de Caixa, DRE, Movimentações/Conciliação e Relatórios Financeiros. As telas atuais continuam nos mesmos endereços.

## Detalhes técnicos

- Migrações idempotentes novas (`db/fase32_*` a `db/fase36_*`), só com `add column if not exists`, novas tabelas e novas funções — nenhum `drop` de coluna ou tabela existente. Defaults preenchem os registros antigos.
- Novas tabelas: `contas_financeiras`, `movimentos_financeiros`, `transferencias` (ou movimento par com `transferencia_id`), `categorias_financeiras` (auto-relacionamento pai/filho), `rota_despesas`, `rota_parametros`. Todas com `grant` para `authenticated`/`service_role`, RLS e políticas baseadas nas funções já existentes (`can_finance`, `can_manage`, `meus_centros`).
- Saldos e indicadores por views/funções agregadas no banco (`vw_conta_saldo`, `vw_extrato_conta`, `vw_fluxo_caixa_realizado`, `vw_dre`, `vw_rentabilidade_pedido`, `vw_rota_resultado`), com índices em `vencimento`, `status`, `conta_id`, `centro_id`, `categoria_id`, `data`. Nada de carregar milhares de linhas no navegador: listas paginadas e agregação no servidor.
- Baixas continuam via RPC `security definer` (`baixar_receber`/`baixar_pagar` estendidas com conta, forma, juros/multa/desconto) para garantir movimento + saldo + auditoria numa transação só. Novas RPC: `baixar_titulos_lote`, `transferir_entre_contas`, `estornar_movimento`.
- Front reaproveita `CrudPage`, `TitulosPage`, `FilterBar`, `ErpLayout` e o padrão react-query já usados; novas rotas em `src/routes/_app/`.
