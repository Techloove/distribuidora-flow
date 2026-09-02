import { createFileRoute } from "@tanstack/react-router";

import { ErpLayout } from "@/components/erp-layout";
import { TitulosPage, type TitulosConfig } from "@/components/titulos-page";

export const Route = createFileRoute("/_app/pagar")({
  head: () => ({
    meta: [
      { title: "Contas a pagar — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Títulos a pagar gerados pelas notas de entrada, com vencimentos, saldos e pagamentos parciais.",
      },
      { property: "og:title", content: "Contas a pagar — ERP Distribuidora" },
      { property: "og:description", content: "Obrigações com fornecedores da distribuidora." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PagarPage,
});

const config: TitulosConfig = {
  table: "contas_pagar",
  partnerTable: "fornecedores",
  partnerKey: "fornecedor_id",
  partnerLabel: "Fornecedor",
  rpc: "baixar_pagar",
  baixaLabel: "Pagar",
};

function PagarPage() {
  return (
    <ErpLayout
      title="Contas a pagar"
      description="Parcelas criadas no recebimento das NFs de compra, com controle de vencidos e baixas."
    >
      <TitulosPage config={config} />
    </ErpLayout>
  );
}
