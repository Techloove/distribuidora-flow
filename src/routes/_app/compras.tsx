import { createFileRoute } from "@tanstack/react-router";

import { DocumentoPage, type DocumentoConfig } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";

export const Route = createFileRoute("/_app/compras")({
  head: () => ({
    meta: [
      { title: "Compras e NF de entrada — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Registro de compras e notas fiscais de entrada com atualização de estoque, custo médio e contas a pagar.",
      },
      { property: "og:title", content: "Compras e NF de entrada — ERP Distribuidora" },
      { property: "og:description", content: "Entradas de mercadoria e contas a pagar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ComprasPage,
});

const config: DocumentoConfig = {
  table: "compras",
  itemsTable: "compra_itens",
  parentKey: "compra_id",
  itemPriceField: "custo_unitario",
  itemPriceLabel: "Custo",
  partnerTable: "fornecedores",
  partnerKey: "fornecedor_id",
  partnerLabel: "Fornecedor",
  dateField: "data_entrada",
  dateLabel: "Data de entrada",
  rpc: "receber_compra",
  rpcLabel: "Receber NF",
  doneStatus: "recebida",
};

function ComprasPage() {
  return (
    <ErpLayout
      title="Compras / NF de entrada"
      description="Ao receber a NF, o estoque entra, o custo médio é recalculado e as parcelas do contas a pagar são criadas."
    >
      <DocumentoPage config={config} />
    </ErpLayout>
  );
}
