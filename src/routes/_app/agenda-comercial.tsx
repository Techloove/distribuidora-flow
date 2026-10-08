import { createFileRoute } from "@tanstack/react-router";
import { ErpLayout } from "@/components/erp-layout";
import { AgendaClientes } from "@/components/agenda-clientes";
export const Route = createFileRoute("/_app/agenda-comercial")({
  component: () => (
    <ErpLayout
      title="Agenda comercial"
      description="Reativação, visitas e próximos contatos da carteira."
    >
      <AgendaClientes tipo="comercial" />
    </ErpLayout>
  ),
});
