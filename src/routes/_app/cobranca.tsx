import { createFileRoute } from "@tanstack/react-router";
import { ErpLayout } from "@/components/erp-layout";
import { AgendaClientes } from "@/components/agenda-clientes";
export const Route = createFileRoute("/_app/cobranca")({
  component: () => (
    <ErpLayout
      title="Agenda de cobrança"
      description="Contatos, promessas de pagamento e acompanhamento por cliente."
    >
      <AgendaClientes tipo="cobranca" />
    </ErpLayout>
  ),
});
