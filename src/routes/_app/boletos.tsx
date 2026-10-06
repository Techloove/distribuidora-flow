import { createFileRoute } from "@tanstack/react-router";
import { BoletosPage } from "@/components/boletos-page";
export const Route = createFileRoute("/_app/boletos")({
  head: () => ({ meta: [{ title: "Boletos — ERP Distribuidora" }] }),
  component: BoletosPage,
});
