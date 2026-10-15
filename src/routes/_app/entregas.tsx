import { createFileRoute } from "@tanstack/react-router";
import { ErpLayout } from "@/components/erp-layout";
import { Entregas } from "@/components/entregas";
export const Route = createFileRoute("/_app/entregas")({
  head: () => ({ meta: [{ title: "Entregas — Caparaó System" }] }),
  component: () => (
    <ErpLayout
      title="Entregas"
      description="Formalize o recebimento dos pedidos e acompanhe as entregas concluídas."
    >
      <Entregas />
    </ErpLayout>
  ),
});
