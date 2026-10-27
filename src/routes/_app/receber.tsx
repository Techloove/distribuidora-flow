import { buscaReferencias } from "@/lib/referencias-registros";
import { createFileRoute } from "@tanstack/react-router";

import { ErpLayout } from "@/components/erp-layout";
import { TitulosPage, type TitulosConfig } from "@/components/titulos-page";

export const Route = createFileRoute("/_app/receber")({
  validateSearch: buscaReferencias,
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
  view: "vw_titulos_receber",
  rpcBaixa: "receber_titulo",
  partnerTable: "clientes",
  partnerKey: "cliente_id",
  partnerLabel: "Cliente",
  rpc: "baixar_receber",
  rpcCriar: "criar_receita",
  baixaLabel: "Receber",
};

function ReceberPage() {
  const referencia = Route.useSearch();
  return (
    <ErpLayout
      title="Contas a receber"
      description="Parcelas geradas na confirmação dos pedidos. Baixas parciais atualizam o saldo automaticamente."
    >
      <TitulosPage key={JSON.stringify(referencia)} config={config} referencia={referencia} />
    </ErpLayout>
  );
}
