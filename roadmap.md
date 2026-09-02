# Roadmap ERP Distribuidora

## Pronto
- Cadastro unificado (pessoas: cliente/fornecedor/representante/transportadora/usuário) com espelhamento
- Produtos (custo médio, preço de custo, markup, estoque mín./atual)
- Pedidos (itens, desconto, frete, forma de pagamento, centro, parcelas) + confirmar/cancelar
- Compras / NF de entrada (recebe estoque, recalcula custo médio, gera contas a pagar)
- Estoque e movimentos multi-centro
- Faturamento (NF de saída), Devoluções
- Contas a receber / a pagar, Fluxo de caixa
- Comissões + regras flexíveis (representante/cliente/produto/categoria/UF, vigência, prioridade)
- Tabelas de preço, Formas de pagamento, Centros, Metas de vendas
- Expedição (transportadora, motorista, placa, volumes, status)
- Relatórios, Dashboard, Notificações, Auditoria, RBAC + RLS (7 papéis)
- Códigos sequenciais numéricos automáticos

## Concluído na fase 14/15 (ver itens marcados)

## Pendente
### Alta prioridade
- [x] Fluxo completo de status do pedido (em digitação → aprovação → separação → separado → faturado → em rota → entregue; parcial, recusado, devolvido)
- [x] Aprovação comercial automática (limite de crédito, títulos vencidos, estoque, margem mínima, desconto máximo)
- [x] Separação (lista por pedido e por onda)
- [x] Filtro global de centro de custo no topo (Todos | Centro A | Centro B) afetando dashboard e relatórios
- [x] centro_id nas tabelas que ainda não têm (clientes/pessoas, produtos, contas a pagar/receber, comissões) + vínculo multi-centro para pessoas
- [x] Comissão escalonada por faixa (mensal/semanal/por pedido/faturamento/recebimento; base bruta/líquida)
- [x] Restrição de visibilidade: representante só vê seus clientes/pedidos/comissões

### Média prioridade
- [x] Rotas (nome, região, cidades, bairros, dia da semana, motorista, veículo, sequência) + rota no cliente
- [x] Entregas/romaneio com status próprio (aguardando, em rota, entregue, parcial, não entregue, devolvido)
- [x] Planejamento de compras (média 30/60/90 dias, pendentes, em trânsito, sugestão de compra)
- [x] Clientes inativos (filtros 15/30/45/60/90/120 dias, potencial de recuperação)
- [x] Histórico comercial do produto (vendas, faturamento, custo, margem, clientes, média mensal)
- [x] Histórico de custos do produto (data, fornecedor, NF, qtd, custo) + último custo / custo de reposição
- [x] Histórico do cliente (ticket médio, total comprado, títulos abertos/vencidos, último pedido)
- [ ] Semáforo de margem (vermelho/amarelo/verde) e margem mínima por produto
- [ ] Dashboard visual (faturamento hoje/mês, pedidos em separação/entrega, clientes inativos, estoque baixo, gráficos)
- [x] Campos fiscais/logísticos do produto (SKU, subcategoria, CEST, CFOP, dimensões, estoque máximo, preço promocional, comissão do produto)
- [x] NF de entrada: chave NF-e, impostos, lote, validade
- [x] Cliente: WhatsApp, endereço de cobrança e de entrega separados
- [x] Representante: WhatsApp, CPF/CNPJ, tipo (vendedor/representante), meta mensal no cadastro

### Baixa prioridade / depende de terceiros
- [ ] Boletos Sicredi (OAuth2, emitir/consultar/PDF/baixar/alterar vencimento, webhook e conciliação) — exige credenciais e beneficiário no Sicredi
- [ ] Categorias de despesa no contas a pagar (aluguel, energia, combustível, salários, impostos...)
- [ ] Exportação PDF/Excel dos relatórios e importação de planilhas

## Novas demandas
- [x] Configurações: chaves da API Sicredi + juros, multa, desconto e protesto
- [x] Produtos: preço de custo, custo médio, markup e preço de venda na mesma linha, markup editável sobre o custo médio

## Pedidos
- [x] Listagem de pedidos em tela cheia, uma linha por pedido
- [x] Editar dados da promoção + preço promocional no cadastro/listagem de produtos
- [x] Produtos: preço promocional vigente + data limite vindos da Promoção na listagem
- [x] Produtos: editar % markup e preço de venda direto na listagem
