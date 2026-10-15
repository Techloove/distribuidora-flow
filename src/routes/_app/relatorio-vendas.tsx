import { createFileRoute } from "@tanstack/react-router";
import { ErpLayout } from "@/components/erp-layout";
import { RelatoriosVendas } from "@/components/relatorios-vendas";
export const Route = createFileRoute("/_app/relatorio-vendas")({
  head: () => ({ meta: [{ title: "Relatórios de Vendas — Caparaó System" }] }),
  component: () => (
    <ErpLayout
      title="Relatórios de Vendas"
      description="Vendas, comissões e rentabilidade por rota, cidade, representante, cliente e centro de custo."
    >
      <RelatoriosVendas />
    </ErpLayout>
  ),
});
