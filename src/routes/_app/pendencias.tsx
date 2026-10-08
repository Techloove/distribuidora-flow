import { createFileRoute } from "@tanstack/react-router";
import { ErpLayout } from "@/components/erp-layout";
import { CentralPendencias } from "@/components/central-pendencias";
export const Route = createFileRoute("/_app/pendencias")({
  head: () => ({ meta: [{ title: "Central de pendências — Caparaó System" }] }),
  component: () => (
    <ErpLayout
      title="Central de pendências"
      description="Priorize o que precisa de atenção e continue o trabalho na tela responsável."
    >
      <CentralPendencias />
    </ErpLayout>
  ),
});
