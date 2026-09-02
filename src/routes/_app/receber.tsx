import { createFileRoute } from "@tanstack/react-router";

import { ErpLayout } from "@/components/erp-layout";
import { TitulosPage, type TitulosConfig } from "@/components/titulos-page";

export const Route = createFileRoute("/_app/receber")({
  head: () => ({
    meta: [
      { title: "Contas a receber — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Controle de títulos a receber gerados pelos pedidos, com vencimentos, saldos e baixas parciais.",
      },
      { property: "og:title", content: "Contas a receber — ERP Distribuidora" },
      { property: "og:description", content: "Títulos, vencidos e recebimentos da distribuidora." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReceberPage,
});

const config: TitulosConfig = {
  table: "contas_receber",
  partnerTable: "clientes",
  partnerKey: "cliente_id",
  partnerLabel: "Cliente",
  rpc: "baixar_receber",
  baixaLabel: "Receber",
};

function ReceberPage() {
  return (
    <ErpLayout
      title="Contas a receber"
      description="Parcelas geradas na confirmação dos pedidos. Baixas parciais atualizam o saldo automaticamente."
    >
      <TitulosPage config={config} />
    </ErpLayout>
  );
}
