import { createFileRoute } from "@tanstack/react-router";
import { ComprasUnificadas } from "@/components/compras-unificadas";
import { ErpLayout } from "@/components/erp-layout";
import { abaCompras } from "@/lib/compras";
export const Route = createFileRoute("/_app/compras")({
  head: () => ({ meta: [{ title: "Compras — Caparaó System" }] }),
  validateSearch: (search: Record<string, unknown>) => ({ aba: abaCompras(search["aba"]) }),
  component: ComprasPage,
});
function ComprasPage() {
  const { aba } = Route.useSearch();
  return (
    <ErpLayout
      title="Compras"
      description="Planejamento, reposição, compras e notas de entrada em um único espaço."
    >
      <ComprasUnificadas aba={aba} />
    </ErpLayout>
  );
}
