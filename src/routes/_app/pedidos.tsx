import { createFileRoute } from "@tanstack/react-router";

import { DocumentoPage, type DocumentoConfig } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";

export const Route = createFileRoute("/_app/pedidos")({
  head: () => ({
    meta: [
      { title: "Pedidos de venda — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Lançamento de pedidos de venda com itens, descontos, comissão e confirmação que baixa estoque e gera contas a receber.",
      },
      { property: "og:title", content: "Pedidos de venda — ERP Distribuidora" },
      { property: "og:description", content: "Vendas integradas a estoque e financeiro." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PedidosPage,
});

const config: DocumentoConfig = {
  table: "pedidos",
  itemsTable: "pedido_itens",
  parentKey: "pedido_id",
  itemPriceField: "preco_unitario",
  itemPriceLabel: "Preço",
  partnerTable: "clientes",
  partnerKey: "cliente_id",
  partnerLabel: "Cliente",
  dateField: "data_pedido",
  dateLabel: "Data do pedido",
  rpc: "confirmar_pedido",
  rpcLabel: "Confirmar pedido",
  doneStatus: "confirmado",
};

function PedidosPage() {
  return (
    <ErpLayout
      title="Pedidos de venda"
      description="Ao confirmar, o sistema baixa o estoque, gera as parcelas do contas a receber e a comissão prevista."
    >
      <DocumentoPage config={config} />
    </ErpLayout>
  );
}
