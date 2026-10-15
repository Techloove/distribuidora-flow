import { createFileRoute } from "@tanstack/react-router";
import { ErpLayout } from "@/components/erp-layout";
import { AgendaComercialUnificada } from "@/components/agenda-comercial-unificada";
import { abaAgenda } from "@/lib/agenda-comercial";
export const Route = createFileRoute("/_app/agenda-comercial")({
  validateSearch: (search: Record<string, unknown>) => ({ aba: abaAgenda(search["aba"]) }),
  head: () => ({ meta: [{ title: "Agenda comercial — Caparaó System" }] }),
  component: AgendaPage,
});
function AgendaPage() {
  const { aba } = Route.useSearch();
  return (
    <ErpLayout
      title="Agenda comercial"
      description="Relacionamento, reativação e cobrança em um só lugar."
    >
      <AgendaComercialUnificada aba={aba} />
    </ErpLayout>
  );
}
