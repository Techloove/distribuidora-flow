import { buscaReferencias } from "@/lib/referencias-registros";
import { createFileRoute } from "@tanstack/react-router";
import { BoletosPage } from "@/components/boletos-page";
export const Route = createFileRoute("/_app/boletos")({
  validateSearch: buscaReferencias,
  head: () => ({ meta: [{ title: "Boletos — ERP Distribuidora" }] }),
  component: BoletosRoute,
});

function BoletosRoute() {
  const referencia = Route.useSearch();
  return <BoletosPage key={JSON.stringify(referencia)} referencia={referencia} />;
}
