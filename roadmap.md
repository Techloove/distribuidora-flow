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

## Pendente
### Alta prioridade
- [ ] Fluxo completo de status do pedido (em digitação → aprovação → separação → separado → faturado → em rota → entregue; parcial, recusado, devolvido)
- [ ] Aprovação comercial automática (limite de crédito, títulos vencidos, estoque, margem mínima, desconto máximo)
- [ ] Separação (lista por pedido e por onda)
- [ ] Filtro global de centro de custo no topo (Todos | Centro A | Centro B) afetando dashboard e relatórios
- [ ] centro_id nas tabelas que ainda não têm (clientes/pessoas, produtos, contas a pagar/receber, comissões) + vínculo multi-centro para pessoas
- [ ] Comissão escalonada por faixa (mensal/semanal/por pedido/faturamento/recebimento; base bruta/líquida)
- [ ] Restrição de visibilidade: representante só vê seus clientes/pedidos/comissões

### Média prioridade
- [ ] Rotas (nome, região, cidades, bairros, dia da semana, motorista, veículo, sequência) + rota no cliente
- [ ] Entregas/romaneio com status próprio (aguardando, em rota, entregue, parcial, não entregue, devolvido)
- [ ] Planejamento de compras (média 30/60/90 dias, pendentes, em trânsito, sugestão de compra)
- [ ] Clientes inativos (filtros 15/30/45/60/90/120 dias, potencial de recuperação)
- [ ] Histórico comercial do produto (vendas, faturamento, custo, margem, clientes, média mensal)
- [ ] Histórico de custos do produto (data, fornecedor, NF, qtd, custo) + último custo / custo de reposição
- [ ] Histórico do cliente (ticket médio, total comprado, títulos abertos/vencidos, último pedido)
- [ ] Semáforo de margem (vermelho/amarelo/verde) e margem mínima por produto
- [ ] Dashboard visual (faturamento hoje/mês, pedidos em separação/entrega, clientes inativos, estoque baixo, gráficos)
- [ ] Campos fiscais/logísticos do produto (SKU, subcategoria, CEST, CFOP, dimensões, estoque máximo, preço promocional, comissão do produto)
- [ ] NF de entrada: chave NF-e, impostos, lote, validade
- [ ] Cliente: WhatsApp, endereço de cobrança e de entrega separados
- [ ] Representante: WhatsApp, CPF/CNPJ, tipo (vendedor/representante), meta mensal no cadastro

### Baixa prioridade / depende de terceiros
- [ ] Boletos Sicredi (OAuth2, emitir/consultar/PDF/baixar/alterar vencimento, webhook e conciliação) — exige credenciais e beneficiário no Sicredi
- [ ] Categorias de despesa no contas a pagar (aluguel, energia, combustível, salários, impostos...)
- [ ] Exportação PDF/Excel dos relatórios e importação de planilhas
